// @vitest-environment node
/**
 * PERIM-06 — Rutas con cuota estricta: con Redis caído responden 503 (no 429,
 * no fallback por réplica) y no ejecutan el trabajo protegido.
 *
 * Se usa el limitador REAL con Redis mockeado fallando, para probar el
 * contrato extremo a extremo: ruta → política reject → RateLimitUnavailable → 503.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
    eval: vi.fn(),
    query: vi.fn(),
    upsert: vi.fn(async () => undefined),
    authorizeUrl: vi.fn(() => "https://idp.example/authorize"),
}));

vi.mock("@/lib/redis", () => ({ redis: { eval: h.eval } }));
vi.mock("@/modules/storage/db", () => ({
    default: { query: h.query, getConnection: vi.fn() },
    initializeDatabase: vi.fn(),
}));
vi.mock("@/lib/cache", () => ({
    invalidateCache: vi.fn(async () => undefined),
    getWithStaleWhileRevalidate: vi.fn(async () => []),
}));
vi.mock("@/services/azureUnitEconomics.service", async (orig) => ({
    ...(await orig<object>()),
    upsertBusinessUnits: h.upsert,
}));
vi.mock("@/lib/workosClient", () => ({
    isWorkOSConfigured: () => true,
    getWorkOS: () => ({ sso: { getAuthorizationUrl: h.authorizeUrl } }),
}));

import { POST as ingestPOST } from "@/app/api/unit-metrics/ingest/route";
import { POST as mcpPOST } from "@/app/api/mcp/route";
import { GET as ssoStart } from "@/app/api/auth/sso/start/route";
import { POST as leadsPOST } from "@/app/api/leads/route";
import { GET as meGET } from "@/app/api/v1/me/route";
import { __resetKeyGuardsForTests } from "@/lib/apiKeyGuards";

const PAK = "pak_" + "a".repeat(40);
const MCP = "mcp_" + "b".repeat(40);
const sha = (k: string) => crypto.createHash("sha256").update(k).digest("hex");

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.clearAllMocks();
    __resetKeyGuardsForTests();
    h.eval.mockRejectedValue(new Error("ECONNREFUSED"));
    h.query.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM PublicApiKeys") && params?.[0] === sha(PAK)) {
            return [[{ id: 7, tenant_id: "t1", name: "ci", scopes: JSON.stringify(["write:metrics", "read:costs"]), rate_limit_per_min: 60 }]];
        }
        if (sql.includes("FROM MCPApiKeys") && params?.[0] === sha(MCP)) return [[{ id: 9, tenant_id: "t1" }]];
        if (sql.includes("FROM TenantSSO")) return [[{ workos_connection_id: "conn_1", enabled: 1 }]];
        return [[]];
    });
    delete process.env.TRUST_CLOUDFLARE_CLIENT_IP;
    process.env.SSO_STATE_SECRET = "s".repeat(40);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
});
afterEach(() => vi.restoreAllMocks());

function expect503(res: Response) {
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
    expect(res.headers.get("cache-control")).toBe("no-store");
}

const businessSql = () =>
    h.query.mock.calls.map((c) => String(c[0])).filter((s) => !/FROM (PublicApiKeys|MCPApiKeys)/.test(s));

describe("PERIM-06 — Redis caído en rutas estrictas", () => {
    it("ingesta: 503 sin escribir métricas ni tocar last_used_at", async () => {
        const res = await ingestPOST(new NextRequest("https://app/api/unit-metrics/ingest", {
            method: "POST",
            headers: { "x-api-key": PAK, "content-type": "application/json" },
            body: JSON.stringify([{ metricDate: "2026-10-01", metricType: "TRANSACTIONS", unitCount: 1 }]),
        }));
        expect503(res);
        expect((await res.json()).error).toBe("Service temporarily unavailable");
        await new Promise((r) => setTimeout(r, 0));
        expect(h.upsert).not.toHaveBeenCalled();
        expect(businessSql()).toEqual([]);
    });

    it("ingesta con IP confiable: el pre-auth estricto corta antes de consultar la clave", async () => {
        process.env.TRUST_CLOUDFLARE_CLIENT_IP = "true";
        const res = await ingestPOST(new NextRequest("https://app/api/unit-metrics/ingest", {
            method: "POST",
            headers: { "x-api-key": PAK, "cf-connecting-ip": "203.0.113.4" },
            body: "[]",
        }));
        expect503(res);
        expect(h.query).not.toHaveBeenCalled();
    });

    it("MCP: 503 con envoltura JSON-RPC y sin ejecutar herramientas", async () => {
        const res = await mcpPOST(new NextRequest("https://app/api/mcp", {
            method: "POST",
            headers: { authorization: `Bearer ${MCP}`, "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_cost_summary", arguments: {} } }),
        }));
        expect503(res);
        expect(await res.json()).toEqual({
            jsonrpc: "2.0",
            error: { code: -32003, message: "Service temporarily unavailable" },
            id: null,
        });
        await new Promise((r) => setTimeout(r, 0));
        expect(businessSql()).toEqual([]);
    });

    it("MCP con IP confiable: 503 antes de autenticar", async () => {
        process.env.TRUST_CLOUDFLARE_CLIENT_IP = "true";
        const res = await mcpPOST(new NextRequest("https://app/api/mcp", {
            method: "POST",
            headers: { authorization: `Bearer ${MCP}`, "cf-connecting-ip": "203.0.113.4" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }));
        expect(res.status).toBe(503);
        expect(h.query).not.toHaveBeenCalled();
    });

    it("sso/start: 503 sin leer TenantSSO ni emitir cookie/redirect", async () => {
        const res = await ssoStart(new NextRequest("https://app/api/auth/sso/start?domain=acme.com&tenantId=t1"));
        expect503(res);
        expect(res.headers.get("set-cookie")).toBeNull();
        expect(h.query).not.toHaveBeenCalled();
        expect(h.authorizeUrl).not.toHaveBeenCalled();
    });

    it("leads: 503 sin pedir token a MS Graph ni enviar mail", async () => {
        const res = await leadsPOST(new NextRequest("https://app/api/leads", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ fullName: "A", email: "a@b.co", company: "C" }),
        }));
        expect503(res);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("las rutas no estrictas (v1) conservan el fallback en memoria", async () => {
        const res = await meGET(new NextRequest("https://app/api/v1/me", { headers: { "x-api-key": PAK } }));
        expect(res.status).toBe(200);
    });

    it("con Redis sano las rutas estrictas siguen funcionando", async () => {
        h.eval.mockResolvedValue([1, 60_000]);
        const res = await ssoStart(new NextRequest("https://app/api/auth/sso/start?domain=acme.com&tenantId=t1"));
        expect(res.status).toBe(307);
    });
});
