import { describe, it, expect } from "vitest";
import { sumarGanancias, partnerPorToken, generarTokenDePanel } from "@/services/affiliatePortal.service";

/**
 * Panel del partner con los dos programas (2026-10-06): referidos (afiliado) y
 * ventas directas (comercial) de la MISMA persona, reconocida por email, con la
 * sumatoria de lo ganado. Lo que se fija acá cuesta plata o datos si se rompe.
 */

describe("panel del partner · sumatoria de ganancias", () => {
    it("separa por programa y suma pendiente, pagado y ganado", () => {
        const t = sumarGanancias([
            { currency: "USD", beneficiary_type: "affiliate", status: "PENDING", monto: "10.0000" },
            { currency: "USD", beneficiary_type: "affiliate", status: "PAID", monto: "5.5000" },
            { currency: "USD", beneficiary_type: "sales_rep", status: "DUE", monto: "20.0000" },
            { currency: "USD", beneficiary_type: "sales_rep", status: "APPROVED", monto: "1.0000" },
            { currency: "USD", beneficiary_type: "sales_rep", status: "PAID", monto: "40.0000" },
        ]);
        expect(t).toEqual([{
            moneda: "USD",
            referidos: { pendiente: "10.00", pagado: "5.50", ganado: "15.50" },
            directo: { pendiente: "21.00", pagado: "40.00", ganado: "61.00" },
            total: { pendiente: "31.00", pagado: "45.50", ganado: "76.50" },
        }]);
    });

    it("lo revertido y lo cancelado no es ganancia", () => {
        const [t] = sumarGanancias([
            { currency: "USD", beneficiary_type: "affiliate", status: "PAID", monto: "10" },
            { currency: "USD", beneficiary_type: "affiliate", status: "REVERSED", monto: "99" },
            { currency: "USD", beneficiary_type: "sales_rep", status: "CANCELLED", monto: "99" },
        ]);
        expect(t.total.ganado).toBe("10.00");
    });

    it("no mezcla monedas: una fila por moneda, ordenadas", () => {
        const t = sumarGanancias([
            { currency: "USD", beneficiary_type: "affiliate", status: "PAID", monto: "1" },
            { currency: "ARS", beneficiary_type: "sales_rep", status: "PAID", monto: "1000" },
        ]);
        expect(t.map((x) => x.moneda)).toEqual(["ARS", "USD"]);
        expect(t[0].total.ganado).toBe("1000.00");
        expect(t[1].total.ganado).toBe("1.00");
    });

    it("suma con Decimal: 0,1 + 0,2 da 0,30 y no 0,30000000000000004", () => {
        const [t] = sumarGanancias([
            { currency: "USD", beneficiary_type: "affiliate", status: "PAID", monto: "0.1" },
            { currency: "USD", beneficiary_type: "affiliate", status: "PAID", monto: "0.2" },
        ]);
        expect(t.referidos.pagado).toBe("0.30");
    });
});

/** Ejecutor falso: responde en el orden en que el servicio hace las consultas. */
function ejecutorFalso(respuestas: any[]) {
    const vistas: string[] = [];
    let i = 0;
    return {
        vistas,
        ejecutor: {
            query: async (sql: string) => {
                vistas.push(sql.replace(/\s+/g, " ").trim());
                return [respuestas[i++] ?? [], []] as any;
            },
        } as any,
    };
}

describe("panel del partner · quién es la persona del enlace", () => {
    const { bruto } = generarTokenDePanel();
    const AFILIADO = { id: "af-1", name: "Ana", referral_code: "ana_dev", commission_pct: "15.00" };
    const COMERCIAL = { id: "rep-1", name: "Ana", commission_pct: "20.00" };

    it("un token con forma inválida no llega a la base", async () => {
        const { ejecutor, vistas } = ejecutorFalso([]);
        expect(await partnerPorToken("afp_live_corto", ejecutor)).toBeNull();
        expect(vistas).toHaveLength(0);
    });

    it("con el enlace del afiliado ve también lo que vendió como comercial (mismo email)", async () => {
        // por hash en Affiliates → UPDATE de último uso → afiliado por email → comercial por email
        const { ejecutor, vistas } = ejecutorFalso([[{ id: "af-1", email: "Ana@Partner.com" }], {}, [AFILIADO], [COMERCIAL]]);
        const p = await partnerPorToken(bruto, ejecutor);
        expect(p).toEqual({
            nombre: "Ana",
            afiliado: { id: "af-1", codigo: "ana_dev", pct: "15.00" },
            comercial: { id: "rep-1", pct: "20.00" },
        });
        expect(vistas.filter((v) => v.includes("LOWER(email) = ?"))).toHaveLength(2);
    });

    it("el enlace del comercial también sirve, aunque no sea afiliado", async () => {
        // no está en Affiliates por hash → sí en SalesReps → UPDATE → sin afiliado → comercial
        const { ejecutor, vistas } = ejecutorFalso([[], [{ id: "rep-1", email: "ana@partner.com" }], {}, [], [COMERCIAL]]);
        const p = await partnerPorToken(bruto, ejecutor);
        expect(p).toEqual({ nombre: "Ana", afiliado: null, comercial: { id: "rep-1", pct: "20.00" } });
        expect(vistas[2]).toContain("UPDATE SalesReps SET portal_token_last_used_at");
    });

    it("suspendido como afiliado: ve sus ventas directas, pero no sus referidos", async () => {
        // el token es del comercial; la búsqueda por email exige ACTIVE y no trae al afiliado
        const { ejecutor, vistas } = ejecutorFalso([[], [{ id: "rep-1", email: "ana@partner.com" }], {}, [], [COMERCIAL]]);
        const p = await partnerPorToken(bruto, ejecutor);
        expect(p?.afiliado).toBeNull();
        expect(vistas.filter((v) => v.includes("FROM Affiliates WHERE LOWER(email) = ? AND status = 'ACTIVE'"))).toHaveLength(1);
    });

    it("un token que no es de nadie activo no da panel", async () => {
        const { ejecutor } = ejecutorFalso([[], []]);
        expect(await partnerPorToken(bruto, ejecutor)).toBeNull();
    });
});
