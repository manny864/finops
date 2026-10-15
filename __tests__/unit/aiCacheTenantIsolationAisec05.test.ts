// @vitest-environment node
/**
 * AISEC-05: AiCache aislada por tenant + blobs con carpeta por tenant.
 *
 * Criterios del plan maestro: dos tenants con el mismo payload → claves distintas; leer con otro
 * tenantId → null; un stored_name de otro tenant no se sirve; la baja deja 0 filas de AiCache.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { promises as fs, readFileSync } from "fs";
import os from "os";
import path from "path";

const { queryMock, executeMock, getGeminiModelMock, generateTextMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    executeMock: vi.fn(),
    getGeminiModelMock: vi.fn(),
    generateTextMock: vi.fn(),
}));

vi.mock("@/modules/storage/db", () => ({
    default: {
        query: queryMock,
        getConnection: async () => ({
            beginTransaction: async () => {},
            commit: async () => {},
            rollback: async () => {},
            release: () => {},
            execute: executeMock,
        }),
    },
    insertPlatformAiUsage: vi.fn(),
}));
vi.mock("@/modules/core/aiProvider", () => ({
    AIProviderFactory: { getGeminiModel: getGeminiModelMock },
    aiQueue: { add: (fn: () => unknown) => fn() },
    withExponentialBackoff: (fn: () => unknown) => fn(),
}));
vi.mock("ai", () => ({ generateText: generateTextMock }));

import { AI_CACHE_PLATFORM_SCOPE, aiCacheGet, aiCacheKey, aiCacheSet, aiCachePurgeExpired } from "@/lib/aiCache";
import { teardownTenant } from "@/services/tenantTeardownService";
import { narrateAdvisorRecommendations } from "@/services/advisorRemediationNarration";
import { generateAdvisorRemediationAction } from "@/lib/advisorRemediation";
import type { AdvisorRecommendation } from "@/types/azureAdvisor.types";

/** AiCache en memoria con la semántica de las 4 sentencias de src/lib/aiCache.ts. */
type Row = { tenant_id: string | null; response_text: string; expires_at: number | null };
const table = new Map<string, Row>();
function fakeDb(sql: string, params: unknown[]): unknown {
    const s = sql.replace(/\s+/g, " ").trim();
    if (s.startsWith("SELECT response_text FROM AiCache")) {
        const [key, tenant] = params as [string, string];
        const r = table.get(key);
        return [r && r.tenant_id === tenant && r.expires_at !== null && r.expires_at > Date.now() ? [r] : []];
    }
    if (s.startsWith("INSERT INTO AiCache")) {
        const [key, tenant, text, ttl] = params as [string, string, string, number];
        const prev = table.get(key);
        if (!prev || prev.tenant_id === tenant) {
            table.set(key, { tenant_id: tenant, response_text: text, expires_at: Date.now() + ttl * 3600_000 });
        }
        return [{ affectedRows: 1 }];
    }
    if (s.startsWith("DELETE FROM AiCache WHERE tenant_id = ?")) {
        let n = 0;
        for (const [k, r] of table) if (r.tenant_id === params[0]) (table.delete(k), n++);
        return [{ affectedRows: n }];
    }
    if (s.startsWith("DELETE FROM AiCache WHERE tenant_id IS NULL")) {
        let n = 0;
        for (const [k, r] of table)
            if (r.tenant_id === null || r.expires_at === null || r.expires_at < Date.now()) (table.delete(k), n++);
        return [{ affectedRows: n }];
    }
    return [[]];
}

beforeEach(() => {
    table.clear();
    queryMock.mockReset().mockImplementation(async (sql: string, params: unknown[] = []) => fakeDb(sql, params));
    executeMock.mockReset().mockImplementation(async (sql: string, params: unknown[] = []) => fakeDb(sql, params));
    generateTextMock.mockReset();
    getGeminiModelMock.mockReset();
});

describe("AISEC-05 — clave de AiCache", () => {
    it("dos tenants con el mismo payload obtienen claves distintas (64 hex)", () => {
        const a = aiCacheKey("tenant-a", "assessment:v2", "gpt-4o", "es", "USD", "{}");
        const b = aiCacheKey("tenant-b", "assessment:v2", "gpt-4o", "es", "USD", "{}");
        expect(a).not.toBe(b);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it("el prefijo de longitud evita colisiones por corrimiento de separadores", () => {
        expect(aiCacheKey("t", "a:b", "c")).not.toBe(aiCacheKey("t", "a", "b:c"));
        expect(aiCacheKey("t:a", "b")).not.toBe(aiCacheKey("t", "a:b"));
    });

    it("el modelo y la versión del prompt cambian la clave", () => {
        expect(aiCacheKey("t", "v1", "gpt-4o", "x")).not.toBe(aiCacheKey("t", "v1", "gemini", "x"));
        expect(aiCacheKey("t", "v1", "m", "x")).not.toBe(aiCacheKey("t", "v2", "m", "x"));
    });
});

describe("AISEC-05 — lectura/escritura filtradas por tenant", () => {
    it("leer con el tenantId de otro devuelve null aunque la clave coincida", async () => {
        await aiCacheSet("tenant-a", "k1", "respuesta de A");
        expect(await aiCacheGet("tenant-a", "k1")).toBe("respuesta de A");
        expect(await aiCacheGet("tenant-b", "k1")).toBeNull();
        expect(queryMock.mock.calls.find(([q]) => String(q).startsWith("SELECT"))![0]).toMatch(/tenant_id = \?/);
    });

    it("un tenant no puede pisar la fila de otro con la misma clave", async () => {
        await aiCacheSet("tenant-a", "k1", "original");
        await aiCacheSet("tenant-b", "k1", "envenenado");
        expect(await aiCacheGet("tenant-a", "k1")).toBe("original");
        expect(String(queryMock.mock.calls[0][0])).toMatch(/IF\(tenant_id = VALUES\(tenant_id\)/);
    });

    it("las filas legadas (tenant_id NULL) no se leen y el cron las purga junto con las vencidas", async () => {
        table.set("legacy", { tenant_id: null, response_text: "viejo", expires_at: null });
        table.set("vencida", { tenant_id: "tenant-a", response_text: "x", expires_at: Date.now() - 1000 });
        await aiCacheSet("tenant-a", "viva", "ok");
        expect(await aiCacheGet("tenant-a", "vencida")).toBeNull();
        expect(await aiCachePurgeExpired()).toBe(2);
        expect([...table.keys()]).toEqual(["viva"]);
    });

    it("la baja del tenant (teardownTenant) deja 0 filas suyas en AiCache y no toca las de otros", async () => {
        await aiCacheSet("tenant-a", "k1", "a1");
        await aiCacheSet("tenant-a", "k2", "a2");
        await aiCacheSet("tenant-b", "k3", "b");
        await teardownTenant("tenant-a");
        expect([...table.values()].filter((r) => r.tenant_id === "tenant-a")).toHaveLength(0);
        expect(table.get("k3")?.tenant_id).toBe("tenant-b");
    });

    it("DELETE /api/tenants también purga AiCache", () => {
        const src = readFileSync(path.join(process.cwd(), "src/app/api/tenants/route.ts"), "utf8");
        expect(src).toMatch(/DELETE FROM AiCache WHERE tenant_id = \?/);
    });

    it("ningún módulo fuera de src/lib/aiCache.ts consulta AiCache directo (salvo las bajas)", async () => {
        const { execSync } = await import("child_process");
        const out = execSync("git grep --untracked -l -E \"(FROM|INTO) AiCache\" -- src", { encoding: "utf8" }).trim().split("\n");
        expect(out.sort()).toEqual(
            ["src/app/api/tenants/route.ts", "src/lib/aiCache.ts", "src/services/tenantTeardownService.ts"].sort(),
        );
    });

    it("la migración agrega tenant_id y expires_at con índices", () => {
        const sql = readFileSync(
            path.join(process.cwd(), "migrations/20261014-036-aicache-tenant-y-vencimiento.sql"),
            "utf8",
        );
        expect(sql).toMatch(/ADD COLUMN tenant_id/);
        expect(sql).toMatch(/ADD COLUMN expires_at/);
        expect(sql).toMatch(/idx_aicache_tenant/);
        expect(sql).toMatch(/idx_aicache_expires/);
    });
});

describe("AISEC-05 — narración de Advisor: caché compartida sólo con el modelo de la plataforma", () => {
    function rec(): AdvisorRecommendation {
        const r: Partial<AdvisorRecommendation> = {
            resourceName: "sa-1",
            titleTranslated: "Completar etiquetas obligatorias",
            resource: { rawId: "", subscriptionId: "s1", resourceGroup: "rg", resourceType: "Microsoft.Storage/storageAccounts", resourceName: "sa-1" },
        };
        r.aiSuggestedAction = generateAdvisorRemediationAction(r);
        return r as AdvisorRecommendation;
    }

    async function narrateAs(tenant: string, source: "platform" | "byok", text: string) {
        getGeminiModelMock.mockResolvedValue({ model: {}, modelName: "m", config: { source, provider: "openai" } });
        generateTextMock.mockReset().mockResolvedValue({ text, usage: { inputTokens: 1, outputTokens: 1 } });
        const r = rec();
        await narrateAdvisorRecommendations([r], tenant, "es");
        return r.aiSuggestedAction?.actionDescription ?? "";
    }

    it("BYOK: la salida del modelo del tenant queda en su alcance y no la ven los demás", async () => {
        const poisoned = await narrateAs("atacante", "byok", "Texto del atacante para {name}.");
        expect(generateTextMock).toHaveBeenCalledTimes(1);
        expect(poisoned).toContain("Texto del atacante");
        expect([...table.values()].every((r) => r.tenant_id === "atacante")).toBe(true);

        const victim = await narrateAs("victima", "platform", "Texto de la plataforma para {name}.");
        expect(generateTextMock).toHaveBeenCalledTimes(1); // no reusó la entrada del atacante
        expect(victim).toContain("Texto de la plataforma");
        expect([...table.values()].some((r) => r.tenant_id === AI_CACHE_PLATFORM_SCOPE)).toBe(true);
    });
});

describe("AISEC-05 — blobs con carpeta por tenant", () => {
    const dirs: string[] = [];
    afterAll(async () => {
        for (const d of dirs) await fs.rm(d, { recursive: true, force: true });
    });

    async function withLocalDirs() {
        delete process.env.AZURE_STORAGE_CONNECTION_STRING;
        const base = await fs.mkdtemp(path.join(os.tmpdir(), "aisec05-"));
        dirs.push(base);
        process.env.SUPPORT_UPLOAD_DIR = path.join(base, "support");
        process.env.EXECUTIVE_REPORT_UPLOAD_DIR = path.join(base, "reports");
        return base;
    }

    it("adjuntos de soporte: se guardan bajo la carpeta del tenant y otro tenant no los lee ni los borra", async () => {
        await withLocalDirs();
        const { saveAttachment, readAttachment, deleteAttachmentFile } = await import("@/lib/supportAttachments");
        const { tenantBlobPrefix } = await import("@/lib/tenantBlobPath");
        const name = await saveAttachment("tenant-a", Buffer.from("hola"), "txt");
        expect(name).toMatch(new RegExp(`^${tenantBlobPrefix("tenant-a")}/[0-9a-f-]{36}\\.txt$`));
        expect(name).not.toContain("tenant-a");
        expect(name.length).toBeLessThanOrEqual(80); // SupportTicketAttachments.stored_name VARCHAR(80)

        expect((await readAttachment("tenant-a", name))?.toString()).toBe("hola");
        expect(await readAttachment("tenant-b", name)).toBeNull();
        await deleteAttachmentFile("tenant-b", name);
        expect(await readAttachment("tenant-a", name)).not.toBeNull();
        await deleteAttachmentFile("tenant-a", name);
        expect(await readAttachment("tenant-a", name)).toBeNull();
    });

    it("reportes ejecutivos: mismo aislamiento; los nombres legados planos se siguen leyendo", async () => {
        const base = await withLocalDirs();
        const { saveExecutiveReportMarkdown, readExecutiveReportMarkdown } = await import("@/lib/executiveReportStorage");
        const name = await saveExecutiveReportMarkdown("tenant-a", "# A");
        expect(await readExecutiveReportMarkdown("tenant-a", name)).toBe("# A");
        expect(await readExecutiveReportMarkdown("tenant-b", name)).toBeNull();

        const legacy = "123e4567-e89b-12d3-a456-426614174000.md";
        await fs.writeFile(path.join(base, "reports", legacy), "# legado");
        expect(await readExecutiveReportMarkdown("tenant-a", legacy)).toBe("# legado");
    });

    it("rechaza nombres con traversal o carpetas que no son del tenant", async () => {
        const { resolveTenantStoredName, tenantBlobPrefix } = await import("@/lib/tenantBlobPath");
        const re = /^[0-9a-f-]{36}\.md$/i;
        const leaf = "123e4567-e89b-12d3-a456-426614174000.md";
        const p = tenantBlobPrefix("t");
        expect(resolveTenantStoredName("t", `${p}/${leaf}`, re)).toBe(`${p}/${leaf}`);
        expect(resolveTenantStoredName("t", `../${leaf}`, re)).toBeNull();
        expect(resolveTenantStoredName("t", `${p}/../${leaf}`, re)).toBeNull();
        expect(resolveTenantStoredName("t", `${p}/x/${leaf}`, re)).toBeNull();
        expect(resolveTenantStoredName("t", `${tenantBlobPrefix("otro")}/${leaf}`, re)).toBeNull();
    });
});
