// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));

import {
    devengarComisionComercial,
    cancelarComisionesPorChurn,
    calcularMonto,
    sumarMeses,
    fechaSql,
    CUOTAS_MENSUALES,
} from "@/services/commissions.service";

const TENANT = "t1";
const REP = "rep-1";

/** El acuerdo comercial que devuelve `leerDeal`. */
const deal = (over: Record<string, unknown> = {}) => [[{
    sales_rep_id: REP,
    sales_commission_percent: "20.00",
    sold_at: "2026-01-15",
    contract_term: "monthly",
    rep_pct: "20.00",
    rep_status: "ACTIVE",
    ...over,
}]];

const conCuotasPrevias = (n: number) => [[{ n }]];

beforeEach(() => queryMock.mockReset());

describe("calculo del monto", () => {
    it("mantiene la precision decimal", () => {
        expect(calcularMonto("299.99", "20.00")).toBe("59.9980");
        expect(calcularMonto("0", "20")).toBe("0.0000");
        expect(calcularMonto("100", "0")).toBe("0.0000");
    });

    // La propiedad que justifica el atajo del calculo: 12 cuotas de 20% del
    // cobro mensual SON el 20% del valor anual. Si esto deja de cumplirse, el
    // comercial cobra de mas o de menos sobre el total del contrato.
    it("doce cuotas mensuales suman el 20% del valor anual", () => {
        const mensual = "299.99";
        const cuota = calcularMonto(mensual, "20");
        const docecuotas = new Decimal(cuota).times(CUOTAS_MENSUALES);
        const veintePorCientoAnual = new Decimal(mensual).times(12).times(0.2);
        expect(docecuotas.toFixed(4)).toBe(veintePorCientoAnual.toDecimalPlaces(4).toFixed(4));
    });
});

describe("vencimiento", () => {
    // setMonth desborda: 31 de enero + 1 mes daria 2 o 3 de marzo, y un
    // vencimiento en el mes equivocado adelanta un pago.
    it("no desborda al sumar meses", () => {
        expect(fechaSql(sumarMeses(new Date("2026-01-31T00:00:00Z"), 1))).toBe("2026-02-28");
        expect(fechaSql(sumarMeses(new Date("2028-01-31T00:00:00Z"), 1))).toBe("2028-02-29");
        expect(fechaSql(sumarMeses(new Date("2026-01-15T00:00:00Z"), 2))).toBe("2026-03-15");
    });
});

describe("venta con pago mensual", () => {
    const cobro = { tenantId: TENANT, transactionId: "txn_1", baseAmount: "100.00", currency: "USD", billedAt: new Date("2026-03-20T10:00:00Z") };

    it("la primera cuota vence recien tras la retencion, no con el cobro", async () => {
        queryMock
            .mockResolvedValueOnce(deal())
            .mockResolvedValueOnce(conCuotasPrevias(0))
            .mockResolvedValueOnce([{ affectedRows: 1 }]);

        const res = await devengarComisionComercial({ ...cobro, billedAt: new Date("2026-01-20T10:00:00Z") });

        expect(res.devengada).toBe(true);
        expect(res.cuota).toBe(1);
        expect(res.monto).toBe("20.0000");
        const args = queryMock.mock.calls[2][1] as unknown[];
        // sold_at 2026-01-15 + 2 meses de retencion
        expect(args[args.length - 1]).toBe("2026-03-15");
    });

    it("de la tercera en adelante es exigible con su propio cobro", async () => {
        queryMock
            .mockResolvedValueOnce(deal())
            .mockResolvedValueOnce(conCuotasPrevias(2))
            .mockResolvedValueOnce([{ affectedRows: 1 }]);

        const res = await devengarComisionComercial(cobro);

        expect(res.cuota).toBe(3);
        const args = queryMock.mock.calls[2][1] as unknown[];
        expect(args[args.length - 1]).toBe("2026-03-20");
    });

    it("el mes 13 no devenga: el 20% anualizado ya esta completo", async () => {
        queryMock
            .mockResolvedValueOnce(deal())
            .mockResolvedValueOnce(conCuotasPrevias(12));

        const res = await devengarComisionComercial(cobro);

        expect(res.devengada).toBe(false);
        expect(res.motivo).toBe("comision-anualizada-completa");
        expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("INSERT"))).toBe(false);
    });
});

describe("venta con pago anual", () => {
    it("una sola cuota, exigible desde el 2do mes", async () => {
        queryMock
            .mockResolvedValueOnce(deal({ contract_term: "annual" }))
            .mockResolvedValueOnce(conCuotasPrevias(0))
            .mockResolvedValueOnce([{ affectedRows: 1 }]);

        const res = await devengarComisionComercial({
            tenantId: TENANT, transactionId: "txn_anual", baseAmount: "3167.88", currency: "USD",
            billedAt: new Date("2026-01-15T10:00:00Z"),
        });

        expect(res.devengada).toBe(true);
        expect(res.monto).toBe("633.5760");
        const args = queryMock.mock.calls[2][1] as unknown[];
        expect(args).toContain(1);   // installment_number
        expect(args[args.length - 1]).toBe("2026-03-15");
    });

    // "Por unica vez": la renovacion del año siguiente no vuelve a pagar el 20%.
    it("la renovacion no paga otra vez", async () => {
        queryMock
            .mockResolvedValueOnce(deal({ contract_term: "annual" }))
            .mockResolvedValueOnce(conCuotasPrevias(1));

        const res = await devengarComisionComercial({
            tenantId: TENANT, transactionId: "txn_renovacion", baseAmount: "3167.88", currency: "USD",
        });

        expect(res.devengada).toBe(false);
        expect(res.motivo).toBe("comision-anualizada-completa");
    });
});

describe("cuando NO se devenga", () => {
    it("sin fecha de venta no se inventa desde cuando", async () => {
        queryMock.mockResolvedValueOnce(deal({ sold_at: null }));
        const res = await devengarComisionComercial({ tenantId: TENANT, transactionId: "t", baseAmount: "100", currency: "USD" });
        expect(res.motivo).toBe("venta-sin-fecha");
    });

    it("sin comercial asignado la venta es directa", async () => {
        queryMock.mockResolvedValueOnce(deal({ sales_rep_id: null }));
        const res = await devengarComisionComercial({ tenantId: TENANT, transactionId: "t", baseAmount: "100", currency: "USD" });
        expect(res.motivo).toBe("sin-comercial-asignado");
    });

    it("un comercial suspendido no sigue devengando", async () => {
        queryMock.mockResolvedValueOnce(deal({ rep_status: "SUSPENDED" }));
        const res = await devengarComisionComercial({ tenantId: TENANT, transactionId: "t", baseAmount: "100", currency: "USD" });
        expect(res.motivo).toBe("comercial-no-activo");
    });

    it("un fallo de base no rompe el webhook del cobro", async () => {
        queryMock.mockRejectedValueOnce(new Error("db caida"));
        const res = await devengarComisionComercial({ tenantId: TENANT, transactionId: "t", baseAmount: "100", currency: "USD" });
        expect(res).toEqual({ devengada: false, motivo: "error" });
    });
});

describe("churn", () => {
    // Se detienen las cuotas futuras sin saldos negativos retroactivos: lo ya
    // exigible o pagado no se toca.
    it("cancela solo lo que todavia no era exigible", async () => {
        queryMock.mockResolvedValueOnce([{ affectedRows: 3 }]);

        const res = await cancelarComisionesPorChurn(TENANT);

        expect(res.canceladas).toBe(3);
        const sql = String(queryMock.mock.calls[0][0]);
        expect(sql).toContain("status = 'PENDING'");
        expect(sql).not.toContain("'PAID'");
        expect(sql).toContain("beneficiary_type = 'sales_rep'");
    });
});
