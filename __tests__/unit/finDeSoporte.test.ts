// @vitest-environment node
/**
 * MEJ-39 — el catálogo de fin de soporte y su regla principal.
 *
 * La regla: SIN DATO NO ES "SOPORTADO". El repo ya tiene el error cometido
 * (`getOpenShiftLifecycleStatus` devuelve "active_support" cuando no puede leer
 * la versión), así que esto lo fija antes de que se repita.
 */
import { describe, it, expect } from "vitest";
import {
    CATALOGO_DE_CICLO_DE_VIDA,
    CATALOGO_REVISADO_EL,
    evaluarCicloDeVida,
    familiaDeTipo,
    normalizar,
} from "@/lib/azureLifecycleCatalog";

const aks = familiaDeTipo("microsoft.containerservice/managedclusters")!;
const pg = familiaDeTipo("microsoft.dbforpostgresql/flexibleservers")!;
const mysql = familiaDeTipo("microsoft.dbformysql/flexibleservers")!;
const HOY = new Date("2026-09-27T12:00:00Z");

describe("sin dato no es soportado", () => {
    it("una versión ilegible queda en «sin-datos», no en «soportado»", () => {
        for (const v of [null, undefined, "", "   ", "unknown", "N/A"]) {
            const r = evaluarCicloDeVida(aks, v, HOY);
            expect(r.ventana).toBe("sin-datos");
            expect(r.motivo).toBeTruthy();
        }
    });

    it("una versión POSTERIOR al catálogo también: el viejo es el catálogo", () => {
        const r = evaluarCicloDeVida(aks, "1.99", HOY);
        expect(r.ventana).toBe("sin-datos");
        expect(r.motivo).toContain(CATALOGO_REVISADO_EL);
        // Y no se inventa una fecha.
        expect(r.finDeSoporte).toBeNull();
    });

    it("una versión anterior a la más vieja publicada sí es «retirado»", () => {
        // Para estas familias la fuente ya incluye las vencidas, así que estar
        // por debajo no es una laguna: es estar afuera hace rato.
        expect(evaluarCicloDeVida(aks, "1.28", HOY).ventana).toBe("retirado");
        expect(evaluarCicloDeVida(pg, "9", HOY).ventana).toBe("retirado");
    });
});

describe("el semáforo", () => {
    it.each([
        ["1.32", "retirado"],   // venció 2026-03-31
        ["1.34", "critico"],    // 2026-11-30 → 64 días
        ["1.35", "proximo"],    // 2027-03-31 → ~185 días
        ["1.37", "soportado"],  // 2027-10-31 → >365 días
    ])("AKS %s → %s", (version, esperado) => {
        expect(evaluarCicloDeVida(aks, version, HOY).ventana).toBe(esperado);
    });

    it("los días restantes son negativos cuando ya venció", () => {
        const r = evaluarCicloDeVida(aks, "1.32", HOY);
        expect(r.diasRestantes).toBeLessThan(0);
    });

    it("el borde de 90 días cae del lado crítico, y el de 91 del próximo", () => {
        // 1.34 vence 2026-11-30T23:59:59Z. Desde el 2 de septiembre quedan
        // exactamente 90 días; desde el 1, 91.
        expect(evaluarCicloDeVida(aks, "1.34", new Date("2026-09-02T00:00:00Z")).ventana).toBe("critico");
        expect(evaluarCicloDeVida(aks, "1.34", new Date("2026-09-01T00:00:00Z")).ventana).toBe("proximo");
    });
});

describe("la granularidad, que NO es la misma entre productos", () => {
    // Verificado contra Azure: MySQL devuelve "8.0.21" y PostgreSQL "14".
    // Comparar la cadena cruda contra el catálogo fallaría en uno de los dos.
    it("MySQL informa la versión completa y se indexa por major.minor", () => {
        const r = evaluarCicloDeVida(mysql, "8.0.21", HOY);
        expect(r.version).toBe("8.0");
        expect(r.finDeSoporte).toBe("2027-01-31");
    });

    it("PostgreSQL informa sólo la mayor", () => {
        expect(evaluarCicloDeVida(pg, "14", HOY).version).toBe("14");
    });

    it("AKS admite <major.minor> sin patch, y con patch da lo mismo", () => {
        expect(evaluarCicloDeVida(aks, "1.34", HOY).version).toBe("1.34");
        expect(evaluarCicloDeVida(aks, "1.34.7", HOY).version).toBe("1.34");
        expect(evaluarCicloDeVida(aks, "v1.34.7", HOY).version).toBe("1.34");
    });

    it("normalizar descarta lo que no sea numérico en vez de inventar", () => {
        expect(normalizar("no-es-una-version", "major")).toBeNull();
        expect(normalizar("8.0.21", "major")).toBe("8");
    });
});

describe("el soporte extendido, que es la mitad del argumento de costo", () => {
    it("MySQL 5.7 informa hasta cuándo se puede pagar por seguir", () => {
        // Al 2026-09-27T12:00Z le quedan 3 días y medio: crítico, no retirado.
        // `diasRestantes` redondea hacia ARRIBA (4) a propósito: todavía queda
        // parte de hoy, y decir 3 adelantaría el vencimiento medio día.
        const r = evaluarCicloDeVida(mysql, "5.7", HOY);
        expect(r.ventana).toBe("critico");
        expect(r.diasRestantes).toBe(4);
        expect(r.finExtendido).toBe("2029-03-31");
        expect(r.nota).toContain("extendido");
    });

    it("y pasado el 30 de septiembre queda retirado, con el extendido en pie", () => {
        const r = evaluarCicloDeVida(mysql, "5.7", new Date("2026-10-15T00:00:00Z"));
        expect(r.ventana).toBe("retirado");
        expect(r.finExtendido).toBe("2029-03-31");
    });

    it("una familia sin soporte extendido no lo inventa", () => {
        expect(evaluarCicloDeVida(aks, "1.34", HOY).finExtendido).toBeNull();
    });
});

describe("la comparación de versiones es numérica, no alfabética", () => {
    it("1.9 es MENOR que 1.10, que como cadena sería al revés", () => {
        // Con comparación de cadenas "1.9" > "1.10" y una 1.9 se vería vigente.
        expect(evaluarCicloDeVida(aks, "1.9", HOY).ventana).toBe("retirado");
    });
});

describe("el catálogo es auditable", () => {
    it("cada familia declara de dónde salieron sus fechas", () => {
        for (const f of CATALOGO_DE_CICLO_DE_VIDA) {
            expect(f.fuente).toMatch(/^https:\/\/learn\.microsoft\.com\//);
            expect(f.escalones.length).toBeGreaterThan(0);
        }
    });

    it("toda fecha es ISO y parseable: un «Mar 2026» suelto sería ambiguo", () => {
        for (const f of CATALOGO_DE_CICLO_DE_VIDA) {
            for (const e of f.escalones) {
                expect(e.finDeSoporte).toMatch(/^\d{4}-\d{2}-\d{2}$/);
                expect(Number.isNaN(Date.parse(e.finDeSoporte))).toBe(false);
                if (e.finExtendido) expect(e.finExtendido > e.finDeSoporte).toBe(true);
            }
        }
    });

    it("no está `microsoft.sql/servers`: su version es siempre 12.0 y no significa nada", () => {
        expect(familiaDeTipo("microsoft.sql/servers")).toBeUndefined();
    });
});
