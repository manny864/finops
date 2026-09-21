// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));

import { devengarComisionComercial } from "@/services/commissions.service";
import { revertirComision } from "@/services/affiliates.service";

/**
 * Auditoría de los caminos de plata, 2026-09-21 (docs/security/audit-2026-09-21.md).
 *
 * Dos agujeros del libro de comisiones, en direcciones opuestas: uno le pagaba
 * de más a un comercial sobre plata devuelta, el otro le dejaba de pagar para
 * siempre a un comercial cuyo tenant se dio de baja y volvió.
 */

const TENANT = "t1";
const REP = "rep-1";

const deal = (over: Record<string, unknown> = {}) => [[{
    sales_rep_id: REP,
    sales_commission_percent: "20.00",
    sold_at: "2026-01-15",
    contract_term: "monthly",
    rep_pct: "20.00",
    rep_status: "ACTIVE",
    ...over,
}]];

/** Lo que devuelve el SELECT de la última cuota usada. */
const ultimaCuota = (n: number) => [[{ ultima: n }]];

const cobro = {
    tenantId: TENANT,
    transactionId: "txn-9",
    subscriptionId: "sub-1",
    baseAmount: "100.00",
    currency: "USD",
    billedAt: new Date("2026-06-10T00:00:00Z"),
};

beforeEach(() => queryMock.mockReset());

describe("FIN-01 — un reembolso revierte TODO el libro, no sólo al afiliado", () => {
    it("no filtra por beneficiary_type", async () => {
        queryMock.mockResolvedValueOnce([{ affectedRows: 2 }]);

        const r = await revertirComision("txn-9");

        expect(r.revertidas).toBe(2);
        const sql = String(queryMock.mock.calls[0][0]);
        // El filtro por tipo era el bug: dejaba viva la cuota del comercial
        // mientras la casa ya le habia devuelto la plata al cliente.
        expect(sql).not.toMatch(/beneficiary_type\s*=\s*'affiliate'/);
        expect(sql).toMatch(/paddle_transaction_id\s*=\s*\?/);
    });

    it("no toca lo ya pagado: eso es una decision contable", async () => {
        queryMock.mockResolvedValueOnce([{ affectedRows: 0 }]);
        await revertirComision("txn-9");
        const sql = String(queryMock.mock.calls[0][0]);
        expect(sql).toMatch(/status IN \('PENDING', 'DUE', 'APPROVED'\)/);
        expect(sql).not.toContain("'PAID'");
    });
});

describe("FIN-02 — el tenant que se da de baja y vuelve sigue devengando", () => {
    it("numera desde la ultima cuota USADA, aunque este cancelada", async () => {
        // Cuotas 1-3 existentes, la 3 CANCELLED por churn. Con el conteo de
        // vivas esto daba 2 y volvia a intentar la 3, que choca con la cancelada
        // en uq_commission_installment y se pierde en silencio, para siempre.
        queryMock
            .mockResolvedValueOnce(deal())
            .mockResolvedValueOnce(ultimaCuota(3))
            .mockResolvedValueOnce([{ affectedRows: 1 }]);

        const r = await devengarComisionComercial(cobro);

        expect(r.devengada).toBe(true);
        expect(r.cuota).toBe(4);
    });

    it("la consulta pregunta por el MAX y no cuenta filas vivas", async () => {
        queryMock
            .mockResolvedValueOnce(deal())
            .mockResolvedValueOnce(ultimaCuota(0))
            .mockResolvedValueOnce([{ affectedRows: 1 }]);

        await devengarComisionComercial(cobro);

        const sql = String(queryMock.mock.calls[1][0]);
        expect(sql).toMatch(/MAX\(installment_number\)/);
        // Excluir las canceladas es justamente lo que reciclaba el numero.
        expect(sql).not.toMatch(/status\s*<>\s*'CANCELLED'/);
    });

    it("sigue cortando en la cuota 12", async () => {
        queryMock.mockResolvedValueOnce(deal()).mockResolvedValueOnce(ultimaCuota(12));

        const r = await devengarComisionComercial(cobro);

        expect(r.devengada).toBe(false);
        expect(r.motivo).toBe("comision-anualizada-completa");
    });

    it("el contrato anual sigue devengando una sola vez", async () => {
        queryMock
            .mockResolvedValueOnce(deal({ contract_term: "annual" }))
            .mockResolvedValueOnce(ultimaCuota(1));

        const r = await devengarComisionComercial(cobro);

        expect(r.devengada).toBe(false);
        expect(r.motivo).toBe("comision-anualizada-completa");
    });
});
