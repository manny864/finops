import { describe, it, expect } from "vitest";
import { buildInvoicingPayload, type MarkupOverride } from "@/services/invoicingAggregationService";
import { simulateBilling } from "@/services/tenantPartnerMarkup.service";
import { isValidFixedFee, isValidMarkupPercentage } from "@/types/tenantPartnerMarkup.types";

function row(over: Partial<any> = {}) {
    return {
        date: "2026-08-01",
        customerId: "cust-1",
        subscriptionId: "sub-prod-001",
        service: "Virtual Machines",
        resourceGroup: "rg-prod",
        billingProfileId: null,
        invoiceSectionId: null,
        originalCost: 100,
        ...over,
    };
}

const BASE_ARGS = {
    period: "2026-08",
    availableSubscriptions: [],
    subNameMap: new Map<string, string>(),
};

describe("simulación de facturación", () => {
    it("calcula margen + tarifa fija sobre el costo base", () => {
        const sim = simulateBilling(15, 500, 10000);
        expect(sim.baseCost).toBe(10000);
        expect(sim.markupAmount).toBe(1500);
        expect(sim.fixedFeeAmount).toBe(500);
        expect(sim.totalBilledCost).toBe(12000);
    });

    it("sin margen ni tarifa el total es el costo base", () => {
        expect(simulateBilling(0, 0, 10000).totalBilledCost).toBe(10000);
    });

    it("usa aritmética exacta, no floats", () => {
        // 0.1 + 0.2 en float da 0.30000000000000004. Con Decimal, un margen de
        // 10% sobre 0.7 tiene que dar exactamente 0.07.
        const sim = simulateBilling(10, 0, 0.7);
        expect(sim.markupAmount).toBe(0.07);
        expect(sim.totalBilledCost).toBe(0.77);
    });
});

describe("buildInvoicingPayload — tarifa fija", () => {
    it("no prorratea la tarifa por línea: las líneas siguen sumando adjustedCost", () => {
        const payload = buildInvoicingPayload({
            ...BASE_ARGS,
            rows: [row(), row({ originalCost: 200 })],
            markupPercent: 10,
            fixedFeeUSD: 500,
        });

        expect(payload.totals.originalCost).toBe(300);
        expect(payload.totals.adjustedCost).toBe(330);
        expect(payload.totals.markupAmount).toBe(30);
        expect(payload.totals.fixedFeeAmount).toBe(500);
        expect(payload.totals.totalBilledCost).toBe(830);

        // Invariante que hace auditable la factura.
        const sumLines = payload.lines.reduce((s, l) => s + l.adjustedCost, 0);
        expect(Number(sumLines.toFixed(2))).toBe(payload.totals.adjustedCost);
    });

    it("sin tarifa fija el total facturado iguala el ajustado", () => {
        const payload = buildInvoicingPayload({ ...BASE_ARGS, rows: [row()], markupPercent: 15 });
        expect(payload.totals.fixedFeeAmount).toBe(0);
        expect(payload.totals.totalBilledCost).toBe(payload.totals.adjustedCost);
    });
});

describe("buildInvoicingPayload — reglas de excepción", () => {
    it("una regla por suscripción reemplaza el margen global", () => {
        const overrides: MarkupOverride[] = [
            { scopeType: "SUBSCRIPTION", scopeValue: "sub-prod-001", overridePercentage: 0 },
        ];
        const payload = buildInvoicingPayload({
            ...BASE_ARGS,
            rows: [row(), row({ subscriptionId: "sub-otra", originalCost: 100 })],
            markupPercent: 50,
            overrides,
        });

        // sub-prod-001 pass-through (100) + sub-otra con 50% (150).
        expect(payload.totals.adjustedCost).toBe(250);
    });

    it("una regla por categoría de servicio exime ese servicio", () => {
        const overrides: MarkupOverride[] = [
            { scopeType: "SERVICE_CATEGORY", scopeValue: "Marketplace", overridePercentage: 0 },
        ];
        const payload = buildInvoicingPayload({
            ...BASE_ARGS,
            rows: [row({ service: "Marketplace" }), row({ service: "Virtual Machines" })],
            markupPercent: 20,
            overrides,
        });

        expect(payload.totals.adjustedCost).toBe(220); // 100 + 120
    });

    it("compara la categoría sin distinguir mayúsculas", () => {
        const payload = buildInvoicingPayload({
            ...BASE_ARGS,
            rows: [row({ service: "marketplace" })],
            markupPercent: 20,
            overrides: [{ scopeType: "SERVICE_CATEGORY", scopeValue: "Marketplace", overridePercentage: 0 }],
        });
        expect(payload.totals.adjustedCost).toBe(100);
    });

    it("la regla por suscripción gana sobre la de servicio", () => {
        // El alcance más específico manda; si ganara la categoría no habría
        // forma de eximir una suscripción puntual.
        const payload = buildInvoicingPayload({
            ...BASE_ARGS,
            rows: [row()],
            markupPercent: 50,
            overrides: [
                { scopeType: "SERVICE_CATEGORY", scopeValue: "Virtual Machines", overridePercentage: 30 },
                { scopeType: "SUBSCRIPTION", scopeValue: "sub-prod-001", overridePercentage: 0 },
            ],
        });
        expect(payload.totals.adjustedCost).toBe(100);
    });

    it("sin reglas se aplica el margen global a todo", () => {
        const payload = buildInvoicingPayload({ ...BASE_ARGS, rows: [row(), row()], markupPercent: 25 });
        expect(payload.totals.adjustedCost).toBe(250);
    });
});

describe("validación contra el tipo real de las columnas", () => {
    it("rechaza porcentajes que DECIMAL(5,2) truncaría en silencio", () => {
        expect(isValidMarkupPercentage(15)).toBe(true);
        expect(isValidMarkupPercentage(0)).toBe(true);
        expect(isValidMarkupPercentage(1500)).toBe(false);
        expect(isValidMarkupPercentage(-5)).toBe(false);
        expect(isValidMarkupPercentage(NaN)).toBe(false);
        expect(isValidMarkupPercentage("15" as unknown)).toBe(false);
    });

    it("rechaza tarifas fijas negativas o no numéricas", () => {
        expect(isValidFixedFee(500)).toBe(true);
        expect(isValidFixedFee(0)).toBe(true);
        expect(isValidFixedFee(-1)).toBe(false);
        expect(isValidFixedFee(Infinity)).toBe(false);
    });
});
