// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "..", "..");
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
 * `anomaly-detection` implementa el contrato asíncrono.
 *
 * Fallaba con `504 stream timeout` a los 240088 ms — el techo de ~240s del
 * ingress de Container Apps, que no es configurable. 100 de 200 ejecuciones en
 * rojo, con el job corriendo cada 5 minutos, aunque el barrido terminara bien
 * del lado del servidor.
 *
 * `async_poll = true` por sí solo NO alcanzaba: el runner sondea `?status=1` y
 * espera un `done`, y la ruta no implementaba nada de eso. Poner el flag sin
 * portar el contrato la habría roto en vez de arreglarla.
 */
describe("contrato asíncrono de anomaly-detection", () => {
    const ruta = sinComentarios("src/app/api/cron/anomaly-detection/route.ts");

    it("responde al polling de estado", () => {
        expect(ruta).toMatch(/searchParams\.get\("status"\) === "1"/);
        expect(ruta).toContain("readStatus()");
    });

    it("dispara en background y responde 202, no espera el barrido", () => {
        expect(ruta).toContain("launchAnomalySweep(startedAt");
        expect(ruta).toMatch(/status: 202/);
        expect(ruta, "el GET no puede volver a esperar el barrido inline")
            .not.toMatch(/for \(const t of tenants\)[\s\S]{0,400}return NextResponse\.json\(response\)/);
    });

    it("hay lock: el job corre cada 5 min y el barrido puede tardar más", () => {
        // Sin lock se pisarían y multiplicarían la carga sobre Cost Management,
        // que es justo lo que los hace lentos.
        expect(ruta).toContain("LOCK_KEY");
        expect(ruta).toMatch(/"NX"/);
        expect(ruta).toContain("already_running");
    });

    it("el lock se suelta pase lo que pase", () => {
        expect(ruta).toMatch(/\.finally\(async \(\) => \{[\s\S]{0,200}redis\.del\(LOCK_KEY\)/);
    });

    it("reporta tenantsOk/tenantsTotal para que el runner distinga parcial de fallido", () => {
        expect(ruta).toMatch(/tenantsOk,?\s*$/m);
        expect(ruta).toContain("tenantsTotal: r.evaluated");
    });

    conTfvars("el timeout deja margen sobre el techo de 240s", () => {
        // El runner sondea hasta timeout-30s: con 300 habría cortado a los 270,
        // apenas por encima del mismo techo que estamos evitando.
        const m = tfvarsProd!.match(/anomaly-detection = \{[^}]*timeout_seconds = (\d+)/);
        expect(m, "no encontré la config de anomaly-detection").not.toBeNull();
        expect(Number(m![1]) - 30).toBeGreaterThan(240 * 2);
    });

    conTfvars("async_poll está activado", () => {
        expect(tfvarsProd!).toMatch(/anomaly-detection = \{[^}]*async_poll = true/);
    });
});
