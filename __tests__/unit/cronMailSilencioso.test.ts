// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Un cron que registra su resultado en `SystemCronRuns` no manda mail con un
 * helper que se traga la falla.
 *
 * `sendEmailAsync` envuelve todo el envio en un IIFE que NO se await-ea y cuyo
 * catch solo hace console. Un `await sendEmailAsync(...)` devuelve apenas
 * arranca el IIFE, asi que:
 *
 *   - si falta `AZURE_SENDER_EMAIL`, hace `return` y ya,
 *   - si el token o Graph fallan, el catch de adentro se lo come,
 *
 * y en los dos casos el cron sigue como si nada y registra `status: "ok"`. El
 * sistema era estructuralmente incapaz de decir que el mail no salio, que es
 * por que "verificar que la alerta de credenciales llegue" quedaba abierto de
 * un handoff al siguiente: no habia nada que mirar.
 *
 * Y no era solo invisible. En `credential-expiry-alerts` y `ttl-expiry-alerts`
 * el `UPDATE AlertRules SET last_triggered_at = NOW()` va DESPUES del envio,
 * dentro del mismo try. Con el envio silencioso, un mail que nunca salio
 * igual marcaba la regla como disparada, y `reminder_frequency_hours` tapaba
 * el reintento 24 horas. La alerta no se atrasaba: se perdia.
 * `focus-export-daily` era la misma forma anotando `sent: true`.
 *
 * Con `sendEmailStrict` la excepcion sube, el catch de cada iteracion la mete
 * en `errors[]`, el cron queda en `warning` y —lo que importa— el UPDATE no
 * corre, asi que la corrida siguiente reintenta.
 *
 * Fuera de alcance a proposito: `subscription-expiry` y `trial-expiry` mandan
 * fire-and-forget al lado de una transicion de estado que ya ocurrio, y no
 * llaman a `recordCronRun`. No tienen donde reportar la falla, asi que este
 * test no los mira. Si alguna vez se les agrega el tracker, van a caer aca
 * solos, que es lo que corresponde.
 */

const CRONS = "src/app/api/cron";

function rutas(dir: string): string[] {
    const salida: string[] = [];
    for (const entrada of readdirSync(dir)) {
        const p = join(dir, entrada);
        if (statSync(p).isDirectory()) salida.push(...rutas(p));
        else if (entrada === "route.ts") salida.push(p);
    }
    return salida;
}

/**
 * Se miden las LLAMADAS, no la prosa: los comentarios se sacan antes de buscar.
 * Un comentario que nombra el helper prohibido para explicar por qué NO se usa
 * es justo lo que se quiere fomentar, y con el grep crudo lo marcaba culpable —
 * el detector empujaba a documentar peor para pasar el test.
 */
function sinComentarios(fuente: string): string {
    return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("crons que reportan su resultado", () => {
    it("no mandan mail con el helper que se come la falla", () => {
        const culpables = rutas(CRONS).filter((p) => {
            const s = sinComentarios(readFileSync(p, "utf-8"));
            return s.includes("recordCronRun") && s.includes("sendEmailAsync");
        });
        expect(culpables).toEqual([]);
    });

    it("sendEmailStrict sigue propagando la falla", () => {
        // Si alguien le pone un try/catch de conveniencia adentro, los cuatro
        // crons de arriba vuelven a mentir en silencio y ningun test lo nota.
        const helper = readFileSync("src/lib/emailHelper.ts", "utf-8");
        const cuerpo = helper.slice(helper.indexOf("export async function sendEmailStrict"));
        const fin = cuerpo.indexOf("\nexport ", 1);
        const strict = fin === -1 ? cuerpo : cuerpo.slice(0, fin);

        expect(strict).toContain("throw new Error");
        expect(strict).not.toMatch(/\}\s*catch\s*\([^)]*\)\s*\{[^}]*console/);
    });
});
