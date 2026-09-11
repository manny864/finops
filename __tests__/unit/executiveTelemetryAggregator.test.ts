// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * El agregador presentaba numeros INVENTADOS como telemetria del tenant.
 *
 * Las secciones de desperdicio, HA, anomalias, rightsizing y presupuestos eran
 * literales hardcodeados en el camino real (no en el mock): un CFO leia
 * "$60.00/mes en discos huerfanos" y esos discos no existian. Estos casos
 * fijan las dos propiedades que impiden que vuelva a pasar:
 *
 *   1. Sin datos => vacio/cero, nunca una cifra de relleno.
 *   2. Un colector caido se REPORTA como caido, para que el prompt no lo lea
 *      como "cero hallazgos".
 */

const query = vi.fn();
vi.mock("@/modules/storage/db", () => ({
    default: { query: (...a: unknown[]) => query(...a) },
    insertPlatformAiUsage: vi.fn(),
}));
vi.mock("@/services/categoryConsumptionService", () => ({
    getRealCategoryOverview: vi.fn(async () => ({ categories: [] })),
}));
vi.mock("@/services/haService", () => ({
    evaluateHALive: vi.fn(async () => ({ items: [], counts: {}, diagnostics: {} })),
}));
vi.mock("@/modules/core/aiProvider", () => ({
    AIProviderFactory: { getGeminiModel: vi.fn() },
    aiQueue: { add: vi.fn() },
    withExponentialBackoff: vi.fn(),
    redactForTenant: vi.fn(),
}));
vi.mock("@/lib/emailHelper", () => ({ sendEmailStrict: vi.fn() }));

const { aggregateExecutiveTelemetry } = await import("@/services/executiveReportGenerator.service");
const { getRealCategoryOverview } = await import("@/services/categoryConsumptionService");
const { evaluateHALive } = await import("@/services/haService");

const TENANT = "11111111-aaaa-4bbb-8ccc-222222222222"; // real: no matchea isMockTenant

beforeEach(() => {
    vi.clearAllMocks();
    query.mockResolvedValue([[]]);
});

describe("aggregateExecutiveTelemetry", () => {
    it("un tenant sin datos no inventa desperdicio, riesgos ni presupuestos", async () => {
        const r = await aggregateExecutiveTelemetry(TENANT);

        expect(r.inefficiencyDistribution).toEqual([]);
        expect(r.haRisks).toEqual([]);
        expect(r.anomalies).toEqual([]);
        expect(r.budgetsExecution).toEqual([]);
        expect(r.rightsizingRecommendations).toEqual([]);
        expect(r.kpiMetrics.monthlySavingsIdentifiedUSD).toBe(0);
        expect(r.kpiMetrics.criticalHighHaRisksCount).toBe(0);
        // Las familias sin gasto quedan en null, que el prompt lee como
        // "dato no disponible" y no como cero.
        expect(r.resourceFamilies.databases).toBeNull();
        expect(r.resourceFamilies.aiAndMachineLearning).toBeNull();
    });

    it("un colector caido se reporta como caido y no como cero", async () => {
        vi.mocked(evaluateHALive).mockRejectedValueOnce(new Error("ARG 403"));

        const r = await aggregateExecutiveTelemetry(TENANT);
        const ha = r.collectorStatus.find((c) => c.collector === "haRisks");

        expect(ha?.ok).toBe(false);
        expect(ha?.error).toContain("403");
        // Y el resto del barrido sobrevive: por eso los colectores son
        // independientes y no un try/catch alrededor de todo.
        expect(r.collectorStatus.find((c) => c.collector === "mtdSpend")?.ok).toBe(true);
    });

    it("mapea las familias de recursos desde el overview de categorias", async () => {
        vi.mocked(getRealCategoryOverview).mockResolvedValueOnce({
            categories: [
                { category: "Databases", totalCost: 1200.456, percentage: 30, momVariation: 4, projectedCost: 1300, services: [{ name: "Azure SQL", cost: 900, count: 3 }] },
                { category: "Vertical no mapeada", totalCost: 50, percentage: 1, momVariation: 0, projectedCost: 55, services: [] },
            ],
        } as never);

        const r = await aggregateExecutiveTelemetry(TENANT);

        expect(r.resourceFamilies.databases).toMatchObject({
            category: "Databases",
            monthlyCostUSD: 1200.46, // redondeo a 2 decimales, no truncado
            topServices: [{ name: "Azure SQL", costUSD: 900, resourceCount: 3 }],
        });
        // Lo que no esta en el mapa no se pierde: cae en `others`.
        expect(r.resourceFamilies.others.map((o) => o.category)).toEqual(["Vertical no mapeada"]);
    });

    it("deriva desperdicio y presupuestos de las filas reales", async () => {
        query.mockImplementation(async (sql: string) => {
            if (String(sql).includes("ZombieResources")) {
                return [[{ reason: "Disco huérfano", affected: 3, wasteUsd: 75 },
                         { reason: "IP sin uso", affected: 5, wasteUsd: 25 }]];
            }
            if (String(sql).includes("FROM Budgets")) {
                return [[{ name: "Core", amount_usd: 1000, actual_spend_usd: 400 }]];
            }
            return [[]];
        });

        const r = await aggregateExecutiveTelemetry(TENANT);

        expect(r.kpiMetrics.monthlySavingsIdentifiedUSD).toBe(100);
        expect(r.kpiMetrics.annualizedSavingsUSD).toBe(1200);
        expect(r.inefficiencyDistribution[0]).toMatchObject({ categoryName: "Disco huérfano", percentageOfTotalWaste: 75 });
        expect(r.budgetsExecution[0]).toMatchObject({ burnPercent: 40, isExceeded: false });
        expect(r.kpiMetrics.budgetBurnPercent).toBe(40);
    });
});
