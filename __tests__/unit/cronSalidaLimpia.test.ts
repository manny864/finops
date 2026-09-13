// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "..", "..");
const tf = readFileSync(join(RAIZ, "infra/terraform/modules/cronjobs/main.tf"), "utf8");
/**
 * `terraform.tfvars` de prod queda fuera del repo (infra/.gitignore ignora
 * *.tfvars porque el archivo lleva secretos), asi que en CI no existe: los
 * asserts que dependen de el se saltan ahi y siguen corriendo en local, donde
 * es donde se edita la infra.
 */
const tfvarsProd = (() => {
    try {
        return readFileSync(join(RAIZ, "infra/terraform/environments/prod/terraform.tfvars"), "utf8");
    } catch {
        return null;
    }
})();
const conTfvars = tfvarsProd !== null ? it : it.skip;

const sinComentarios = (ruta: string) =>
    readFileSync(join(RAIZ, ruta), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

/**
 * Los jobs terminaban su trabajo y figuraban fallidos.
 *
 * Verificado sobre una ejecución concreta: `cron-power-schedules-29809970-zr2v2`
 * arrancó 08:50:00, logueó `{"status":200,"ms":107,"failed":0}` a los 21s, y
 * quedó `Failed` con `endTime: None`.
 *
 * Los cuatro afectados eran los más RÁPIDOS (107ms, 130ms). `process.exit()` es
 * inmediato: no espera a que stdout drene ni a que el runtime registre el código
 * de salida. En los lentos el pipe ya drenó para cuando se llama; en los de
 * 100ms, no.
 */
describe("salida limpia de los runners de cron", () => {
    it("los dos runners usan el helper, no process.exit directo", () => {
        // Se excluyen las líneas del propio helper, que sí lo usa como último recurso.
        const sinHelper = tf.replace(/const salir = \(code\) => \{[\s\S]*?\};/g, "");
        const directos = [...sinHelper.matchAll(/^\s*process\.exit\(/gm)];
        expect(directos.length, "quedó un process.exit() fuera del helper").toBe(0);
    });

    it("hay un helper por runner: son heredocs con scope JS separado", () => {
        const helpers = tf.match(/const salir = \(code\) => \{[\s\S]*?\};/g) || [];
        expect(helpers).toHaveLength(2);
        for (const h of helpers) expect(() => new Function(h)).not.toThrow();
    });

    it("el helper deja drenar y después fuerza", () => {
        const h = (tf.match(/const salir = \(code\) => \{[\s\S]*?\};/) || [""])[0];
        expect(h, "sin exitCode vuelve la salida abrupta").toContain("process.exitCode = code");
        // El guard es porque `fetch` (undici) mantiene sockets keep-alive: sin él
        // el proceso esperaría a que expiren.
        expect(h).toMatch(/setTimeout\(\(\) => process\.exit\(code\), 3000\)/);
        expect(h, "sin unref el timer mantiene vivo el loop y anula el arreglo").toContain("t.unref");
    });
});

/**
 * `prewarm-mysql-finops` — mismo techo de 240s que `anomaly-detection`.
 */
describe("contrato asíncrono de prewarm-mysql-finops", () => {
    const ruta = sinComentarios("src/app/api/cron/prewarm-mysql-finops/route.ts");

    it("responde al polling y dispara en background", () => {
        expect(ruta).toMatch(/searchParams\.get\("status"\) === "1"/);
        expect(ruta).toContain("launchPrewarm(startedAt");
        expect(ruta).toMatch(/status: 202/);
    });

    it("el barrido salió del handler", () => {
        expect(ruta).toContain("async function runPrewarmSweep(");
        expect(ruta, "el handler no puede volver a esperar el barrido inline")
            .not.toMatch(/for \(const tenant of tenants\)[\s\S]{0,500}status: "MySQL FinOps prewarm completed"/);
    });

    it("hay lock y se suelta pase lo que pase", () => {
        expect(ruta).toContain("tomarLock(JOB)");
        expect(ruta).toContain("already_running");
        expect(ruta).toMatch(/\.finally\([\s\S]{0,200}soltarLock\(JOB\)/);
    });

    it("reporta tenantsOk/tenantsTotal para el fix de falla parcial", () => {
        expect(ruta).toContain("tenantsTotal: results.length");
        expect(ruta).toContain("tenantsOk: okCount");
    });

    conTfvars("el timeout deja margen sobre el techo de 240s", () => {
        const m = tfvarsProd!.match(/prewarm-mysql-finops = \{[^}]*timeout_seconds = (\d+)[^}]*async_poll = true/);
        expect(m, "falta async_poll o el timeout").not.toBeNull();
        expect(Number(m![1]) - 30).toBeGreaterThan(240 * 2);
    });
});
