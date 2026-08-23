import { describe, it, expect, vi } from "vitest";

vi.mock("@/modules/storage/db", () => ({
    default: { query: vi.fn(async () => [[]]) },
    insertPlatformAiUsage: vi.fn(),
}));

import { isAlreadyFocusFormat, mapNativeFocusRows } from "@/modules/core/aiProvider";

/** Fila tal como sale de un export FOCUS 1.1 de la plataforma (48 columnas). */
const focusRow = {
    AvailabilityZone: "", BilledCost: "12.34", BillingAccountId: "ec03e8ce", BillingCurrency: "USD",
    ChargeCategory: "Usage", ChargeDescription: "Azure DNS", ChargePeriodStart: "2026-07-28T03:00:00.000Z",
    ConsumedQuantity: "0", EffectiveCost: "11.00", ProviderName: "Azure", PublisherName: "Microsoft",
    ResourceName: "cscs-finops-prod", ServiceName: "Azure DNS", SubAccountId: "ec03e8ce", Tags: "{}",
};

/** Export de Azure Cost Analysis: nombres propios, no FOCUS. */
const azureRow = { UsageDate: "2026-07-28", CostUSD: "2.70", Cost: "2.70", ForecastCost: "", Currency: "USD" };

describe("detección de CSV ya en formato FOCUS", () => {
    it("reconoce un export FOCUS por sus columnas", () => {
        expect(isAlreadyFocusFormat([focusRow])).toBe(true);
    });

    it("no confunde un export de Azure Cost Analysis con FOCUS", () => {
        // Este SÍ necesita la IA para inferir el mapeo.
        expect(isAlreadyFocusFormat([azureRow])).toBe(false);
    });

    it("no da falso positivo si falta una columna obligatoria", () => {
        const { EffectiveCost, ...sinEffective } = focusRow;
        void EffectiveCost;
        expect(isAlreadyFocusFormat([sinEffective])).toBe(false);
    });

    it("maneja entrada vacía sin explotar", () => {
        expect(isAlreadyFocusFormat([])).toBe(false);
        expect(isAlreadyFocusFormat(null as never)).toBe(false);
    });
});

describe("mapeo determinista de filas FOCUS", () => {
    it("convierte los importes a número y recorta la fecha a YYYY-MM-DD", () => {
        const [out] = mapNativeFocusRows([focusRow]);
        expect(out.BilledCost).toBe(12.34);
        expect(out.EffectiveCost).toBe(11);
        expect(out.UsageDate).toBe("2026-07-28");
        expect(out.ServiceName).toBe("Azure DNS");
        expect(out.ProviderName).toBe("Azure");
    });

    it("cae a BilledCost cuando EffectiveCost viene vacío", () => {
        // Dejarlo en 0 subestimaría el gasto en el resumen.
        const [out] = mapNativeFocusRows([{ ...focusRow, EffectiveCost: "" }]);
        expect(out.EffectiveCost).toBe(12.34);
    });

    it("convierte importes no numéricos a 0 en vez de NaN", () => {
        const [out] = mapNativeFocusRows([{ ...focusRow, BilledCost: "n/a", EffectiveCost: "n/a" }]);
        expect(out.BilledCost).toBe(0);
        expect(Number.isNaN(out.EffectiveCost)).toBe(false);
    });

    it("usa UsageDate si no hay ChargePeriodStart", () => {
        const { ChargePeriodStart, ...sinCPS } = focusRow;
        void ChargePeriodStart;
        const [out] = mapNativeFocusRows([{ ...sinCPS, UsageDate: "2026-08-15" }]);
        expect(out.UsageDate).toBe("2026-08-15");
    });

    it("procesa el archivo completo, no una muestra", () => {
        // El camino con IA recortaba a 50 filas; el determinista no tiene por qué.
        const rows = Array.from({ length: 256 }, () => focusRow);
        expect(mapNativeFocusRows(rows)).toHaveLength(256);
    });

    it("no deja campos obligatorios vacíos", () => {
        const [out] = mapNativeFocusRows([{ BilledCost: "1", EffectiveCost: "1", ChargeCategory: "", ProviderName: "", ServiceName: "" }]);
        expect(out.ProviderName).toBe("Unknown");
        expect(out.ServiceName).toBe("Unknown");
        expect(out.ChargeCategory).toBe("Usage");
    });
});
