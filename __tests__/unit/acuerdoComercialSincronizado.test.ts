import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";

vi.mock("@/modules/storage/db", () => ({ default: { query: vi.fn() } }));

import pool from "@/modules/storage/db";
import { pctDelAcuerdo } from "@/services/commissions.service";
import { updateCommercialDeal } from "@/services/superAdminTenants.service";

/**
 * El acuerdo comercial de un tenant es UNO y lo editan dos pantallas
 * (2026-10-06): Gestión de Tenants (el vendedor) y Comisiones (la atribución).
 * Lo que una escribe tiene que verse en la otra, y el comercial tiene que
 * cobrar su % aunque el tenant naciera como venta directa al 0 %.
 */

describe("acuerdo comercial · el % que cobra el comercial", () => {
    it("un acuerdo en 0 % con comercial asignado usa el % del comercial", () => {
        // sales_commission_percent es NOT NULL DEFAULT 0: con `??` esto daba "0.00".
        expect(pctDelAcuerdo("0.00", "20.00")).toBe("20.00");
    });
    it("si el acuerdo tiene su propio %, manda ese", () => {
        expect(pctDelAcuerdo("15.00", "20.00")).toBe("15.00");
    });
    it("sin % en ningún lado, el 20 % del programa", () => {
        expect(pctDelAcuerdo("0.00", null)).toBe("20");
        expect(pctDelAcuerdo(null, undefined)).toBe("20");
    });
});

describe("acuerdo comercial · el vendedor elegido en Gestión de Tenants", () => {
    const consultas = () => vi.mocked(pool.query).mock.calls.map(([sql, params]) => ({
        sql: String(sql).replace(/\s+/g, " "), params: params as any[],
    }));
    const insert = () => consultas().find((c) => c.sql.startsWith("INSERT INTO TenantCommercialDeals"))!;

    beforeEach(() => {
        vi.mocked(pool.query).mockReset();
    });

    it("con un comercial, el acuerdo toma su nombre, su % y el vínculo", async () => {
        vi.mocked(pool.query)
            .mockResolvedValueOnce([[{ name: "Juan Ventas", commission_pct: "20.00" }], []] as any)
            .mockResolvedValueOnce([{ affectedRows: 1 }, []] as any);
        await updateCommercialDeal({ tenantId: "t1", salesRepName: "lo que sea", salesRepId: "rep-1", salesCommissionPercent: 0 });
        const { params } = insert();
        // (id, tenant, nombre, sales_rep_id, %, sold_at, plazo, ¿tocar el vínculo?)
        expect(params[1]).toBe("t1");
        expect(params[2]).toBe("Juan Ventas");
        expect(params[3]).toBe("rep-1");
        expect(params[4]).toBe(20);
        expect(params[7]).toBe(1);
    });

    it("sin la clave salesRepId, editar el plazo no desasigna al comercial", async () => {
        vi.mocked(pool.query).mockResolvedValueOnce([{ affectedRows: 1 }, []] as any);
        await updateCommercialDeal({ tenantId: "t1", salesRepName: "Juan Ventas", salesCommissionPercent: 20, contractTerm: "annual" });
        expect(consultas().some((c) => c.sql.includes("FROM SalesReps"))).toBe(false);
        expect(insert().params[7]).toBe(0);
    });

    it("elegir 'sin comercial' saca el vínculo", async () => {
        vi.mocked(pool.query).mockResolvedValueOnce([{ affectedRows: 1 }, []] as any);
        await updateCommercialDeal({ tenantId: "t1", salesRepName: "Directo SuperAdmin", salesRepId: null, salesCommissionPercent: 0 });
        const { params } = insert();
        expect(params[3]).toBeNull();
        expect(params[7]).toBe(1);
    });

    it("un comercial que no existe no se guarda", async () => {
        vi.mocked(pool.query).mockResolvedValueOnce([[], []] as any);
        await expect(
            updateCommercialDeal({ tenantId: "t1", salesRepName: "x", salesRepId: "no-existe", salesCommissionPercent: 0 })
        ).rejects.toThrow("El comercial no existe.");
        expect(consultas().some((c) => c.sql.startsWith("INSERT"))).toBe(false);
    });
});

describe("acuerdo comercial · la atribución desde Comisiones", () => {
    it("assignRep escribe en el acuerdo el nombre y el % del comercial, no sólo el vínculo", () => {
        // Es lo que muestra Gestión de Tenants y lo que usa el devengo.
        const fuente = readFileSync("src/app/api/superadmin/commissions/route.ts", "utf8").replace(/\s+/g, " ");
        expect(fuente).toContain("SET sales_rep_id = ?, sales_rep_name = ?, sales_commission_percent = ? WHERE tenant_id = ?");
    });
});
