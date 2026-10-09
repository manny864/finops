import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * MEJ-20 — lo que el cliente copia a su pipeline para activar Shift-Left.
 *
 * Sin una Action publicada, la forma de que un repositorio de un cliente use el estimador
 * es descargar un script de la plataforma. Para que eso no sea "ejecutar lo que baje de
 * internet", el snippet fija el SHA-256 del script: si el archivo cambia —por un error
 * nuestro o algo peor— el paso falla antes de ejecutarlo.
 *
 * El script vive en `public/integrations/shift-left/finops-estimate.sh`, que se sirve como
 * archivo estático, y esta es la ÚNICA fuente del hash: se calcula leyendo ese archivo, no
 * se copia a mano.
 */

export const RUTA_SCRIPT = "/integrations/shift-left/finops-estimate.sh";
const ARCHIVO = join(process.cwd(), "public", "integrations", "shift-left", "finops-estimate.sh");

export type Herramienta = "terraform" | "tofu" | "bicep";
export type Plataforma = "github" | "azuredevops" | "gitlab";


export const HERRAMIENTAS: Herramienta[] = ["terraform", "tofu", "bicep"];

let cache: { mtime: number; sha256: string } | null = null;

/** SHA-256 del script, con caché por fecha de modificación (se lee en cada apertura de la pantalla). */
export function sha256DelScript(): string {
    const mtime = statSync(ARCHIVO).mtimeMs;
    if (cache && cache.mtime === mtime) return cache.sha256;
    const sha256 = createHash("sha256").update(readFileSync(ARCHIVO)).digest("hex");
    cache = { mtime, sha256 };
    return sha256;
}

export interface OpcionesSnippet {
    apiUrl: string;
    sha256: string;
    tool: Herramienta;
}

const unir = (l: string[]) => l.join("\n") + "\n";

/** Los tres comandos que descargan el script, verifican su hash y lo ejecutan. */
function pasoDeEstimacion(o: OpcionesSnippet, prefijo: string): string[] {
    const url = `${o.apiUrl}${RUTA_SCRIPT}`;
    return [
        'curl -fsSL "' + url + '" -o finops-estimate.sh',
        'echo "' + o.sha256 + '  finops-estimate.sh" | sha256sum -c -',
        "bash finops-estimate.sh",
    ].map((l) => prefijo + l);
}

/** Cómo se genera el archivo que lee el script, según la herramienta. */
function pasosDelPlan(tool: Herramienta): string[] {
    if (tool === "bicep") {
        return [
            "# Necesita credenciales de Azure con permiso de lectura sobre el grupo de recursos.",
            "az deployment group what-if --resource-group <tu-grupo-de-recursos> \\",
            "  --template-file main.bicep --no-pretty-print > whatif.json",
        ];
    }
    const bin = tool === "tofu" ? "tofu" : "terraform";
    return [`${bin} init -input=false`, `${bin} plan -input=false -out=tfplan.bin`];
}

function entradaDelScript(tool: Herramienta): string[] {
    return tool === "bicep"
        ? ["FINOPS_TOOL: bicep", "FINOPS_PLAN_JSON: whatif.json"]
        : tool === "tofu" ? ["FINOPS_TOOL: tofu"] : [];
}

export function snippetGithub(o: OpcionesSnippet): string {
    const l: string[] = [
        "name: Costo de infraestructura (FinOps Shift-Left)",
        "",
        "on:",
        "  pull_request:",
        "",
        "permissions:",
        "  contents: read",
        "  pull-requests: write   # para comentar el impacto en el PR",
        "",
        "jobs:",
        "  costo:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
    ];
    if (o.tool === "bicep") {
        l.push("      - uses: azure/login@v2   # el what-if consulta tu suscripción: configurá el acceso como en tu pipeline de deploy");
    } else {
        l.push(o.tool === "tofu" ? "      - uses: opentofu/setup-opentofu@v1" : "      - uses: hashicorp/setup-terraform@v3");
    }
    l.push(
        "",
        "      - name: Generar el plan",
        "        run: |",
        ...pasosDelPlan(o.tool).map((x) => "          " + x),
        "",
        "      - name: Estimar el costo (FinOps Shift-Left)",
        "        env:",
        "          FINOPS_API_KEY: ${{ secrets.FINOPS_API_KEY }}   # API Key con el permiso write:shift-left",
        "          GITHUB_TOKEN: ${{ github.token }}",
        "          FINOPS_REPOSITORY: ${{ github.repository }}",
        "          FINOPS_PR_NUMBER: ${{ github.event.pull_request.number }}",
        "          FINOPS_COMMIT_SHA: ${{ github.event.pull_request.head.sha }}",
        "          FINOPS_AUTHOR: ${{ github.event.pull_request.user.login }}",
        "          FINOPS_API_URL: " + o.apiUrl,
        ...entradaDelScript(o.tool).map((x) => "          " + x),
        "          # FINOPS_THRESHOLD_USD: '200'   # opcional: umbral de este workflow, en USD por mes",
        "        run: |",
        ...pasoDeEstimacion(o, "          "),
    );
    return unir(l);
}

export function snippetAzureDevOps(o: OpcionesSnippet): string {
    const l: string[] = [
        "# Azure Repos: el pipeline se dispara desde una política de rama (Build validation). La clave `pr:`",
        "# sólo funciona con repositorios de GitHub o Bitbucket.",
        "trigger: none",
        "",
        "pool:",
        "  vmImage: ubuntu-latest",
        "",
        "steps:",
        "  - checkout: self",
        "",
        "  - bash: |",
        ...pasosDelPlan(o.tool).map((x) => "      " + x),
        "    displayName: Generar el plan",
        "",
        "  - bash: |",
        ...pasoDeEstimacion(o, "      "),
        "    displayName: Estimar el costo (FinOps Shift-Left)",
        "    env:",
        "      FINOPS_API_KEY: $(FINOPS_API_KEY)            # variable secreta del pipeline, con el permiso write:shift-left",
        "      SYSTEM_ACCESSTOKEN: $(System.AccessToken)    # la identidad del build necesita 'Contribute to pull requests'",
        "      FINOPS_REPOSITORY: $(Build.Repository.Name)",
        "      FINOPS_PR_NUMBER: $(System.PullRequest.PullRequestId)",
        "      FINOPS_COMMIT_SHA: $(System.PullRequest.SourceCommitId)",
        "      FINOPS_AUTHOR: $(Build.RequestedFor)",
        "      FINOPS_API_URL: " + o.apiUrl,
        ...entradaDelScript(o.tool).map((x) => "      " + x),
        "      # FINOPS_THRESHOLD_USD: '200'   # opcional",
    ];
    return unir(l);
}

export function snippetGitlab(o: OpcionesSnippet): string {
    const plan = o.tool === "bicep"
        ? [
            "  # El what-if consulta tu suscripción: usá una imagen con Azure CLI y autenticá como en tu pipeline de deploy.",
            "  image: mcr.microsoft.com/azure-cli",
            "  script:",
            "    - az deployment group what-if --resource-group <tu-grupo-de-recursos> --template-file main.bicep --no-pretty-print > whatif.json",
        ]
        : [
            "  image:",
            `    name: ${o.tool === "tofu" ? "ghcr.io/opentofu/opentofu:latest" : "hashicorp/terraform:latest"}`,
            '    entrypoint: [""]',
            "  script:",
            `    - ${o.tool === "tofu" ? "tofu" : "terraform"} init -input=false`,
            `    - ${o.tool === "tofu" ? "tofu" : "terraform"} plan -input=false -out=tfplan.bin`,
            `    - ${o.tool === "tofu" ? "tofu" : "terraform"} show -json tfplan.bin > plan.json`,
        ];
    const archivo = o.tool === "bicep" ? "whatif.json" : "plan.json";
    const l: string[] = [
        "stages: [plan, costo]",
        "",
        "generar-plan:",
        "  stage: plan",
        ...plan,
        "  artifacts:",
        `    paths: [${archivo}]`,
        "  rules:",
        '    - if: $CI_PIPELINE_SOURCE == "merge_request_event"',
        "",
        "finops-shift-left:",
        "  stage: costo",
        "  image: alpine:3.20",
        "  needs: [generar-plan]",
        "  rules:",
        '    - if: $CI_PIPELINE_SOURCE == "merge_request_event"',
        "  before_script:",
        "    - apk add --no-cache bash curl jq",
        "  variables:",
        "    # Variables de CI/CD (enmascaradas): FINOPS_API_KEY con el permiso write:shift-left y",
        "    # FINOPS_GITLAB_TOKEN, un token de proyecto con scope api para comentar en el MR.",
        "    FINOPS_REPOSITORY: $CI_PROJECT_PATH",
        "    FINOPS_PR_NUMBER: $CI_MERGE_REQUEST_IID",
        "    FINOPS_COMMIT_SHA: $CI_COMMIT_SHA",
        "    FINOPS_AUTHOR: $GITLAB_USER_LOGIN",
        "    FINOPS_API_URL: " + o.apiUrl,
        `    FINOPS_PLAN_JSON: ${archivo}`,
        ...(o.tool === "bicep" ? ["    FINOPS_TOOL: bicep"] : o.tool === "tofu" ? ["    FINOPS_TOOL: tofu"] : []),
        "  script:",
        ...pasoDeEstimacion(o, "    - "),
    ];
    return unir(l);
}

export function snippets(o: OpcionesSnippet): Record<Plataforma, string> {
    return { github: snippetGithub(o), azuredevops: snippetAzureDevOps(o), gitlab: snippetGitlab(o) };
}
