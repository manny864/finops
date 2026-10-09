// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server, type IncomingMessage } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { camposDelCatalogo } from "@/services/iacCostCatalog";
import { camposArm } from "@/services/iacCostCatalogArm";
import { estimarPlan, estimarWhatIf } from "@/services/iacCostEstimator.service";
import { precioDeFixture } from "../helpers/retailFixture";

/**
 * El script de CI corre en el pipeline de otra gente: si se equivoca, voltea un PR o
 * deja pasar uno caro. Se prueba ejecutándolo de verdad (bash + jq + curl) contra un
 * servidor local que hace de plataforma.
 *
 * Qué tiene que garantizar, y por qué cada test existe:
 *   - NO manda contraseñas ni claves del plan: un `terraform show -json` las trae en
 *     claro y la plataforma sólo necesita tipo, región y SKU.
 *   - La clave no viaja en la línea de comandos (se vería en la lista de procesos).
 *   - Falla ABIERTO si la plataforma no responde, y falla CERRADO si la configuración
 *     está mal (clave sin scope, entrada inválida): ahí no hay nada que "dejar pasar".
 *   - El gate más estricto manda: un workflow puede apretar el umbral de su repo, no aflojarlo.
 */
const SCRIPT = join(process.cwd(), "public/integrations/shift-left/finops-estimate.sh");
const PLAN = join(process.cwd(), "__tests__/fixtures/terraform-plan-azurerm-completo.json");
const WHATIF = join(process.cwd(), "__tests__/fixtures/arm-whatif-completo.json");

interface Capturado { metodo?: string; url?: string; auth?: string; body?: any; bytes?: number; llamadas: number }
let servidor: Server;
let puerto = 0;
let capturado: Capturado = { llamadas: 0 };
let respuesta: { status: number; body: unknown } = { status: 200, body: {} };
/** Respuestas que se entregan primero, en orden, antes de caer en `respuesta`: para probar reintentos. */
let cola: Array<{ status: number; body: unknown }> = [];
/** Lo que el script le pidió al CI (GitHub, Azure DevOps o GitLab) y lo que ese CI contesta, por "MÉTODO ruta". */
let pedidosCI: Array<{ metodo: string; url: string; auth: string; body: any }> = [];
let respuestasCI: Record<string, { status: number; body: unknown }> = {};
let dir = "";

const DATOS = (o: Record<string, unknown> = {}) => ({
    data: {
        current_monthly_cost_usd: 612.5, projected_monthly_cost_usd: 3789.41, delta_cost_usd: 3176.91,
        list_delta_cost_usd: 3971.14, discount_pct: 20, currency: "USD",
        resources_unpriced: 2, resources_by_use: 1, resources_free: 8,
        budget_gate: { status: "NOT_EVALUATED", threshold_usd: null, threshold_pct_of_remaining: null, reason: null },
        budget: null, previous: null,
        lines: [
            { direccion: "azurerm_firewall.hub", tipo: "azurerm_firewall", accion: "create", mensualAntes: 0, mensualDespues: 912.5, delta: 912.5, notas: ["datos-procesados-no-incluidos"] },
            { direccion: "azurerm_linux_virtual_machine.vm", tipo: "x", accion: "update", mensualAntes: 70.08, mensualDespues: 79.36, delta: 9.28, notas: ["spot-variable", "region-inferida"] },
            { direccion: "azurerm_storage_account.logs", tipo: "azurerm_storage_account", accion: "create", mensualAntes: 0, mensualDespues: 0, delta: 0, motivo: "por-uso" },
            { direccion: "azurerm_subnet.s", tipo: "azurerm_subnet", accion: "create", mensualAntes: 0, mensualDespues: 0, delta: 0 },
        ],
        ...o,
    },
    request_id: "r1",
});

beforeAll(async () => {
    servidor = createServer((req: IncomingMessage, res) => {
        const trozos: Buffer[] = [];
        req.on("data", (c) => trozos.push(c));
        req.on("end", () => {
            const crudo = Buffer.concat(trozos).toString("utf8");
            capturado = {
                llamadas: capturado.llamadas + 1, metodo: req.method, url: req.url,
                auth: String(req.headers.authorization || ""), bytes: crudo.length,
                body: crudo ? JSON.parse(crudo) : null,
            };
            if (!String(req.url).startsWith("/api/v1/shift-left/estimate")) {
                const clave = `${req.method} ${String(req.url).split("?")[0]}`;
                const auth = String(req.headers.authorization || req.headers["private-token"] || "");
                pedidosCI.push({ metodo: String(req.method), url: String(req.url), auth, body: crudo ? JSON.parse(crudo) : null });
                const rc = respuestasCI[clave] ?? { status: 404, body: { message: `sin ruta ${clave}` } };
                res.writeHead(rc.status, { "Content-Type": "application/json" });
                res.end(JSON.stringify(rc.body));
                return;
            }
            const r = cola.shift() ?? respuesta;
            res.writeHead(r.status, { "Content-Type": "application/json" });
            res.end(typeof r.body === "string" ? r.body : JSON.stringify(r.body));
        });
    });
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    puerto = (servidor.address() as any).port;
});
afterAll(() => new Promise<void>((r) => servidor.close(() => r())));
beforeEach(() => {
    capturado = { llamadas: 0 };
    cola = [];
    pedidosCI = [];
    respuestasCI = {};
    respuesta = { status: 200, body: DATOS() };
    dir = mkdtempSync(join(tmpdir(), "finops-sh-"));
});

interface Salida { codigo: number; stdout: string; stderr: string; comentario: string; env: string; ghOutput: string }
function correr(env: Record<string, string> = {}): Promise<Salida> {
    const ghOutput = join(dir, "gh-output");
    writeFileSync(ghOutput, "");
    return new Promise((resolve) => {
        execFile("bash", [SCRIPT], {
            cwd: dir,
            env: {
                PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "",
                FINOPS_API_KEY: "pak_test_123", FINOPS_API_URL: `http://127.0.0.1:${puerto}`,
                FINOPS_PLAN_JSON: PLAN, FINOPS_REPOSITORY: "acme/infra", FINOPS_PR_NUMBER: "42",
                FINOPS_COMMIT_SHA: "abc123", FINOPS_AUTHOR: "lucia", FINOPS_RETRY_DELAY: "0",
                GITHUB_OUTPUT: ghOutput,
                ...env,
            },
            timeout: 60_000,
        }, (err, stdout, stderr) => {
            const leer = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "");
            resolve({
                codigo: err ? (typeof (err as any).code === "number" ? (err as any).code : 1) : 0,
                stdout, stderr, comentario: leer("finops-comment.md"), env: leer("finops.env"), ghOutput: readFileSync(ghOutput, "utf8"),
            });
        });
    });
}
afterAll(() => { /* los directorios temporales los limpia el SO */ });

describe("lo que sale del runner", () => {
    it("manda el plan reducido: ni contraseñas, ni claves, ni etiquetas", async () => {
        const original = readFileSync(PLAN, "utf8");
        expect(original).toContain("NoEsUnaClaveReal"); // el plan real las trae en claro

        const r = await correr();
        expect(r.codigo).toBe(0);
        const enviado = JSON.stringify(capturado.body);
        expect(enviado).not.toContain("NoEsUnaClaveReal");
        expect(enviado).not.toContain("admin_password");
        expect(enviado).not.toContain("admin_username");
        expect(enviado).not.toContain("source_image_reference");
        expect(enviado).not.toContain("network_interface_ids");
        expect(capturado.bytes!).toBeLessThan(original.length / 2);
    });

    it("conserva lo que el estimador necesita, incluidos los bloques anidados y lo desconocido", async () => {
        await correr();
        const cambios = capturado.body.plan.resource_changes as any[];
        expect(cambios).toHaveLength(25);

        const vm = cambios.find((c) => c.type === "azurerm_linux_virtual_machine");
        expect(vm.change.after).toMatchObject({ location: "westus2", size: "Standard_D2s_v3" });
        expect(vm.change.after.os_disk[0]).toEqual({ storage_account_type: "Premium_LRS", disk_size_gb: 64 });
        expect(vm.change.actions).toEqual(["create"]);

        const aks = cambios.find((c) => c.type === "azurerm_kubernetes_cluster");
        expect(aks.change.after.default_node_pool[0]).toMatchObject({ vm_size: "Standard_D2s_v3", node_count: 3 });

        const win = cambios.find((c) => c.type === "azurerm_windows_virtual_machine");
        expect(win.change.after_unknown.os_disk[0].disk_size_gb).toBe(true);

        const agw = cambios.find((c) => c.type === "azurerm_application_gateway");
        expect(agw.change.after.sku[0]).toMatchObject({ name: "WAF_v2", tier: "WAF_v2" });
    });

    it("el plan reducido se estima IGUAL que el completo: no se perdió nada que el catálogo necesite", async () => {
        // Es la prueba que justifica reducir: un atributo que falta no da un error, da un
        // recurso "sin tarifar" o, peor, un monto distinto.
        await correr();
        const completo = await estimarPlan(JSON.parse(readFileSync(PLAN, "utf8")), { precio: precioDeFixture });
        const reducido = await estimarPlan(capturado.body.plan, { precio: precioDeFixture });
        expect(reducido).toEqual(completo);
        expect(reducido.sinTarifar).toBe(0);
        expect(reducido.delta).toBeCloseTo(3176.9149, 2);
    });

    it("manda el contexto del PR y la herramienta", async () => {
        await correr({ FINOPS_TOOL: "tofu" });
        expect(capturado.body).toMatchObject({ repository: "acme/infra", commit_sha: "abc123", author: "lucia", pr_number: 42, tool: "tofu" });
        expect(capturado.metodo).toBe("POST");
        expect(capturado.url).toBe("/api/v1/shift-left/estimate");
    });

    it("la clave viaja en el header, no en la línea de comandos", async () => {
        await correr();
        expect(capturado.auth).toBe("Bearer pak_test_123");
        const texto = readFileSync(SCRIPT, "utf8");
        // `curl -H "Authorization: Bearer $KEY"` se ve en `ps` de la máquina.
        expect(texto).not.toMatch(/-H\s+["']Authorization/);
        expect(texto).toContain("curl -sS --max-time 60 -K -");
    });

    it("un PR sin número viaja como null", async () => {
        await correr({ FINOPS_PR_NUMBER: "" });
        expect(capturado.body.pr_number).toBeNull();
    });
});

describe("Bicep", () => {
    it("manda el what-if reducido: ni contraseñas, ni claves, ni datos de usuario", async () => {
        const original = readFileSync(WHATIF, "utf8");
        for (const secreto of ["NoEsUnaClaveReal", "adminPassword", "customData", "tampoco-esto", "osProfile"]) {
            expect(original).toContain(secreto); // el what-if completo los trae en claro
        }
        const r = await correr({ FINOPS_TOOL: "bicep", FINOPS_PLAN_JSON: WHATIF });
        expect(r.codigo).toBe(0);
        const enviado = JSON.stringify(capturado.body);
        for (const secreto of ["NoEsUnaClaveReal", "adminPassword", "customData", "tampoco-esto", "osProfile", "redisConfiguration", "servicePrincipalProfile"]) {
            expect(enviado).not.toContain(secreto);
        }
        expect(capturado.body.tool).toBe("bicep");
        expect(capturado.body.plan).toBeUndefined();
        expect(capturado.body.what_if.changes).toHaveLength(18);
    });

    it("el what-if reducido se estima IGUAL que el completo", async () => {
        await correr({ FINOPS_TOOL: "bicep", FINOPS_PLAN_JSON: WHATIF });
        const completo = await estimarWhatIf(JSON.parse(readFileSync(WHATIF, "utf8")), { precio: precioDeFixture });
        const reducido = await estimarWhatIf(capturado.body.what_if, { precio: precioDeFixture });
        expect(reducido).toEqual(completo);
        expect(reducido.sinTarifar).toBe(0);
    });

    it("acepta también la forma de la REST, con los cambios en properties.changes", async () => {
        const rest = join(dir, "rest.json");
        writeFileSync(rest, JSON.stringify({ status: "Succeeded", properties: { changes: JSON.parse(readFileSync(WHATIF, "utf8")).changes } }));
        await correr({ FINOPS_TOOL: "bicep", FINOPS_PLAN_JSON: rest });
        expect(capturado.body.what_if.changes).toHaveLength(18);
    });
});

describe("el comentario del PR", () => {
    it("muestra antes, después, delta, descuento y el desglose con sus avisos", async () => {
        const r = await correr();
        const c = r.comentario;
        expect(c).toContain("<!-- finops-shift-left -->");
        expect(c).toContain("🔺 Impacto en el costo mensual de Azure");
        expect(c).toContain("| Antes | $612.50 |");
        expect(c).toContain("| **Delta** | **+$3,176.91** |");
        expect(c).toContain("| Delta a precio de lista | +$3,971.14 |");
        expect(c).toContain("Precios con tu descuento del 20% aplicado");
        // El desglose: lo que cobra algo, lo que no se pudo tarifar, y sin los recursos gratis.
        expect(c).toContain("| `azurerm_firewall.hub` | create | $0.00 | $912.50 | no incluye los datos procesados |");
        expect(c).toContain("precio Spot: varía con la demanda; región inferida del resto del plan");
        expect(c).toContain("`azurerm_storage_account.logs` | create | $0.00 | $0.00 | ⚠️ se cobra por consumo");
        expect(c).not.toContain("azurerm_subnet.s");
        expect(c).toContain("2 recurso(s) no se pudieron tarifar o se cobran por consumo (1 por consumo): el delta es un piso, no el total.");
    });

    it("un PR que ahorra se marca en verde y con el signo correcto", async () => {
        respuesta.body = DATOS({ delta_cost_usd: -184.32, projected_monthly_cost_usd: 428.18, discount_pct: 0, resources_unpriced: 0 });
        const c = (await correr()).comentario;
        expect(c).toContain("🟢");
        expect(c).toContain("| **Delta** | **-$184.32** |");
        expect(c).not.toContain("Delta a precio de lista");
        expect(c).not.toContain("el delta es un piso");
    });

    it("muestra cómo cambió respecto del push anterior", async () => {
        respuesta.body = DATOS({ previous: { delta_cost_usd: 100, commit_sha: "old", gate_status: "OK", created_at: "2026-10-08T10:00:00Z" } });
        expect((await correr()).comentario).toContain("Push anterior: +$100.00 → ahora +$3,176.91 (sube)");
        respuesta.body = DATOS({ previous: { delta_cost_usd: 9000, commit_sha: "old", gate_status: "OK", created_at: "x" } });
        expect((await correr()).comentario).toContain("(baja)");
    });

    it("muestra el contexto de presupuesto del centro de costos", async () => {
        respuesta.body = DATOS({ budget: { cost_center: "Plataforma", monthly_usd: 5000, spent_usd: 1000, remaining_usd: 4000, delta_pct_of_budget: 63.54, delta_pct_of_remaining: 79.42 } });
        const c = (await correr()).comentario;
        expect(c).toContain("**Presupuesto de «Plataforma»:** este cambio equivale al 63.54% del presupuesto mensual ($5,000.00); quedan $4,000.00 del mes.");
    });

    it("sin descuento ni presupuesto ni PR anterior no inventa secciones", async () => {
        respuesta.body = DATOS({ discount_pct: 0, budget: null, previous: null });
        const c = (await correr()).comentario;
        for (const ausente of ["Presupuesto de", "Push anterior", "Delta a precio de lista"]) expect(c).not.toContain(ausente);
    });
});

describe("el comentario en el PR de cada CI", () => {
    const base = () => `http://127.0.0.1:${puerto}`;
    const MARCA = "<!-- finops-shift-left -->";
    const gh = () => ({
        GITHUB_ACTIONS: "true", GITHUB_TOKEN: "ghs_secreto", GITHUB_REPOSITORY: "acme/infra", GITHUB_API_URL: base(),
    });
    const ado = () => ({
        TF_BUILD: "True", SYSTEM_ACCESSTOKEN: "ado_secreto", SYSTEM_COLLECTIONURI: `${base()}/`,
        SYSTEM_TEAMPROJECT: "Proyecto X", BUILD_REPOSITORY_ID: "repo-id",
    });
    const gl = () => ({
        GITLAB_CI: "true", FINOPS_GITLAB_TOKEN: "glpat_secreto", CI_API_V4_URL: `${base()}/api/v4`, CI_PROJECT_ID: "55",
    });

    describe("GitHub", () => {
        it("crea el comentario la primera vez", async () => {
            respuestasCI["GET /repos/acme/infra/issues/42/comments"] = { status: 200, body: [{ id: 1, body: "otro comentario" }] };
            respuestasCI["POST /repos/acme/infra/issues/42/comments"] = { status: 201, body: { id: 9 } };
            const r = await correr(gh());
            expect(r.codigo).toBe(0);
            const post = pedidosCI.find((p) => p.metodo === "POST")!;
            expect(post.auth).toBe("Bearer ghs_secreto");
            expect(post.body.body).toContain(MARCA);
            expect(post.body.body).toContain("Impacto en el costo mensual de Azure");
            expect(pedidosCI.some((p) => p.metodo === "PATCH")).toBe(false);
        });

        it("EDITA el comentario anterior en vez de apilar uno nuevo", async () => {
            respuestasCI["GET /repos/acme/infra/issues/42/comments"] = { status: 200, body: [{ id: 1, body: "hola" }, { id: 777, body: `${MARCA}\n## viejo` }] };
            respuestasCI["PATCH /repos/acme/infra/issues/comments/777"] = { status: 200, body: {} };
            const r = await correr(gh());
            expect(r.codigo).toBe(0);
            expect(pedidosCI.filter((p) => p.metodo === "PATCH")).toHaveLength(1);
            expect(pedidosCI.some((p) => p.metodo === "POST")).toBe(false);
            expect(pedidosCI.find((p) => p.metodo === "PATCH")!.body.body).toContain("Impacto en el costo mensual");
        });

        it("busca la marca en varias páginas", async () => {
            const llenas = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, body: "x" }));
            respuestasCI["GET /repos/acme/infra/issues/42/comments"] = { status: 200, body: llenas };
            // El mismo handler contesta igual a todas las páginas: se verifica que pida más de una.
            respuestasCI["POST /repos/acme/infra/issues/42/comments"] = { status: 201, body: {} };
            await correr(gh());
            expect(pedidosCI.filter((p) => p.metodo === "GET").length).toBeGreaterThan(1);
            expect(pedidosCI.filter((p) => p.metodo === "GET").length).toBeLessThanOrEqual(5);
        });

        it("el token no aparece en la lista de procesos: va por stdin", () => {
            const t = readFileSync(SCRIPT, "utf8");
            expect(t).toContain("curl -sS --max-time 30 -K -");
            expect(t).not.toMatch(/-H\s+["']Authorization: Bearer \$\{?GITHUB_TOKEN/);
        });
    });

    describe("Azure DevOps", () => {
        const hilos = "/Proyecto%20X/_apis/git/repositories/repo-id/pullRequests/42/threads";

        it("crea un hilo nuevo la primera vez (commentType 1, status 1)", async () => {
            respuestasCI[`GET ${hilos}`] = { status: 200, body: { value: [{ id: 1, comments: [{ id: 1, content: "sistema" }] }], count: 1 } };
            respuestasCI[`POST ${hilos}`] = { status: 200, body: { id: 5 } };
            const r = await correr(ado());
            expect(r.codigo).toBe(0);
            const post = pedidosCI.find((p) => p.metodo === "POST")!;
            expect(post.url).toContain("api-version=7.1");
            expect(post.auth).toBe("Bearer ado_secreto");
            expect(post.body.status).toBe(1);
            expect(post.body.comments[0]).toMatchObject({ parentCommentId: 0, commentType: 1 });
            expect(post.body.comments[0].content).toContain(MARCA);
        });

        it("actualiza el comentario del hilo anterior", async () => {
            respuestasCI[`GET ${hilos}`] = { status: 200, body: { value: [
                { id: 3, isDeleted: false, comments: [{ id: 1, content: "otro" }] },
                { id: 9, isDeleted: false, comments: [{ id: 1, content: `${MARCA}\nviejo` }] },
            ] } };
            respuestasCI[`PATCH ${hilos}/9/comments/1`] = { status: 200, body: {} };
            await correr(ado());
            const patch = pedidosCI.find((p) => p.metodo === "PATCH")!;
            expect(patch.url).toContain("api-version=7.1");
            expect(patch.body.content).toContain("Impacto en el costo mensual");
            expect(pedidosCI.some((p) => p.metodo === "POST")).toBe(false);
        });

        it("ignora los comentarios borrados", async () => {
            respuestasCI[`GET ${hilos}`] = { status: 200, body: { value: [
                { id: 9, isDeleted: false, comments: [{ id: 1, isDeleted: true, content: `${MARCA}\nborrado` }] },
            ] } };
            respuestasCI[`POST ${hilos}`] = { status: 200, body: {} };
            await correr(ado());
            expect(pedidosCI.some((p) => p.metodo === "POST")).toBe(true);
            expect(pedidosCI.some((p) => p.metodo === "PATCH")).toBe(false);
        });
    });

    describe("GitLab", () => {
        const notas = "/api/v4/projects/55/merge_requests/42/notes";

        it("crea la nota la primera vez, tomando el número del MR de CI_MERGE_REQUEST_IID", async () => {
            respuestasCI[`GET ${notas}`] = { status: 200, body: [{ id: 1, system: true, body: "merged" }] };
            respuestasCI[`POST ${notas}`] = { status: 201, body: {} };
            const r = await correr({ ...gl(), FINOPS_PR_NUMBER: "", CI_MERGE_REQUEST_IID: "42" });
            expect(r.codigo).toBe(0);
            const post = pedidosCI.find((p) => p.metodo === "POST")!;
            expect(post.auth).toBe("glpat_secreto");
            expect(post.body.body).toContain(MARCA);
        });

        it("modifica la nota anterior con PUT", async () => {
            respuestasCI[`GET ${notas}`] = { status: 200, body: [{ id: 321, system: false, body: `${MARCA}\nviejo` }] };
            respuestasCI[`PUT ${notas}/321`] = { status: 200, body: {} };
            await correr({ ...gl(), FINOPS_PR_NUMBER: "42" });
            expect(pedidosCI.find((p) => p.metodo === "PUT")!.body.body).toContain("Impacto en el costo mensual");
            expect(pedidosCI.some((p) => p.metodo === "POST")).toBe(false);
        });

        it("no confunde una nota del sistema que cita la marca con la nuestra", async () => {
            respuestasCI[`GET ${notas}`] = { status: 200, body: [{ id: 5, system: true, body: `${MARCA}` }] };
            respuestasCI[`POST ${notas}`] = { status: 201, body: {} };
            await correr({ ...gl(), FINOPS_PR_NUMBER: "42" });
            expect(pedidosCI.some((p) => p.metodo === "POST")).toBe(true);
        });
    });

    describe("cuando no se puede comentar", () => {
        it("un fallo al comentar avisa pero no rompe la corrida ni el gate", async () => {
            respuestasCI["GET /repos/acme/infra/issues/42/comments"] = { status: 403, body: { message: "Resource not accessible by integration" } };
            const r = await correr(gh());
            expect(r.codigo).toBe(0);
            expect(r.stderr).toContain("No pude publicar el comentario");
            expect(r.stderr).toContain("403");
        });

        it("el gate se aplica aunque el comentario falle", async () => {
            respuesta.body = DATOS({ budget_gate: { status: "EXCEEDED", threshold_usd: 500, threshold_pct_of_remaining: null, reason: "usd" } });
            respuestasCI["GET /repos/acme/infra/issues/42/comments"] = { status: 500, body: {} };
            expect((await correr(gh())).codigo).toBe(1);
        });

        it("sin token avisa cómo pasarlo", async () => {
            const r = await correr({ ...gh(), GITHUB_TOKEN: "" });
            expect(r.codigo).toBe(0);
            expect(r.stderr).toContain("No hay token para comentar");
            expect(pedidosCI).toHaveLength(0);
        });

        it("sin número de PR no comenta (un push a una rama no tiene dónde)", async () => {
            const r = await correr({ ...gh(), FINOPS_PR_NUMBER: "" });
            expect(r.codigo).toBe(0);
            expect(pedidosCI).toHaveLength(0);
        });

        it("FINOPS_COMMENT=false no comenta aunque pueda", async () => {
            await correr({ ...gh(), FINOPS_COMMENT: "false" });
            expect(pedidosCI).toHaveLength(0);
        });

        it("fuera de un CI conocido sólo escribe el archivo", async () => {
            const r = await correr();
            expect(pedidosCI).toHaveLength(0);
            expect(r.comentario).toContain(MARCA);
        });
    });
});

describe("el Budget Gate", () => {
    const gate = (status: string, extra: Record<string, unknown> = {}) =>
        DATOS({ budget_gate: { status, threshold_usd: 500, threshold_pct_of_remaining: null, reason: status === "EXCEEDED" ? "usd" : null, ...extra } });

    it("OK: sale 0 y lo dice", async () => {
        respuesta.body = gate("OK");
        const r = await correr();
        expect(r.codigo).toBe(0);
        expect(r.comentario).toContain("✅ **Budget Gate:** dentro del umbral.");
        expect(r.ghOutput).toContain("gate=OK");
    });

    it("EXCEEDED por monto: sale 1 y explica por qué", async () => {
        respuesta.body = gate("EXCEEDED");
        const r = await correr();
        expect(r.codigo).toBe(1);
        expect(r.comentario).toContain("⛔ **Budget Gate: umbral superado** — agrega $3,176.91 y el umbral del repositorio es $500.00/mes.");
        expect(r.ghOutput).toContain("gate=EXCEEDED");
    });

    it("EXCEEDED por porcentaje del presupuesto", async () => {
        respuesta.body = gate("EXCEEDED", { reason: "pct", threshold_pct_of_remaining: 40, threshold_usd: null });
        const r = await correr();
        expect(r.codigo).toBe(1);
        expect(r.comentario).toContain("agrega más del 40% del presupuesto restante");
    });

    it("sin gate en la plataforma informa y no bloquea", async () => {
        const r = await correr();
        expect(r.codigo).toBe(0);
        expect(r.comentario).not.toContain("Budget Gate");
    });

    it("un umbral local más estricto que el de la plataforma gana", async () => {
        respuesta.body = gate("OK");
        const r = await correr({ FINOPS_THRESHOLD_USD: "1000" });
        expect(r.codigo).toBe(1);
        expect(r.comentario).toContain("el umbral del workflow es $1,000.00/mes");
    });

    it("pero uno local más laxo NO afloja el de la plataforma", async () => {
        respuesta.body = gate("EXCEEDED");
        const r = await correr({ FINOPS_THRESHOLD_USD: "999999" });
        expect(r.codigo).toBe(1);
    });

    it("con sólo umbral local, pasa si cabe y se evalúa en vez de quedar 'sin evaluar'", async () => {
        const r = await correr({ FINOPS_THRESHOLD_USD: "5000" });
        expect(r.codigo).toBe(0);
        expect(r.ghOutput).toContain("gate=OK");
    });

    it("el borde exacto del umbral local no bloquea", async () => {
        const r = await correr({ FINOPS_THRESHOLD_USD: "3176.91" });
        expect(r.codigo).toBe(0);
    });

    it("rechaza un umbral local que no es un número, sin llamar a la plataforma", async () => {
        const r = await correr({ FINOPS_THRESHOLD_USD: "mucho" });
        expect(r.codigo).toBe(2);
        expect(capturado.llamadas).toBe(0);
    });
});

describe("errores", () => {
    it("clave inválida, sin scope o entrada rechazada: fallan cerrado (2) con el motivo", async () => {
        for (const [status, texto] of [[401, "no es válida"], [403, "write:shift-left"], [400, "rechazó la entrada"], [413, "rechazó la entrada"]] as const) {
            respuesta = { status, body: { error: { code: "x", message: "motivo del servidor" } } };
            const r = await correr();
            expect(r.codigo).toBe(2);
            expect(r.stderr).toContain(texto);
            expect(r.stderr).toContain("motivo del servidor");
        }
    });

    it("sin FINOPS_API_KEY falla antes de hacer nada", async () => {
        const r = await correr({ FINOPS_API_KEY: "" });
        expect(r.codigo).toBe(2);
        expect(r.stderr).toContain("FINOPS_API_KEY");
        expect(capturado.llamadas).toBe(0);
    });

    it("falla abierto cuando la plataforma no responde: 5xx, 429 sostenido o sin red", async () => {
        for (const status of [500, 503, 429]) {
            respuesta = { status, body: "boom" };
            capturado = { llamadas: 0 };
            const r = await correr();
            expect(r.codigo).toBe(0);
            expect(r.stderr).toContain("no se bloquea");
            expect(r.ghOutput).toContain("gate=NOT_EVALUATED");
            expect(capturado.llamadas).toBe(3); // reintentó
            expect(r.comentario).toBe("");
        }
        const sinRed = await correr({ FINOPS_API_URL: "http://127.0.0.1:1" });
        expect(sinRed.codigo).toBe(0);
        expect(sinRed.stderr).toContain("no se bloquea");
    });

    it("se recupera si el segundo intento responde", async () => {
        cola = [{ status: 503, body: "caído" }];
        const r = await correr();
        expect(r.codigo).toBe(0);
        expect(capturado.llamadas).toBe(2);
        expect(r.comentario).toContain("Impacto en el costo mensual");
    });

    it("un plan que no existe o no es JSON es un error de entrada", async () => {
        expect((await correr({ FINOPS_PLAN_JSON: join(dir, "no-existe.json") })).codigo).toBe(2);
        const roto = join(dir, "roto.json");
        writeFileSync(roto, "{no es json");
        const r = await correr({ FINOPS_PLAN_JSON: roto });
        expect(r.codigo).toBe(2);
        expect(r.stderr).toContain("no es JSON válido");
    });

    it("sin plan binario ni JSON explica cómo generarlo", async () => {
        const r = await correr({ FINOPS_PLAN_JSON: "", FINOPS_PLAN_FILE: "tfplan.bin" });
        expect(r.codigo).toBe(2);
        expect(r.stderr).toContain("terraform plan -out=tfplan.bin");
    });

    it("una herramienta desconocida falla con claridad", async () => {
        const r = await correr({ FINOPS_TOOL: "pulumi" });
        expect(r.codigo).toBe(2);
        expect(r.stderr).toContain("terraform, tofu o bicep");
    });

    it("Bicep exige la salida del what-if", async () => {
        const r = await correr({ FINOPS_TOOL: "bicep", FINOPS_PLAN_JSON: "" });
        expect(r.codigo).toBe(2);
        expect(r.stderr).toContain("what-if");
    });
});

describe("salidas", () => {
    it("escribe los archivos y las variables del CI", async () => {
        const r = await correr();
        expect(r.env).toContain("FINOPS_DELTA_USD=3176.91");
        expect(r.env).toContain("FINOPS_GATE=NOT_EVALUATED");
        expect(existsSync(join(dir, "finops-result.json"))).toBe(true);
        expect(r.ghOutput).toContain("delta=3176.91");
        expect(r.ghOutput).toContain("unpriced=2");
    });

    it("emite las anotaciones de Azure DevOps cuando corre ahí", async () => {
        respuesta.body = DATOS({ budget_gate: { status: "EXCEEDED", threshold_usd: 500, threshold_pct_of_remaining: null, reason: "usd" } });
        const r = await correr({ TF_BUILD: "True" });
        expect(r.stdout).toContain("##vso[task.setvariable variable=finopsDeltaUsd]3176.91");
        expect(r.stdout).toContain("##vso[task.setvariable variable=finopsGate]EXCEEDED");
        expect(r.stderr).toContain("##vso[task.logissue type=error]");
    });

    it("emite las anotaciones de GitHub cuando corre ahí", async () => {
        respuesta = { status: 403, body: { error: { message: "x" } } };
        expect((await correr({ GITHUB_ACTIONS: "true" })).stderr).toContain("::error::");
    });

    it("respeta FINOPS_OUTPUT_DIR", async () => {
        const salida = join(dir, "salida");
        await correr({ FINOPS_OUTPUT_DIR: salida });
        expect(existsSync(join(salida, "finops-comment.md"))).toBe(true);
        rmSync(salida, { recursive: true, force: true });
    });
});

describe("el script y el catálogo del servidor no se desfasan", () => {
    it("para Bicep envía las claves que leen los adaptadores ARM, y sólo esas", () => {
        const t = readFileSync(SCRIPT, "utf8");
        const arm: string[] = JSON.parse(t.match(/^CAMPOS_ARM='(\[.*\])'/m)![1]);
        expect([...arm].sort()).toEqual(camposArm());
    });

    const texto = readFileSync(SCRIPT, "utf8");
    const lista = (nombre: string): string[] => JSON.parse(texto.match(new RegExp(`^${nombre}='(\\[.*\\])'`, "m"))![1]);

    it("el script envía todos los atributos que el catálogo lee, y sólo esos", () => {
        // Si el catálogo suma un atributo y el script no lo envía, el servidor lo ve como
        // "falta el dato" y el recurso queda sin tarifar, sin ningún error. Y al revés:
        // un atributo de más es un dato del cliente que sale del runner sin necesidad.
        const { campos, anidados } = camposDelCatalogo();
        expect([...lista("CAMPOS_TF")].sort()).toEqual(campos);
        // `location` va en los bloques de las georeplicas del registry; el resto son los
        // nombres que el catálogo lee dentro de os_disk, default_node_pool, sku…
        expect([...lista("ANIDADOS_TF")].sort()).toEqual(anidados);
    });
});
