// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({
    default: { query: (...a: unknown[]) => queryMock(...a) },
    initializeDatabase: vi.fn(async () => {}),
}));

import { normalizeSoldAt, updateCommercialDeal } from "@/services/superAdminTenants.service";

/**
 * La fecha de venta es el arranque del devengamiento de comisiones (MEJ-14):
 * moverla recalcula plata ya liquidada, e inventarla produce un número que
 * parece un dato y no lo es.
 */
describe("fecha de venta", () => {
    it("acepta una fecha ISO de día", () => {
        expect(normalizeSoldAt("2026-09-13")).toBe("2026-09-13");
    });

    it("rechaza lo que no sea YYYY-MM-DD", () => {
        for (const v of ["13/09/2026", "2026-9-13", "2026-09-13T10:00:00Z", "ayer", "", null, undefined]) {
            expect(normalizeSoldAt(v as string), String(v)).toBeNull();
        }
    });

    it("rechaza un día que no existe en vez de correrlo al mes siguiente", () => {
        // `new Date("2026-02-31")` no falla: devuelve el 3 de marzo. Sin el
        // round-trip, una venta cargada mal quedaría con fecha de otro mes.
        expect(normalizeSoldAt("2026-02-31")).toBeNull();
        expect(normalizeSoldAt("2026-13-01")).toBeNull();
        expect(normalizeSoldAt("2026-02-28")).toBe("2026-02-28");
    });
});

describe("updateCommercialDeal", () => {
    beforeEach(() => { queryMock.mockReset(); queryMock.mockResolvedValue([{}]); });

    it("NO pisa la fecha de venta al editar vendedor o comisión", async () => {
        await updateCommercialDeal({
            tenantId: "t1", salesRepName: "Ana", salesCommissionPercent: 20,
        });
        const sql = String(queryMock.mock.calls[0][0]);
        // El COALESCE es lo que impide correr el inicio del devengamiento.
        expect(sql).toContain("sold_at = COALESCE(TenantCommercialDeals.sold_at, VALUES(sold_at))");
        expect(sql).not.toMatch(/sold_at = VALUES\(sold_at\)\s*,/);
    });

    it("el plazo sí se puede corregir", async () => {
        await updateCommercialDeal({
            tenantId: "t1", salesRepName: "Ana", salesCommissionPercent: 20, contractTerm: "annual",
        });
        const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
        expect(String(sql)).toContain("contract_term = VALUES(contract_term)");
        expect(params).toContain("annual");
    });

    it("un plazo desconocido cae a mensual y no llega crudo a MySQL", async () => {
        await updateCommercialDeal({
            tenantId: "t1", salesRepName: "Ana", salesCommissionPercent: 20,
            contractTerm: "trimestral" as never,
        });
        const params = queryMock.mock.calls[0][1] as unknown[];
        expect(params).toContain("monthly");
        expect(params).not.toContain("trimestral");
    });

    it("sin fecha indicada registra la de hoy, no NULL", async () => {
        await updateCommercialDeal({ tenantId: "t1", salesRepName: "Ana", salesCommissionPercent: 20 });
        const params = queryMock.mock.calls[0][1] as unknown[];
        expect(params.some((p) => /^\d{4}-\d{2}-\d{2}$/.test(String(p)))).toBe(true);
    });

    it("una fecha basura no se propaga: cae a hoy", async () => {
        await updateCommercialDeal({
            tenantId: "t1", salesRepName: "Ana", salesCommissionPercent: 20, soldAt: "31/12/2026",
        });
        const params = queryMock.mock.calls[0][1] as unknown[];
        expect(params).not.toContain("31/12/2026");
    });
});
