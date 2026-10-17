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
 * Al escribirla (2026-10-10) había 72 problemas en 39 archivos; abajo están como DEUDA. La guarda falla ante lo
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
    // Salieron el 2026-10-16 al endurecer la guarda: un alias igual a la columna (`SubscriptionId AS subscriptionId`,
    // `LOWER(resource_id) AS resource_id`) la tapaba. CostSnapshots tiene `subscription_id`, no `SubscriptionId` ni
    // `SubscriptionName`, y ni CostSnapshots ni CostMeterSnapshots tienen `resource_id` (la columna es `ResourceId`, sólo en
    // CostSnapshots). Son bugs reales, sin corregir todavía.
    "src/app/api/analytics/macc/route.ts": ["costsnapshots.subscriptionid", "costsnapshots.subscriptionname"],
    "src/services/azureLogicApps.service.ts": ["costmetersnapshots.resource_id", "costsnapshots.resource_id"],

    // La cuota de reembolsos de reservas pide `ChargeType` y `ChargeDescription` a CostSnapshots, que no los tiene, y NO
    // hay columna correcta que ponerles: ninguna tabla local guarda el tipo de cargo (FocusLineItems sólo tiene
    // ChargeCategory y nadie la escribe) y CostSnapshots agrega por (grupo, servicio, día), así que un reembolso se
    // netea contra el resto. Tampoco es calculable desde el costo: el límite de 50.000 USD es de COMPROMISO CANCELADO en
    // una ventana móvil de 12 meses por billing scope (enrollment EA, billing profile MCA, cliente CSP), y el reembolso
    // de un intercambio no cuenta (learn.microsoft.com/azure/cost-management-billing/reservations/exchange-and-refund-azure-reservations).
    // La fuente documentada de transacciones Refund/Cancel es Microsoft.Consumption/reservationTransactions, a nivel de
    // billing account. Hoy `getExchangeQuota` cae SIEMPRE en su `catch` y muestra "0 usado, 50.000 restantes" en verde:
    // un desconocido presentado como "queda todo". Decisión de producto pendiente, no de columnas.
    "src/services/azureCommitmentSimulator.service.ts": ["costsnapshots.chargedescription", "costsnapshots.chargetype"],


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
        "subscriptions",
        "tenantsubscriptions.display_name",
        "tenantsubscriptions.subscription_id",
    ],

    // Suelta. La tabla se llama `recommendation_exemptions` (con guion bajo).
    "src/services/azureOrphanBackups.service.ts": ["recommendationexemptions"],
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

    it("lo corregido el 2026-10-10 sigue corregido: reporte ejecutivo, tools del MCP, feed de Power BI y buscador", () => {
        const corregidos = [
            "src/services/executiveReportGenerator.service.ts",
            "src/app/api/mcp/route.ts",
            "src/app/api/exports/powerbi-feed/route.ts",
            "src/services/globalSearch.service.ts",
        ];
        for (const archivo of corregidos) {
            // Ni una consulta a una tabla o columna inexistente, y ninguna entrada en DEUDA que la tape.
            expect([...(escaneo.problemasPorArchivo.get(archivo) ?? [])], archivo).toEqual([]);
            expect(DEUDA[archivo], `${archivo} ya no debe estar en DEUDA`).toBeUndefined();
        }
        // No pasa en vacío: la guarda sí vio esas consultas.
        const tablasDe = (archivo: string) => (escaneo.analisisPorArchivo.get(archivo) ?? []).map((a) => a.tabla);
        expect(tablasDe("src/services/executiveReportGenerator.service.ts")).toEqual(expect.arrayContaining(["anomalies", "budgets"]));
        expect(tablasDe("src/app/api/mcp/route.ts")).toEqual(expect.arrayContaining(["anomalies"]));
        expect(tablasDe("src/app/api/exports/powerbi-feed/route.ts")).toEqual(expect.arrayContaining(["costsnapshots"]));
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
