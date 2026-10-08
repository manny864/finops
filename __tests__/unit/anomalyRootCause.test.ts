// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));

import { buildRootCauseFacts, type MeterRow } from "@/services/anomalyRootCause.service";
import { getAnomalyRootCauseFacts, type AnomalyContributor } from "@/services/anomalyDetectionService";
import { suggestedActions } from "@/types/anomalyRootCause.types";
import { demoRootCauseFacts } from "@/lib/mockData";

const contrib = (service_name: string, resource_group = "rg-a"): AnomalyContributor => ({
    resource_group, service_name, cost: 200, baseline_avg: 100, delta: 100, delta_pct_of_total: 50,
});
// Ventana de 30 días con datos; base_* son SUMAS de la ventana, como devuelve el SQL.
const row = (service_name: string, meter_name: string, day_cost: number, day_qty: number, baseDaily: number, baseQtyDaily: number): MeterRow => ({
    service_name, meter_name, day_cost, day_qty, base_cost: baseDaily * 30, base_qty: baseQtyDaily * 30,
});

describe("buildRootCauseFacts — clasificación", () => {
    it("clasifica medidor nuevo, consumo, precio y costo sin cantidades", () => {
        const facts = buildRootCauseFacts([contrib("VM")], [
            row("VM", "nuevo", 50, 5, 0, 0),
            row("VM", "consumo", 30, 30, 10, 10),   // cantidad x3, costo unitario igual
            row("VM", "precio", 25, 10, 10, 10),    // misma cantidad, unitario x2.5
            row("VM", "sinCantidad", 20, 0, 10, 0), // la API no trajo cantidades
        ], 30);
        const byMeter = Object.fromEntries(facts.map((f) => [f.meterName, f]));
        expect(byMeter.nuevo).toMatchObject({ type: "NEW_METER", baseline: 0, actual: 50, delta: 50 });
        expect(byMeter.nuevo.costChangePct).toBeUndefined();
        expect(byMeter.precio).toMatchObject({ type: "PRICE_INCREASE", quantityChangePct: 0, unitCostChangePct: 150, costChangePct: 150 });
        // Top 3 por delta: "sinCantidad" (delta 10) queda afuera contra 50, 20 y 15.
        expect(byMeter.consumo).toMatchObject({ type: "USAGE_INCREASE", quantityChangePct: 200, unitCostChangePct: 0 });
        expect(facts.map((f) => f.meterName)).toEqual(["nuevo", "consumo", "precio"]);
    });

    it("sin cantidades queda COST_INCREASE", () => {
        const [f] = buildRootCauseFacts([contrib("VM")], [row("VM", "m", 20, 0, 10, 0)], 30);
        expect(f).toMatchObject({ type: "COST_INCREASE", costChangePct: 100 });
        expect(f.quantityChangePct).toBeUndefined();
    });

    it("descarta medidores que bajaron o no se movieron", () => {
        const facts = buildRootCauseFacts([contrib("VM")], [row("VM", "baja", 5, 5, 10, 10), row("VM", "igual", 10, 10, 10, 10)], 30);
        expect(facts).toEqual([expect.objectContaining({ type: "INSUFFICIENT_DETAIL" })]);
    });

    it("servicio sin detalle por medidor declara INSUFFICIENT_DETAIL con su resource group", () => {
        const facts = buildRootCauseFacts([contrib("VM"), contrib("SQL", "rg-data")], [row("VM", "m", 30, 30, 10, 10)], 30);
        expect(facts[1]).toEqual({
            id: "f2", type: "INSUFFICIENT_DETAIL", serviceName: "SQL", resourceGroup: "rg-data",
            baseline: 100, actual: 200, delta: 100, costChangePct: 100,
        });
    });

    // El detalle por medidor no tiene resource group: dos contribuyentes del
    // mismo servicio comparten medidores y no se repiten.
    it("no repite medidores de un servicio que aparece en dos resource groups", () => {
        const facts = buildRootCauseFacts([contrib("VM", "rg-a"), contrib("VM", "rg-b")], [row("VM", "m", 30, 30, 10, 10)], 30);
        expect(facts.map((f) => f.id)).toEqual(["f1"]);
    });

    it("sin días de base no inventa medidores nuevos", () => {
        const facts = buildRootCauseFacts([contrib("VM")], [row("VM", "m", 30, 30, 0, 0)], 0);
        expect(facts.map((f) => f.type)).toEqual(["INSUFFICIENT_DETAIL"]);
    });
});

describe("suggestedActions — deterministas", () => {
    it("mapea hechos a acciones y agrega ASSIGN_OWNER sin responsable", () => {
        const facts = buildRootCauseFacts([contrib("VM")], [row("VM", "n", 50, 5, 0, 0), row("VM", "p", 25, 10, 10, 10)], 30);
        expect(suggestedActions(facts, true)).toEqual(["REVIEW_NEW_USAGE", "REVIEW_COMMITMENT_COVERAGE"]);
        expect(suggestedActions(facts, false)).toContain("ASSIGN_OWNER");
        expect(suggestedActions([], true)).toEqual([]);
    });
});

describe("getAnomalyRootCauseFacts — consulta", () => {
    beforeEach(() => { queryMock.mockReset(); });

    it("filtra por tenant, servicios y suscripción con los parámetros en orden", async () => {
        queryMock
            .mockResolvedValueOnce([[row("VM", "m", 30, 30, 10, 10)]])
            .mockResolvedValueOnce([[{ days: 30 }]]);
        const facts = await getAnomalyRootCauseFacts("t1", "SUB-A,sub-b", "2026-10-01", [contrib("VM"), contrib("SQL")]);

        const [sql, params] = queryMock.mock.calls[0];
        expect(sql).toContain("FROM CostMeterSnapshots");
        expect(sql).toContain("LOWER(subscription_id) IN (?,?)");
        expect(params).toEqual(["2026-10-01", "2026-10-01", "2026-10-01", "2026-10-01", "t1", "2026-10-01", 30, "2026-10-01", "VM", "SQL", "sub-a", "sub-b"]);
        expect(queryMock.mock.calls[1][1]).toEqual(["t1", "2026-10-01", 30, "2026-10-01", "sub-a", "sub-b"]);
        expect(facts.map((f) => f.type)).toEqual(["USAGE_INCREASE", "INSUFFICIENT_DETAIL"]);
    });

    it("si la base falla devuelve [] en vez de romper la persistencia", async () => {
        queryMock.mockRejectedValue(new Error("db down"));
        expect(await getAnomalyRootCauseFacts("t1", "All", "2026-10-01", [contrib("VM")])).toEqual([]);
    });
});

describe("demoRootCauseFacts", () => {
    it("usa la clasificación de producción y cubre los tipos que muestra la demo", () => {
        const types = demoRootCauseFacts([contrib("Virtual Machines"), contrib("Azure SQL Database"), contrib("App Service"), contrib("Bandwidth")])
            .map((f) => f.type);
        expect(types).toEqual(["USAGE_INCREASE", "PRICE_INCREASE", "NEW_METER"]);
    });
});
