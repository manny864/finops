import { describe, it, expect } from "vitest";
import {
    normalizarCodigo,
    calcularComision,
    atribuirReferido,
} from "@/services/affiliates.service";

/**
 * Programa de afiliados. Lo que se fija acá es lo que cuesta plata si se rompe:
 * el cálculo de la comisión y el guard de auto-referido.
 */

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

describe("afiliados · normalizarCodigo", () => {
    it("normaliza a minúsculas y recorta espacios", () => {
        expect(normalizarCodigo("  Carlos_Dev  ")).toBe("carlos_dev");
        expect(normalizarCodigo("PARTNER-01")).toBe("partner-01");
    });

    it("descarta lo que no es un código en vez de mandarlo a la consulta", () => {
        expect(normalizarCodigo("' OR 1=1 --")).toBeNull();
        expect(normalizarCodigo("con espacio")).toBeNull();
        expect(normalizarCodigo("-empieza-con-guion")).toBeNull();
        expect(normalizarCodigo("a".repeat(65)), "más largo que la columna").toBeNull();
        expect(normalizarCodigo("")).toBeNull();
        expect(normalizarCodigo(undefined)).toBeNull();
        expect(normalizarCodigo(42)).toBeNull();
    });
});

describe("afiliados · calcularComision", () => {
    it("calcula sobre el porcentaje que mysql2 devuelve como STRING", () => {
        // commission_pct llega "20.00", no 20: es una columna DECIMAL.
        expect(calcularComision("299.9900", "20.00")).toBe("59.9980");
        expect(calcularComision("999.9900", "15.50")).toBe("154.9985");
    });

    it("no usa floats: el caso que un parseFloat*pct/100 arruina", () => {
        // 0.1 + 0.2 en binario da 0.30000000000000004; con Decimal el redondeo
        // de la comisión es exacto a 4 decimales.
        expect(calcularComision("70.07", "33.33")).toBe("23.3543");
        expect(calcularComision("0.01", "20.00")).toBe("0.0020");
    });

    it("cero cuando la base o el porcentaje no aportan", () => {
        expect(calcularComision("0", "20.00")).toBe("0.0000");
        expect(calcularComision("299.99", "0.00")).toBe("0.0000");
        expect(calcularComision(null, "20.00")).toBe("0.0000");
        expect(calcularComision("-50.00", "20.00"), "un monto negativo no genera comisión").toBe("0.0000");
    });
});

describe("afiliados · atribuirReferido", () => {
    const AFILIADO = [{ id: "af-1", email: "Carlos@Partner.com", commission_pct: "20.00" }];

    it("atribuye el tenant cuando el código existe y no es auto-referido", async () => {
        const { ejecutor } = ejecutorFalso([AFILIADO, [], { affectedRows: 1 }]);
        const r = await atribuirReferido(ejecutor, "tenant-1", "carlos_dev", "cliente@empresa.com");
        expect(r).toEqual({ atribuido: true, affiliateId: "af-1" });
    });

    it("rechaza el auto-referido por el mail que verificó MSAL, sin fila en Users", async () => {
        // En el primer alta la fila de Users todavía no existe: si el guard sólo
        // mirara la tabla, este caso —el afiliado dándose de alta a sí mismo—
        // pasaría. La comparación es case-insensitive a los dos lados.
        const { ejecutor, vistas } = ejecutorFalso([AFILIADO, [], { affectedRows: 1 }]);
        const r = await atribuirReferido(ejecutor, "tenant-1", "carlos_dev", "CARLOS@partner.com");
        expect(r).toEqual({ atribuido: false, motivo: "auto-referido" });
        expect(vistas.some((s) => s.startsWith("INSERT IGNORE INTO AffiliateReferrals")),
            "no debe haber intentado insertar").toBe(false);
    });

    it("rechaza el auto-referido de alguien que ya es usuario del tenant", async () => {
        const { ejecutor } = ejecutorFalso([AFILIADO, [{ 1: 1 }], { affectedRows: 1 }]);
        const r = await atribuirReferido(ejecutor, "tenant-1", "carlos_dev", "otro@empresa.com");
        expect(r).toEqual({ atribuido: false, motivo: "auto-referido" });
    });

    it("código desconocido o inactivo no atribuye", async () => {
        const { ejecutor } = ejecutorFalso([[]]);
        const r = await atribuirReferido(ejecutor, "tenant-1", "no_existe", "cliente@empresa.com");
        expect(r).toEqual({ atribuido: false, motivo: "codigo-desconocido" });
    });

    it("primer toque gana: un tenant ya atribuido no se reasigna", async () => {
        // uq_referral_tenant hace que el INSERT IGNORE no afecte filas. Es lo que
        // permite llamar a esto en cada login sin robarle el referido a nadie.
        const { ejecutor } = ejecutorFalso([AFILIADO, [], { affectedRows: 0 }]);
        const r = await atribuirReferido(ejecutor, "tenant-1", "otro_socio", "cliente@empresa.com");
        expect(r).toEqual({ atribuido: false, motivo: "ya-atribuido" });
    });

    it("sin cookie no consulta nada", async () => {
        const { ejecutor, vistas } = ejecutorFalso([]);
        const r = await atribuirReferido(ejecutor, "tenant-1", "", "cliente@empresa.com");
        expect(r).toEqual({ atribuido: false, motivo: "sin-codigo" });
        expect(vistas).toEqual([]);
    });
});

describe("afiliados · edición", () => {
    it("sólo actualiza los campos presentes, y valida los que llegan", async () => {
        const { actualizarAfiliado } = await import("@/services/affiliates.service");
        // Sin campos no toca la base.
        await expect(actualizarAfiliado("af-1", {})).resolves.toEqual({ actualizado: false });
        // Validaciones: mismo criterio que el alta.
        await expect(actualizarAfiliado("af-1", { referralCode: "con espacio" })).rejects.toThrow(/código/i);
        await expect(actualizarAfiliado("af-1", { email: "no-es-mail" })).rejects.toThrow(/Email/i);
        await expect(actualizarAfiliado("af-1", { commissionPct: 0 })).rejects.toThrow(/entre 0 y 100/);
        await expect(actualizarAfiliado("af-1", { commissionPct: 101 })).rejects.toThrow(/entre 0 y 100/);
        await expect(actualizarAfiliado("af-1", { name: "   " })).rejects.toThrow(/nombre/i);
        await expect(actualizarAfiliado("af-1", { status: "RARO" as any })).rejects.toThrow(/Estado/i);
        await expect(actualizarAfiliado("", { name: "X" })).rejects.toThrow(/identificador/i);
    });
});
