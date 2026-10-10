/**
 * @vitest-environment node
 *
 * Ningún SELECT de una sola tabla puede nombrar una tabla o una columna que el DDL versionado no tiene.
 *
 * POR QUÉ. Es la mitad que `insertColumnasExisten` no cubre. El reporte ejecutivo pedía `ZombieResources` (no
 * existe), `Anomalies.detected_date` / `service_name` (no existen) y `Budgets.name` / `amount_usd` (tampoco): MySQL
 * rechaza el SELECT, un `catch` lo traga y la sección sale vacía. Producción lo registró 11 veces por colector en
 * 30 días y nadie vio un error. Los mocks de `pool.query` aceptan cualquier consulta, así que ningún test lo notó.
 *
 * ALCANCE, deliberadamente chico (ver `__tests__/helpers/sqlContraDdl.ts`): un único FROM, sin JOIN ni
 * subconsultas, y SQL escrito entero en el literal. Lo que no se puede atribuir sin ambigüedad se deja pasar antes
 * que dar un falso positivo. Queda fuera, a sabiendas, el SQL armado con `${...}` (~130 consultas): ahí un alias o
 * una lista de columnas puede venir de la interpolación y el chequeo no distingue una columna inexistente de eso.
 *
 * Al escribirla (2026-10-10) había 73 problemas en 40 archivos; abajo están como DEUDA. La guarda falla ante lo
 * NUEVO, no ante lo viejo.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { createRequire } from "node:module";
import { columnasPorTabla } from "../helpers/ddlVersionado";
import { analizarSelect, problemasDeSelect, type AnalisisSelect } from "../helpers/sqlContraDdl";

// Se carga fuera del grafo de módulos de vite (mismo recurso que integracionesCI.test.ts): sin eso vite intenta
// leer el source map de typescript.js y deja un error en la salida de cada corrida.
const ts = createRequire(import.meta.url)("typescript") as typeof import("typescript");

const RAIZ = process.cwd();
const ESQUEMA = columnasPorTabla();

/**
 * DEUDA CONOCIDA: SELECT que ya estaban mal cuando se escribió esta guarda y nadie corrigió todavía. Medido contra
 * el DDL versionado, NO contra producción. Varias están en un `catch` que las traga, así que no dejan rastro en los
 * logs: que no aparezcan ahí no quiere decir que anden.
 *
 * Cada entrada es `archivo → tabla.columna` (o sólo `tabla` si es la tabla la que no existe), en minúsculas. Al
 * corregir una consulta, borrá su línea: la guarda no avisa de las saldadas, pero una línea vieja tapa una recaída.
 */
const DEUDA: Record<string, string[]> = {
    // CostSnapshots no tiene `resource_id` (la columna es `ResourceId`), `cost` (es `cost_usd`) ni `usage_date`:
    // la misma clase de error que MEJ-29 corrigió en realConsumptionService. MySQL rechaza estas consultas.
    "src/services/azureApim.service.ts": ["costsnapshots.resource_id"],
    "src/services/azureAppInsights.service.ts": ["costsnapshots.cost", "costsnapshots.resource_id"],
    "src/services/azureBasicNetworking.service.ts": ["costsnapshots.resource_id"],
    "src/services/azureDataFactory.service.ts": ["costsnapshots.cost", "costsnapshots.resource_id", "costsnapshots.usage_date"],
    "src/services/azureDdosProtection.service.ts": ["costsnapshots.resource_id"],
    "src/services/azureEventGrid.service.ts": ["costsnapshots.resource_id"],
    "src/services/azureEventHubs.service.ts": ["costsnapshots.cost", "costsnapshots.resource_id", "costsnapshots.usage_date"],
    "src/services/azureHybridConnectivity.service.ts": ["costsnapshots.resource_id"],
    "src/services/azureInternetAccess.service.ts": ["costsnapshots.resource_id"],
    "src/services/azureLoadBalancing.service.ts": ["costsnapshots.resource_id"],
    "src/services/azureLogAnalytics.service.ts": ["costsnapshots.resource_id"],
    "src/services/azureMonitor.service.ts": ["costsnapshots.resource_id"],
    "src/services/azureNetworkAnalytics.service.ts": ["costsnapshots.resource_id"],
    "src/services/azureSentinelFinops.service.ts": ["costsnapshots.cost", "costsnapshots.resource_id"],
    "src/services/azureServiceBus.service.ts": ["costsnapshots.resource_id"],
    // CostSnapshots tampoco tiene ChargeType ni ChargeDescription.
    "src/services/azureCommitmentSimulator.service.ts": ["costsnapshots.chargedescription", "costsnapshots.chargetype"],

    // CostMeterSnapshots no tiene `resource_id` ni `region` (hay `resource_location`).
    "src/modules/collectors/azure/azureSearchCollector.ts": ["costmetersnapshots.resource_id"],
    "src/modules/collectors/azure/docIntelCollector.ts": ["costmetersnapshots.resource_id"],
    "src/modules/collectors/azure/foundryCollector.ts": ["costmetersnapshots.resource_id"],
    "src/services/realConsumptionService.ts": ["costmetersnapshots.region"],

    // CostCategorySnapshots no tiene `resource_id` ni `resource_group` (tiene `resource_type`).
    "src/app/api/intelligence/storage/backups/route.ts": ["costcategorysnapshots.resource_group", "costcategorysnapshots.resource_id"],
    "src/app/api/intelligence/storage/data-lake-gen2/route.ts": ["costcategorysnapshots.resource_group", "costcategorysnapshots.resource_id"],
    "src/app/api/intelligence/storage/managed-disks/route.ts": ["costcategorysnapshots.resource_group", "costcategorysnapshots.resource_id"],

    // Las herramientas del MCP y el feed de Power BI que el arreglo de anomalías no tocó: zombis, presupuestos y
    // recomendaciones. `Budgets` no tiene name/amount_usd/period/actual_spend_usd (tiene cost_center_tag_value y
    // monthly_limit_usd, y el gasto no se guarda); `ZombieResources`, `zombies` y `recommendations` no existen.
    // Las tools devuelven `{ count: 0, ..., note: "Tabla X no disponible" }`, que un agente lee como "no hay".
    "src/app/api/mcp/route.ts": ["budgets.actual_spend_usd", "budgets.amount_usd", "budgets.name", "budgets.period", "recommendations", "zombieresources"],
    "src/app/api/exports/powerbi-feed/route.ts": ["budgets.actual_spend_usd", "budgets.amount_usd", "budgets.name", "budgets.period", "zombies"],
    "src/services/globalSearch.service.ts": ["zombieresources"],

    // `Tenants` no tiene `azure_subscription_id` ni `deleted_at`. Son rutas de cron que la auditoría del 2026-10-10
    // declara "sin job ni referencias": hoy no corren. (sync-foundry pide además `tenantId`; la columna es `tenant_id`.)
    "src/app/api/cron/sync-aml/route.ts": ["tenants.azure_subscription_id", "tenants.deleted_at"],
    "src/app/api/cron/sync-azure-search/route.ts": ["tenants.azure_subscription_id", "tenants.deleted_at"],
    "src/app/api/cron/sync-content-safety/route.ts": ["tenants.azure_subscription_id", "tenants.deleted_at"],
    "src/app/api/cron/sync-databricks/route.ts": ["tenants.azure_subscription_id", "tenants.deleted_at"],
    "src/app/api/cron/sync-doc-intel/route.ts": ["tenants.azure_subscription_id", "tenants.deleted_at"],
    "src/app/api/cron/sync-foundry/route.ts": ["tenantsubscriptions.tenantid"],
    "src/app/api/cron/sync-speech-language/route.ts": ["tenants.azure_subscription_id", "tenants.deleted_at"],
    "src/app/api/cron/sync-vision-video/route.ts": ["tenants.azure_subscription_id", "tenants.deleted_at"],

    // Resolución del nombre de la suscripción: `Subscriptions` no existe y `TenantSubscriptions` no tiene
    // `subscription_id` ni `display_name`. Más columnas de snapshots de Search que no son las de la tabla.
    "src/services/azureAiSearch.service.ts": [
        "azuresearchsnapshots.documentscount",
        "azuresearchsnapshots.storageusedgb",
        "subscriptions",
        "tenantsubscriptions.display_name",
        "tenantsubscriptions.subscription_id",
    ],
    "src/services/azureDocumentIntelligence.service.ts": [
        "costmetersnapshots.resource_id",
        "subscriptions",
        "tenantsubscriptions.display_name",
        "tenantsubscriptions.subscription_id",
    ],

    // Ya corregida en refactor/auditoria-2026-10-10 (d298f7d): borrar la línea al mergear esa rama.
    "src/services/azureAiSummary.service.ts": ["azuredocumentintelligencesnapshots.lastaccesseddaysago"],

    // Sueltas. La tabla se llama `recommendation_exemptions` (con guion bajo); `SaaSInvoices` no está en ninguna migración.
    "src/services/azureOrphanBackups.service.ts": ["recommendationexemptions"],
    "src/services/saasBilling.service.ts": ["saasinvoices"],
    // Falso positivo del parser del DDL, no un defecto: SchemaMigrations existe (la crea el propio runner) pero su
    // CREATE TABLE termina en una comilla y `ddlVersionado.ts` sólo reconoce el cierre `) ENGINE|;`.
    "src/modules/storage/migrations.ts": ["schemamigrations"],
};

/** Cada literal de texto de un archivo TypeScript (los comentarios no son nodos, así que nunca se confunden con SQL). */
function literalesDe(rel: string): string[] {
    const texto = readFileSync(join(RAIZ, rel), "utf8");
    const fuente = ts.createSourceFile(rel, texto, ts.ScriptTarget.Latest, true);
    const literales: string[] = [];
    const visitar = (nodo: import("typescript").Node) => {
        // Sólo los literales sin interpolaciones: ver ALCANCE.
        if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) literales.push(nodo.text);
        ts.forEachChild(nodo, visitar);
    };
    visitar(fuente);
    return literales;
}

/** Todos los SELECT analizables de `src/`, por archivo, con lo que MySQL rechazaría de cada uno. */
function escanear() {
    const archivos = execSync("grep -rlE 'SELECT' src --include='*.ts'", { cwd: RAIZ, encoding: "utf8" })
        .trim().split("\n").filter(Boolean);
    const analisisPorArchivo = new Map<string, AnalisisSelect[]>();
    const problemasPorArchivo = new Map<string, Set<string>>();
    let analizados = 0;
    for (const rel of archivos) {
        for (const sql of literalesDe(rel)) {
            const analisis = analizarSelect(sql);
            if (!analisis) continue;
            analizados++;
            analisisPorArchivo.set(rel, [...(analisisPorArchivo.get(rel) ?? []), analisis]);
            for (const p of problemasDeSelect(sql, ESQUEMA)) {
                // "tabla.columna: la columna no existe en el DDL" -> "tabla.columna"; "tabla: la tabla no existe..." -> "tabla"
                const clave = p.replace(/: la (?:tabla|columna) no existe en el DDL$/, "");
                problemasPorArchivo.set(rel, (problemasPorArchivo.get(rel) ?? new Set()).add(clave));
            }
        }
    }
    return { analizados, analisisPorArchivo, problemasPorArchivo };
}

const escaneo = escanear();

describe("SELECT de una sola tabla contra el DDL versionado", () => {
    it("el DDL se parsea y el extractor sigue encontrando consultas (si esto falla, el resto no prueba nada)", () => {
        expect(ESQUEMA.get("anomalies")?.has("z_score")).toBe(true);
        expect(ESQUEMA.get("anomalies")?.has("detected_date")).toBe(false);
        expect(ESQUEMA.get("budgets")?.has("monthly_limit_usd")).toBe(true);
        // Al escribirla eran 563. Con mucho menos, el extractor dejó de leer (o `src/` se vació) y "sin problemas" no significa nada.
        expect(escaneo.analizados).toBeGreaterThan(400);
    });

    it("ningún SELECT NUEVO pide una tabla o una columna inexistente", () => {
        const nuevos: string[] = [];
        for (const [archivo, problemas] of escaneo.problemasPorArchivo) {
            for (const p of problemas) {
                if (!DEUDA[archivo]?.includes(p)) nuevos.push(`${archivo} → ${p}`);
            }
        }
        expect(
            nuevos.sort(),
            "SELECT con una tabla o columna que el DDL versionado no tiene (MySQL lo rechaza y un catch lo vuelve vacío). " +
                "Corregilo contra las migraciones; si es un falso positivo de la guarda, agregalo a DEUDA con el motivo."
        ).toEqual([]);
    });

    it("lo corregido el 2026-10-10 sigue corregido: reporte ejecutivo y tool de anomalías del MCP", () => {
        for (const archivo of ["src/services/executiveReportGenerator.service.ts", "src/app/api/mcp/route.ts"]) {
            const problemas = [...(escaneo.problemasPorArchivo.get(archivo) ?? [])];
            // El MCP conserva sus otras tools rotas (en DEUDA): de las anomalías no debe quedar nada.
            expect(problemas.filter((p) => p.startsWith("anomalies")), archivo).toEqual([]);
            if (archivo.includes("executiveReport")) expect(problemas, archivo).toEqual([]);
        }
        // No pasa en vacío: la guarda sí vio esas consultas.
        const tablasDelReporte = (escaneo.analisisPorArchivo.get("src/services/executiveReportGenerator.service.ts") ?? []).map((a) => a.tabla);
        expect(tablasDelReporte).toEqual(expect.arrayContaining(["anomalies", "budgets"]));
    });

    it("los dos errores sueltos de producción ya no están en el código: `resolved_at` y `resource_id` de CostSnapshots", () => {
        // `[API Anomalies] Live assembly error: Unknown column 'resolved_at'` (una vez, 2026-09-13 22:41 UTC): la columna
        // la agregó la migración 20260914-001, que entró al día siguiente, y la ruta ya la pide. No volvió a aparecer.
        const anomalias = (escaneo.analisisPorArchivo.get("src/app/api/analytics/anomalies/route.ts") ?? []).find((a) => a.tabla === "anomalies");
        expect(anomalias?.columnas, "la guarda no analizó el SELECT de Anomalies de la ruta").toContain("resolved_at");
        expect(escaneo.problemasPorArchivo.get("src/app/api/analytics/anomalies/route.ts")).toBeUndefined();

        // `[realConsumptionService] MEJ-29 CostSnapshots lookup fallback: Unknown column 'resource_id'` (una vez,
        // 2026-09-14 09:43 UTC): el arreglo ad437d3 entró ocho minutos después y la consulta ya pide `ResourceId`.
        const deSnapshots = (escaneo.analisisPorArchivo.get("src/services/realConsumptionService.ts") ?? []).filter((a) => a.tabla === "costsnapshots");
        expect(
            deSnapshots.some((a) => a.columnas.includes("resourceid")),
            "la guarda no analizó el SELECT de CostSnapshots de MEJ-29"
        ).toBe(true);
        expect(deSnapshots.some((a) => a.columnas.includes("resource_id"))).toBe(false);
        expect([...(escaneo.problemasPorArchivo.get("src/services/realConsumptionService.ts") ?? [])].filter((p) => p.startsWith("costsnapshots"))).toEqual([]);
    });
});
