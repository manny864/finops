// @vitest-environment node
/**
 * PERIM-03 — Cuotas y fronteras de entrada en ingesta, MCP y API v1.
 *
 * Aceptación del plan: cambiar XFF no altera la cuota; claves sin
 * `write:metrics` no escriben; claves sobre cuota no producen SQL de negocio;
 * un body chunked sobredimensionado falla con 413; JSON-RPC inválido no llega a
 * las herramientas; `last_used_at` se escribe sólo tras admitir la llamada.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
    const counters = new Map<string, number>();
    return {
        counters,
        query: vi.fn(),
        upsert: vi.fn(async () => undefined),
        checkByKeyDistributed: vi.fn(async (key: string, limit: number) => {
            const n = (counters.get(key) ?? 0) + 1;
            counters.set(key, n);
            return { allowed: n <= limit, remaining: Math.max(0, limit - n), resetAt: new Date() };
        }),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: { query: h.query, getConnection: vi.fn() },
    initializeDatabase: vi.fn(),
}));
vi.mock("@/lib/rateLimiter", () => ({
    default: { checkByKeyDistributed: h.checkByKeyDistributed },
}));
vi.mock("@/lib/cache", () => ({
    invalidateCache: vi.fn(async () => undefined),
    getWithStaleWhileRevalidate: vi.fn(async () => []),
}));
vi.mock("@/services/azureUnitEconomics.service", async (orig) => ({
    ...(await orig<object>()),
    upsertBusinessUnits: h.upsert,
}));

import { POST as ingestPOST } from "@/app/api/unit-metrics/ingest/route";
import { POST as mcpPOST } from "@/app/api/mcp/route";
import { GET as meGET } from "@/app/api/v1/me/route";
import { POST as shiftLeftPOST } from "@/app/api/v1/shift-left/estimate/route";
import { PREAUTH_LIMIT_PER_MIN, looksLikeKey, __resetKeyGuardsForTests } from "@/lib/apiKeyGuards";
import { trustedClientIp } from "@/lib/trustedClientIp";

const PAK = "pak_test_0123456789abcdef0123456789abcdef";
const MCP = "mcp_live_0123456789abcdef0123456789abcdef0123456789abcdef";
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function keyRow(scopes: string[], rate = 3) {
    return { id: 7, tenant_id: "tenant-1", name: "ci", scopes: JSON.stringify(scopes), rate_limit_per_min: rate };
}

function primeDb(opts: { pak?: ReturnType<typeof keyRow> | null; mcp?: boolean } = {}) {
    h.query.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM PublicApiKeys")) {
            return [opts.pak && params?.[0] === sha(PAK) ? [opts.pak] : []];
        }
        if (sql.includes("FROM MCPApiKeys")) {
            return [opts.mcp && params?.[0] === sha(MCP) ? [{ id: 9, tenant_id: "tenant-1" }] : []];
        }
        return [[]];
    });
}

const sqlCalls = () => h.query.mock.calls.map((c) => String(c[0]));
const flush = () => new Promise((r) => setTimeout(r, 0));

function ingestReq(body: BodyInit | null, headers: Record<string, string> = {}) {
    return new NextRequest("https://app/api/unit-metrics/ingest", {
        method: "POST",
        headers: { "x-api-key": PAK, "content-type": "application/json", ...headers },
        body,
        // @ts-expect-error undici requiere duplex para bodies en stream
        duplex: "half",
    });
}

function mcpReq(body: unknown, headers: Record<string, string> = {}) {
    return new NextRequest("https://app/api/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${MCP}`, "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });
}

/** Stream sin Content-Length: el tope tiene que aplicarse al leer, no por cabecera. */
function chunked(totalBytes: number): ReadableStream<Uint8Array> {
    const chunk = new TextEncoder().encode("[" + " ".repeat(16 * 1024 - 1));
    let sent = 0;
    return new ReadableStream({
        pull(controller) {
            if (sent >= totalBytes) return controller.close();
            controller.enqueue(chunk);
            sent += chunk.byteLength;
        },
    });
}

const row = { metricDate: "2026-10-01", metricType: "TRANSACTIONS", unitCount: 10 };

beforeEach(() => {
    h.counters.clear();
    h.query.mockReset();
    h.upsert.mockClear();
    h.checkByKeyDistributed.mockClear();
    __resetKeyGuardsForTests();
    delete process.env.TRUST_CLOUDFLARE_CLIENT_IP;
    vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("PERIM-03 — ingesta", () => {
    it("cobra la cuota de la clave antes de leer el body; sobre cuota no hay SQL de negocio", async () => {
        primeDb({ pak: keyRow(["write:metrics"], 2) });
        for (let i = 0; i < 2; i++) {
            expect((await ingestPOST(ingestReq(JSON.stringify([row])))).status).toBe(200);
        }
        h.upsert.mockClear();
        const res = await ingestPOST(ingestReq(JSON.stringify([row])));
        expect(res.status).toBe(429);
        expect(res.headers.get("retry-after")).toBe("60");
        expect(h.upsert).not.toHaveBeenCalled();
        expect(h.checkByKeyDistributed).toHaveBeenCalledWith("apikey:7", 2);
    });

    it("comparte presupuesto con /api/v1: misma clave de cuota", async () => {
        primeDb({ pak: keyRow(["write:metrics", "read:cost"], 1) });
        const v1 = await meGET(new NextRequest("https://app/api/v1/me", { headers: { "x-api-key": PAK } }));
        expect(v1.status).toBe(200);
        expect((await ingestPOST(ingestReq(JSON.stringify([row])))).status).toBe(429);
    });

    it("sin write:metrics no escribe ni consume cuota", async () => {
        primeDb({ pak: keyRow(["read:cost"]) });
        expect((await ingestPOST(ingestReq(JSON.stringify([row])))).status).toBe(403);
        expect(h.upsert).not.toHaveBeenCalled();
        expect(h.checkByKeyDistributed).not.toHaveBeenCalledWith("apikey:7", expect.anything());
    });

    it("body chunked sobredimensionado sin Content-Length falla con 413", async () => {
        primeDb({ pak: keyRow(["write:metrics"]) });
        const res = await ingestPOST(ingestReq(chunked(300 * 1024)));
        expect(res.status).toBe(413);
        expect(h.upsert).not.toHaveBeenCalled();
    });

    it("Content-Length declarado sobre el tope falla con 413 sin leer", async () => {
        primeDb({ pak: keyRow(["write:metrics"]) });
        const res = await ingestPOST(ingestReq(JSON.stringify([row]), { "content-length": String(1024 * 1024) }));
        expect(res.status).toBe(413);
    });

    it("JSON inválido sigue siendo 400", async () => {
        primeDb({ pak: keyRow(["write:metrics"]) });
        expect((await ingestPOST(ingestReq("{no"))).status).toBe(400);
    });
});

describe("PERIM-03 — autenticación por clave", () => {
    it("tokens con forma imposible no llegan a MySQL", async () => {
        primeDb();
        for (const bad of ["pak_", "pak_x", `pak_${"a".repeat(500)}`, "pak_test_' OR 1=1 --"]) {
            const res = await ingestPOST(ingestReq("[]", { "x-api-key": bad }));
            expect(res.status).toBe(401);
        }
        const res = await mcpPOST(mcpReq({ method: "tools/list" }, { authorization: "Bearer mcp_<script>" }));
        expect(res.status).toBe(401);
        expect(h.query).not.toHaveBeenCalled();
    });

    it("las claves reales generadas pasan el filtro de forma", () => {
        expect(looksLikeKey(PAK, "pak_")).toBe(true);
        expect(looksLikeKey(MCP, "mcp_")).toBe(true);
        expect(looksLikeKey(MCP, "pak_")).toBe(false);
    });

    it("last_used_at se escribe sólo tras admitir, una vez por minuto, y loguea errores", async () => {
        primeDb({ pak: keyRow(["write:metrics"], 1) });
        await ingestPOST(ingestReq(JSON.stringify([row])));
        await ingestPOST(ingestReq(JSON.stringify([row]))); // 429
        await flush();
        const updates = sqlCalls().filter((q) => q.includes("UPDATE PublicApiKeys SET last_used_at"));
        expect(updates).toHaveLength(1);

        __resetKeyGuardsForTests();
        h.counters.clear();
        h.query.mockImplementation(async (sql: string) => {
            if (sql.startsWith("UPDATE")) throw new Error("lock wait timeout");
            return [[keyRow(["write:metrics"])]];
        });
        await ingestPOST(ingestReq(JSON.stringify([row])));
        await flush();
        expect(console.error).toHaveBeenCalledWith(
            "[api-key] last_used_at update failed",
            expect.objectContaining({ table: "PublicApiKeys", keyId: 7 })
        );
    });
});

describe("PERIM-03 — presupuesto pre-auth por IP confiable", () => {
    it("sin contrato de proxy no confía en ninguna cabecera de IP", () => {
        const req = new Request("https://app", { headers: { "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" } });
        expect(trustedClientIp(req)).toBeNull();
        process.env.TRUST_CLOUDFLARE_CLIENT_IP = "true";
        expect(trustedClientIp(req)).toBe("1.2.3.4");
        expect(trustedClientIp(new Request("https://app", { headers: { "cf-connecting-ip": "not-an-ip" } }))).toBeNull();
        expect(trustedClientIp(new Request("https://app", { headers: { "x-forwarded-for": "5.6.7.8" } }))).toBeNull();
    });

    it("rotar X-Forwarded-For no evade la cuota; superada, no hay consultas de clave", async () => {
        process.env.TRUST_CLOUDFLARE_CLIENT_IP = "true";
        primeDb();
        for (let i = 0; i < PREAUTH_LIMIT_PER_MIN; i++) {
            await ingestPOST(ingestReq("[]", { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": `10.0.0.${i % 250}` }));
        }
        h.query.mockClear();
        const res = await ingestPOST(ingestReq("[]", { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1" }));
        expect(res.status).toBe(429);
        expect(h.query).not.toHaveBeenCalled();
        expect(h.checkByKeyDistributed).toHaveBeenLastCalledWith("preauth:apikey:203.0.113.9", PREAUTH_LIMIT_PER_MIN, 60_000);
    });

    it("MCP también corta antes de autenticar", async () => {
        process.env.TRUST_CLOUDFLARE_CLIENT_IP = "true";
        h.counters.set("preauth:mcp:203.0.113.9", PREAUTH_LIMIT_PER_MIN);
        primeDb({ mcp: true });
        const res = await mcpPOST(mcpReq({ method: "tools/list" }, { "cf-connecting-ip": "203.0.113.9" }));
        expect(res.status).toBe(429);
        expect((await res.json()).error.code).toBe(-32029);
        expect(h.query).not.toHaveBeenCalled();
    });
});

describe("PERIM-03 — MCP", () => {
    it("cuota por clave antes de tools/list y tools/call", async () => {
        primeDb({ mcp: true });
        h.counters.set("mcp-key:9", 60);
        const res = await mcpPOST(mcpReq({ jsonrpc: "2.0", method: "tools/list", id: 1 }));
        expect(res.status).toBe(429);
        expect(res.headers.get("retry-after")).toBe("60");
        expect((await res.json()).error.code).toBe(-32029);
    });

    it("una clave revocada no ejecuta herramientas", async () => {
        primeDb({ mcp: false });
        const res = await mcpPOST(mcpReq({ method: "tools/call", params: { name: "get_budgets" }, id: 1 }));
        expect(res.status).toBe(401);
    });

    it.each([
        ["array", [{ method: "tools/list" }]],
        ["sin method", { id: 1 }],
        ["method no string", { method: 42 }],
        ["method gigante", { method: "x".repeat(65) }],
        ["params array", { method: "tools/list", params: [] }],
        ["tools/call sin name", { method: "tools/call", params: {} }],
        ["arguments no objeto", { method: "tools/call", params: { name: "get_budgets", arguments: "x" } }],
        ["id objeto", { method: "tools/list", id: { a: 1 } }],
    ])("JSON-RPC inválido (%s) responde -32600 sin despachar", async (_n, body) => {
        primeDb({ mcp: true });
        const res = await mcpPOST(mcpReq(body));
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe(-32600);
    });

    it("body de más de 64 KB responde 413", async () => {
        primeDb({ mcp: true });
        const res = await mcpPOST(mcpReq({ method: "tools/list", params: { pad: "x".repeat(70 * 1024) } }));
        expect(res.status).toBe(413);
    });

    it("JSON roto responde -32700 y una petición válida sigue funcionando", async () => {
        primeDb({ mcp: true });
        expect((await (await mcpPOST(mcpReq("{no"))).json()).error.code).toBe(-32700);
        const ok = await mcpPOST(mcpReq({ jsonrpc: "2.0", method: "tools/list", id: "a" }));
        expect(ok.status).toBe(200);
        expect((await ok.json()).result.tools.length).toBeGreaterThan(0);
    });
});

describe("PERIM-03 — /api/v1/shift-left/estimate", () => {
    it("lee el plan con tope: un stream sin Content-Length sobre el máximo da 413", async () => {
        primeDb({ pak: keyRow(["write:shift-left"]) });
        const req = new NextRequest("https://app/api/v1/shift-left/estimate", {
            method: "POST",
            headers: { "x-api-key": PAK },
            body: chunked(7 * 1024 * 1024),
            // @ts-expect-error undici requiere duplex para bodies en stream
            duplex: "half",
        });
        const res = await shiftLeftPOST(req);
        expect(res.status).toBe(413);
    });
});

describe("PERIM-06 — rate_limit_per_min se normaliza antes del limitador", () => {
    it.each([
        [0, 1],
        [-5, 1],
        [2.7, 2],
        [null, 60],
        ["abc", 60],
        [5_000_000, 1_000_000],
    ])("rate_limit_per_min=%s → límite %s (entero positivo, nunca más permisivo que lo pedido)", async (raw, expected) => {
        primeDb({ pak: { ...keyRow(["read:costs"]), rate_limit_per_min: raw as unknown as number } });
        await meGET(new NextRequest("https://app/api/v1/me", { headers: { "x-api-key": PAK } }));
        expect(h.checkByKeyDistributed).toHaveBeenCalledWith("apikey:7", expected);
    });
});
