// @vitest-environment node
/**
 * El resumen de IA tiene que poder leer las 8 tablas de snapshots de las que arma su desglose.
 *
 * `fetchAiServiceCapability` pedía `resourceGroup` y `lastAccessedDaysAgo` a las tablas de Speech/Language,
 * Vision/Video, Content Safety, AML y Databricks. Ninguna de las cinco las tiene (las migraciones 20260812-004 a
 * -008 no las crean; las de Search, DocIntel y Foundry sí), y Databricks nombra `workspaceId` / `workspaceName`
 * en vez de `resourceId` / `resourceName`. MySQL rechazaba el SELECT con `Unknown column 'resourceGroup' in
 * 'field list'`, el `catch` lo registraba y devolvía null: esas cinco capacidades no aparecían en el resumen y
 * nada lo mostraba. Producción lo registró en 9 de 30 días (medido el 2026-10-10 en Log Analytics).
 *
 * Los mocks de `pool.query` de otros tests aceptan cualquier SELECT, por eso nadie lo vio. Acá la base falsa lee el
 * DDL REAL del repo (`__tests__/helpers/ddlVersionado.ts`, el de `insertColumnasExisten`, que sólo cubre los INSERT) y
 * rechaza, como MySQL, toda columna que la tabla no tiene (y los datos de prueba tampoco pueden inventar columnas).
 *
 * Aparte: `mapCapabilityKey` mandaba `doc_intelligence` (la clave con la que el propio servicio arma esa
 * capacidad) al `foundry` por defecto: con recursos de Document Intelligence, la fila de Foundry mostraba su costo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { columnasPorTabla } from "../helpers/ddlVersionado";

const { query, cacheCapabilities } = vi.hoisted(() => ({ query: vi.fn(), cacheCapabilities: vi.fn() }));

vi.mock("@/modules/storage/db", () => ({ default: { query } }));
vi.mock("@/lib/aiServiceCache", () => ({
    getCachedCapabilities: vi.fn().mockResolvedValue(null),
    cacheCapabilities,
}));
vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn().mockResolvedValue({}),
    getResourceGraphClient: vi.fn().mockResolvedValue({ resources: async () => ({ data: [] }) }),
}));
vi.mock("@/modules/collectors/azure/azureSearchCollector", () => ({
    syncAzureSearchSnapshots: vi.fn().mockResolvedValue(undefined),
    getAzureSearchResources: vi.fn().mockResolvedValue([]),
    getAzureSearchRealCost: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/modules/collectors/azure/docIntelCollector", () => ({
    syncDocIntelSnapshots: vi.fn().mockResolvedValue(undefined),
    getDocIntelResources: vi.fn().mockResolvedValue([]),
    getDocIntelRealCost: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/modules/collectors/azure/foundryCollector", () => ({
    syncFoundrySnapshots: vi.fn().mockResolvedValue(undefined),
    getFoundryResourceCost: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/modules/collectors/azure/aiServiceCollectors", () => ({
    syncSpeechLanguageSnapshots: vi.fn().mockResolvedValue(undefined),
    getSpeechLanguageResources: vi.fn().mockResolvedValue([]),
    syncVisionVideoSnapshots: vi.fn().mockResolvedValue(undefined),
    getVisionVideoResources: vi.fn().mockResolvedValue([]),
    syncContentSafetySnapshots: vi.fn().mockResolvedValue(undefined),
    getContentSafetyResources: vi.fn().mockResolvedValue([]),
    syncAMLSnapshots: vi.fn().mockResolvedValue(undefined),
    getAMLResources: vi.fn().mockResolvedValue([]),
    syncDatabricksSnapshots: vi.fn().mockResolvedValue(undefined),
    getDatabricksResources: vi.fn().mockResolvedValue([]),
    getAiServiceRealCost: vi.fn().mockResolvedValue(0),
}));

import { getAzureAiSummary } from "@/services/azureAiSummary.service";

const TENANT = "8b41364f-581a-4e43-b7cb-13138dac5517";
const TABLAS = [
    "AzureSearchSnapshots",
    "AzureDocumentIntelligenceSnapshots",
    "AzureFoundrySnapshots",
    "AzureSpeechLanguageSnapshots",
    "AzureVisionVideoSnapshots",
    "AzureContentSafetySnapshots",
    "AzureMLSnapshots",
    "AzureDatabricksSnapshots",
];

// ── DDL real del repo ───────────────────────────────────────────────────────

const ESQUEMA = columnasPorTabla();

// ── Base falsa: valida cada SELECT contra ese DDL ───────────────────────────

type Fila = Record<string, unknown>;

/** Un SELECT de columnas simples (`a`, `b AS c`, `*`) sobre una tabla. Todo lo demás se rechaza para que nadie lo pase por alto. */
function baseFalsa(tablas: Record<string, Fila[]>, violaciones: string[]) {
    return async (sql: string, params: unknown[] = []) => {
        const m = /SELECT\s+([\s\S]+?)\s+FROM\s+`?(\w+)`?\s+WHERE\s+([\s\S]*)$/i.exec(sql);
        if (!m) throw new Error(`la base falsa no entiende esta consulta: ${sql.slice(0, 120)}`);
        const [, lista, tabla, donde] = m;
        const columnas = ESQUEMA.get(tabla.toLowerCase());
        if (!columnas) {
            violaciones.push(`${tabla}: la tabla no existe en las migraciones`);
            throw Object.assign(new Error(`Table '${tabla}' doesn't exist`), { code: "ER_NO_SUCH_TABLE" });
        }
        if (!/tenantId\s*=\s*\?/.test(donde) || params[0] !== TENANT) {
            violaciones.push(`${tabla}: la consulta no está acotada al tenant (WHERE tenantId = ?)`);
        }
        const filas = tablas[tabla] ?? [];
        for (const fila of filas) {
            for (const k of Object.keys(fila)) {
                if (!columnas.has(k.toLowerCase())) violaciones.push(`${tabla}: los datos de prueba traen la columna inexistente ${k}`);
            }
        }
        if (lista.trim() === "*") return [filas.map((f) => ({ ...f })), []];
        const pedidas = lista.split(",").map((item) => {
            const p = /^`?(\w+)`?(?:\s+AS\s+`?(\w+)`?)?$/i.exec(item.trim().replace(/\s+/g, " "));
            if (!p) throw new Error(`la base falsa no entiende la expresión «${item.trim()}»`);
            return { origen: p[1], alias: p[2] ?? p[1] };
        });
        const inexistentes = pedidas.filter((c) => !columnas.has(c.origen.toLowerCase()));
        if (inexistentes.length) {
            const col = inexistentes[0].origen;
            violaciones.push(`${tabla}: pide la columna ${col}, que no existe en el DDL`);
            throw Object.assign(new Error(`Unknown column '${col}' in 'field list'`), { code: "ER_BAD_FIELD_ERROR" });
        }
        return [filas.map((f) => Object.fromEntries(pedidas.map((c) => [c.alias, f[c.origen]]))), []];
    };
}

const instante = "2026-10-09";

/** Una fila por tabla, con las columnas que de verdad tiene. */
const DATOS: Record<string, Fila[]> = {
    AzureSearchSnapshots: [
        { resourceId: "/subscriptions/s/rg/search1", resourceName: "search1", resourceGroup: "rg-ai", region: "eastus", monthlyCostUSD: "1000.00", utilizationPercent: 50, lastAccessedDaysAgo: 2, snapshotDate: instante },
    ],
    AzureDocumentIntelligenceSnapshots: [
        { resourceId: "/subscriptions/s/rg/di1", resourceName: "di1", resourceGroup: "rg-ai", region: "eastus", monthlyCostUSD: "50.00", utilizationPercent: 40, snapshotDate: instante },
    ],
    AzureFoundrySnapshots: [
        { resourceId: "/subscriptions/s/rg/foundry1", resourceName: "foundry1", resourceGroup: "rg-ai", region: "eastus", deploymentName: "gpt-4o", monthlyCostUSD: "700.00", utilizationPercent: 60, lastAccessedDaysAgo: 1, snapshotDate: instante },
    ],
    AzureSpeechLanguageSnapshots: [
        { resourceId: "/subscriptions/s/rg/speech1", resourceName: "speech1", region: "eastus", tier: "s0", monthlyCostUSD: "100.00", utilizationPercent: 30, snapshotDate: instante },
    ],
    AzureVisionVideoSnapshots: [
        { resourceId: "/subscriptions/s/rg/vision1", resourceName: "vision1", region: "eastus", tier: "s1", monthlyCostUSD: "200.00", utilizationPercent: 30, snapshotDate: instante },
    ],
    AzureContentSafetySnapshots: [
        { resourceId: "/subscriptions/s/rg/safety1", resourceName: "safety1", region: "eastus", tier: "s0", monthlyCostUSD: "300.00", utilizationPercent: 30, snapshotDate: instante },
    ],
    AzureMLSnapshots: [
        { resourceId: "/subscriptions/s/rg/ml1", resourceName: "ml1", region: "eastus", monthlyCostUSD: "40.00", utilizationPercent: 30, snapshotDate: instante },
        { resourceId: "/subscriptions/s/rg/ml2", resourceName: "ml2", region: "eastus", monthlyCostUSD: "60.00", utilizationPercent: 30, snapshotDate: instante },
    ],
    // Databricks no tiene resourceId/resourceName: nombra al workspace.
    AzureDatabricksSnapshots: [
        { workspaceId: "/subscriptions/s/rg/dbx-prod", workspaceName: "dbx-prod", region: "eastus", tier: "premium", monthlyCostUSD: "500.00", utilizationPercent: 30, snapshotDate: instante },
    ],
};

type Resumen = Awaited<ReturnType<typeof getAzureAiSummary>>;
const fila = (r: Resumen, clave: string) => r.capabilityBreakdown.find((c) => c.capabilityKey === clave)!;

let violaciones: string[];
let consolaError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    violaciones = [];
    cacheCapabilities.mockReset().mockResolvedValue(undefined);
    consolaError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => consolaError.mockRestore());

describe("el DDL que lee la base falsa", () => {
    it("trae las 8 tablas del resumen con las columnas que el servicio necesita", () => {
        for (const tabla of TABLAS) {
            const columnas = ESQUEMA.get(tabla.toLowerCase());
            expect(columnas, `${tabla} no está en el DDL del repo`).toBeDefined();
            for (const c of ["tenantId", "snapshotDate", "monthlyCostUSD", "utilizationPercent"]) {
                expect(columnas!.has(c.toLowerCase()), `${tabla}.${c}`).toBe(true);
            }
        }
        // Databricks nombra al workspace; las otras siete, al recurso.
        expect(ESQUEMA.get("azuredatabrickssnapshots")!.has("workspacename")).toBe(true);
        expect(ESQUEMA.get("azuremlsnapshots")!.has("resourcename")).toBe(true);
    });
});

describe("getAzureAiSummary con un tenant real", () => {
    it("pide sólo columnas que existen, a las 8 tablas, y ninguna capacidad falla", async () => {
        query.mockImplementation(baseFalsa(DATOS, violaciones));

        await getAzureAiSummary(TENANT);

        expect(violaciones).toEqual([]);
        expect(consolaError.mock.calls.filter(([m]) => String(m).startsWith("[azureAiSummary]"))).toEqual([]);
        const tablasPedidas = new Set(query.mock.calls.map(([sql]) => /FROM\s+`?(\w+)`?/i.exec(String(sql))![1]));
        expect([...tablasPedidas].sort()).toEqual([...TABLAS].sort());
    });

    it("las ocho capacidades salen con su costo y sus recursos, cada una en su fila", async () => {
        query.mockImplementation(baseFalsa(DATOS, violaciones));

        const r = await getAzureAiSummary(TENANT);

        const esperado: Record<string, [string, number]> = {
            foundry: ["700.00", 1],
            search: ["1000.00", 1],
            doc_intelligence: ["50.00", 1],
            speech_language: ["100.00", 1],
            vision_video: ["200.00", 1],
            content_safety: ["300.00", 1],
            machine_learning: ["100.00", 2],
            databricks: ["500.00", 1],
        };
        for (const [clave, [costo, recursos]] of Object.entries(esperado)) {
            expect({ clave, costo: fila(r, clave).costMtdUSD, recursos: fila(r, clave).activeResourcesCount }, clave).toEqual({
                clave,
                costo,
                recursos,
            });
        }
        expect(r.metrics.totalCostMtdUSD).toBe("2950.00");
        expect(violaciones).toEqual([]);
    });

    it("el workspace de Databricks conserva su nombre en lo que se cachea", async () => {
        query.mockImplementation(baseFalsa(DATOS, violaciones));

        await getAzureAiSummary(TENANT);

        const cacheado = cacheCapabilities.mock.calls[0][1] as Array<{ capability: string; resources: Array<{ name: string }> }>;
        expect(cacheado.find((c) => c.capability === "databricks")?.resources.map((x) => x.name)).toEqual(["dbx-prod"]);
        expect(cacheado.find((c) => c.capability === "aml")?.resources.map((x) => x.name).sort()).toEqual(["ml1", "ml2"]);
    });

    it("sólo cachea las capacidades que tienen recursos (el caché es el de /api/intelligence/azure-ai)", async () => {
        query.mockImplementation(baseFalsa({ AzureSpeechLanguageSnapshots: DATOS.AzureSpeechLanguageSnapshots }, violaciones));

        const r = await getAzureAiSummary(TENANT);

        const cacheado = cacheCapabilities.mock.calls[0][1] as Array<{ capability: string }>;
        expect(cacheado.map((c) => c.capability)).toEqual(["speech-language"]);
        // El resumen sigue trayendo las ocho filas, las vacías en cero.
        expect(r.capabilityBreakdown).toHaveLength(8);
        expect(fila(r, "speech_language").costMtdUSD).toBe("100.00");
        expect(fila(r, "vision_video").costMtdUSD).toBe("0.00");
    });

    it("sin recursos de IA en ninguna tabla: ocho filas en cero, nada en el caché y sin errores", async () => {
        query.mockImplementation(baseFalsa({}, violaciones));

        const r = await getAzureAiSummary(TENANT);

        expect(r.capabilityBreakdown).toHaveLength(8);
        expect(r.capabilityBreakdown.every((c) => c.costMtdUSD === "0.00" && c.activeResourcesCount === 0)).toBe(true);
        expect(r.metrics.totalCostMtdUSD).toBe("0.00");
        expect(cacheCapabilities.mock.calls[0][1]).toEqual([]);
        expect(violaciones).toEqual([]);
        expect(consolaError.mock.calls.filter(([m]) => String(m).startsWith("[azureAiSummary]"))).toEqual([]);
    });
});
