// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

/**
 * Ningun mensaje envuelve un placeholder entre apostrofos.
 *
 * **En ICU MessageFormat el apostrofo es el caracter de ESCAPE.** Escribir
 *
 *     Resource '{name}' runs in production
 *
 * para citar el nombre del recurso no lo cita: le dice a ICU que `{name}` es
 * texto literal. El usuario ve, literalmente, `Resource {name} runs in
 * production`. No hay error, no hay warning, y el resto del mensaje interpola
 * bien — que es lo que lo hace dificil de ver: en la misma frase `${cost}`
 * mostraba 810 y `{name}` mostraba "{name}".
 *
 * Se encontro al verificar el modal de MongoDB. El barrido sobre los tres
 * catalogos devolvio 8 mensajes, y **dos no eran nuevos**:
 * `Budgets.remediation_2_desc` y `SuperAdminOps.triggerSuccess` venian
 * mostrando su placeholder literal desde antes de este cambio.
 *
 * La forma correcta de citar es con comillas dobles, que ICU no interpreta.
 * (Un apostrofo literal en el texto se escribe duplicado: `''`.)
 */
const PLACEHOLDER_ESCAPADO = /'\{[A-Za-z0-9_]+\}'/;

const LOCALES = ["es", "en", "pt-BR"] as const;

function recorrer(obj: unknown, ruta: string, salida: string[]): void {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            recorrer(v, ruta ? `${ruta}.${k}` : k, salida);
        }
    } else if (typeof obj === "string" && PLACEHOLDER_ESCAPADO.test(obj)) {
        salida.push(ruta);
    }
}

describe("escapado de ICU en los catálogos", () => {
    for (const loc of LOCALES) {
        it(`${loc}: ningún placeholder queda escapado entre apóstrofos`, () => {
            const catalogo = JSON.parse(readFileSync(`messages/${loc}.json`, "utf-8"));
            const infractores: string[] = [];
            recorrer(catalogo, "", infractores);
            expect(infractores).toEqual([]);
        });
    }
});
