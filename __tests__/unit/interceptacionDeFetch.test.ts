import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";

/**
 * `TenantProvider` parchea `window.fetch` y, para los tenants demo, contesta
 * varias rutas con datos de `mockData.ts` sin dejar que la llamada salga.
 *
 * EL DEFECTO QUE ESTO VIGILA no es la interceptación en sí: es que la ruta
 * interceptada YA tenga su propia rama mock y que las dos formas se separen.
 * Cuando pasa, el panel recibe un payload con otras claves, lee `undefined` en
 * todo y pinta ceros — con el badge de "Demo Sandbox" puesto, que es lo que lo
 * vuelve tan difícil de diagnosticar: la pantalla afirma estar en modo demo.
 *
 * Ya ocurrió dos veces:
 *   - el modal de COIN, que mostraba "0 de 0" recomendaciones;
 *   - `/api/intelligence/unit-economics`, que devolvía `{success, mock, data}`
 *     en vez de `{summary, config, series, remediations}`, así que Advanced
 *     Analytics salía en $0.00 con volumen 0.
 *
 * En los dos casos la cura fue la misma: sacar la interceptación y dejar que la
 * ruta conteste, porque su rama mock es la que está al día con lo que el panel
 * lee.
 *
 * Este test NO compara formas — eso pediría ejecutar las dos ramas de cada
 * ruta. Congela el número: la deuda no puede crecer. Si agregás una
 * interceptación sobre una ruta que ya resuelve su propio mock, el test falla y
 * te obliga a justificarla o a no agregarla.
 */

const PROVIDER = "src/components/TenantProvider.tsx";

/**
 * Interceptaciones que pisan una ruta con rama mock propia.
 *
 * Bajar este número es progreso: significa que una interceptación redundante se
 * fue y la ruta quedó como única fuente. Subirlo es deuda nueva.
 */
const TOPE_REDUNDANTES = 71;

function rutasInterceptadas(): string[] {
    const src = readFileSync(PROVIDER, "utf8");
    const rutas = [...src.matchAll(/url\.includes\('(\/api\/[^']+)'\)/g)].map((m) => m[1]);
    return [...new Set(rutas)];
}

function tieneRamaMockPropia(ruta: string): boolean {
    const archivo = `src/app${ruta}/route.ts`;
    if (!existsSync(archivo)) return false;
    return readFileSync(archivo, "utf8").includes("isMockTenant");
}

describe("interceptación de fetch en TenantProvider", () => {
    const interceptadas = rutasInterceptadas();
    const redundantes = interceptadas.filter(tieneRamaMockPropia);

    it("el escaneo encuentra las interceptaciones", () => {
        // Red de seguridad: si la regex deja de matchear, el conteo se desploma
        // y el ratchet pasaría vacío dando falsa tranquilidad.
        expect(interceptadas.length).toBeGreaterThan(80);
    });

    it(`las interceptaciones sobre rutas con mock propio no crecen (tope ${TOPE_REDUNDANTES})`, () => {
        const detalle = redundantes.map((r) => `  ${r}`).join("\n");
        expect(
            redundantes.length,
            redundantes.length > TOPE_REDUNDANTES
                ? `\nSubió a ${redundantes.length}. La ruta nueva ya resuelve su propio mock:\n` +
                  `interceptarla arriesga que las dos formas se separen y el panel lea undefined.\n${detalle}\n`
                : ""
        ).toBeLessThanOrEqual(TOPE_REDUNDANTES);

        if (redundantes.length < TOPE_REDUNDANTES) {
            throw new Error(
                `Bajó de ${TOPE_REDUNDANTES} a ${redundantes.length}: bajá TOPE_REDUNDANTES. ` +
                `Sin eso el ratchet deja volver a subir lo que acabás de limpiar.`
            );
        }
    });

    it("unit-economics ya no se intercepta", () => {
        // El caso que destapó todo esto: su rama mock en la ruta devuelve el
        // payload que el panel lee, y la interceptación devolvía otro.
        expect(interceptadas).not.toContain("/api/intelligence/unit-economics");
    });
});
