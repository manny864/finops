// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

/**
 * Las plantillas de CI y el script tienen que hablar el mismo idioma: una variable que la
 * plantilla pasa y el script no lee se pierde sin ningún error (el CI no se queja de una
 * variable de entorno que nadie usa), y el síntoma es una función que "no hace nada".
 */
const yaml = createRequire(import.meta.url)("js-yaml") as { load: (s: string) => any };
const leer = (p: string) => readFileSync(p, "utf8");
const SCRIPT = leer("public/integrations/shift-left/finops-estimate.sh");
const PLANTILLAS = {
    github: "integrations/github-action/action.yml",
    azuredevops: "integrations/azure-devops/finops-shift-left.yml",
    gitlab: "integrations/gitlab-ci/finops-shift-left.yml",
};

/** Variables que la plantilla usa para sí misma (el hash esperado) y no las lee el script. */
const PROPIAS = new Set(["FINOPS_SCRIPT_SHA256", "SCRIPT_SHA256", "FINOPS_API_KEY_"]);

describe("las plantillas de CI", () => {
    for (const [nombre, ruta] of Object.entries(PLANTILLAS)) {
        it(`${nombre}: es YAML válido`, () => {
            expect(() => yaml.load(leer(ruta))).not.toThrow();
        });

        it(`${nombre}: toda variable FINOPS_* que pasa la lee el script`, () => {
            const usadas = new Set([...leer(ruta).matchAll(/\b(FINOPS_[A-Z_]+)\b/g)].map((m) => m[1]));
            expect(usadas.size).toBeGreaterThan(3);
            for (const v of usadas) {
                if (PROPIAS.has(v)) continue;
                expect(SCRIPT, `${nombre} pasa ${v} y el script no la lee`).toContain(v);
            }
        });

        it(`${nombre}: descarga el script de la ruta que la plataforma sirve`, () => {
            expect(leer(ruta)).toContain("/integrations/shift-left/finops-estimate.sh");
        });

        it(`${nombre}: verifica el hash cuando se le da uno, antes de ejecutar`, () => {
            const t = leer(ruta);
            expect(t).toContain("sha256sum -c -");
            expect(t.indexOf("sha256sum -c -")).toBeLessThan(t.lastIndexOf("bash finops-estimate.sh") === -1 ? t.indexOf('bash "$script"') : t.lastIndexOf("bash finops-estimate.sh"));
        });
    }

    it("la Action expone las cuatro salidas que el script escribe en GITHUB_OUTPUT", () => {
        const action = yaml.load(leer(PLANTILLAS.github));
        for (const [salida, clave] of [["delta-usd", "delta"], ["projected-usd", "projected"], ["unpriced", "unpriced"], ["gate-status", "gate"]]) {
            expect(action.outputs[salida].value).toBe("${{ steps.estimar.outputs." + clave + " }}");
            expect(SCRIPT).toContain(`echo "${clave}=`);
        }
    });

    it("la Action pasa el token de GitHub y el contexto del PR que el script espera", () => {
        const env = yaml.load(leer(PLANTILLAS.github)).runs.steps[0].env;
        expect(env.GITHUB_TOKEN).toBe("${{ github.token }}");
        expect(env.FINOPS_PR_NUMBER).toBe("${{ github.event.pull_request.number }}");
        // Un input con comillas no puede romper el shell: van por env, no interpolados en `run`.
        expect(yaml.load(leer(PLANTILLAS.github)).runs.steps[0].run).not.toContain("${{");
    });

    it("la plantilla de GitLab es un job base que se extiende", () => {
        const job = yaml.load(leer(PLANTILLAS.gitlab))[".finops-shift-left"];
        expect(job.rules[0].if).toContain("merge_request_event");
        expect(job.variables.FINOPS_PR_NUMBER).toBe("$CI_MERGE_REQUEST_IID");
    });

    it("la plantilla de Azure DevOps toma el PR de las variables predefinidas verificadas", () => {
        const env = yaml.load(leer(PLANTILLAS.azuredevops)).steps[0].env;
        expect(env.FINOPS_PR_NUMBER).toBe("$(System.PullRequest.PullRequestId)");
        expect(env.FINOPS_COMMIT_SHA).toBe("$(System.PullRequest.SourceCommitId)");
        expect(env.SYSTEM_ACCESSTOKEN).toBe("$(System.AccessToken)");
    });
});
