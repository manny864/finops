// @vitest-environment node
/**
 * PERIM-04 — /api/onboard: identidad antes que la base, cuota por identidad
 * verificada y body acotado.
 *
 * Aceptación del plan: JWT inválido no inicializa DB; la cuota no la elige el
 * cliente; el contrato de body opcional se conserva; el trial no sale del body.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
    const counters = new Map<string, number>();
    class AuthError extends Error {
        constructor(message: string, public status = 401) {
            super(message);
            this.name = "AuthError";
        }
    }
    return {
        counters,
        AuthError,
        initializeDatabase: vi.fn(async () => {}),
        query: vi.fn(),
        getConnection: vi.fn(),
        identity: vi.fn(),
        checkByKeyDistributed: vi.fn(async (key: string, limit: number) => {
            const n = (counters.get(key) ?? 0) + 1;
            counters.set(key, n);
            return { allowed: n <= limit, remaining: Math.max(0, limit - n), resetAt: new Date() };
        }),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: { query: h.query, getConnection: h.getConnection },
    initializeDatabase: h.initializeDatabase,
}));
vi.mock("@/lib/requestAuth", () => ({
    requireRequestIdentity: h.identity,
    AuthError: h.AuthError,
}));
vi.mock("@/lib/rateLimiter", () => ({ default: { checkByKeyDistributed: h.checkByKeyDistributed } }));
vi.mock("@/lib/emailHelper", () => ({
    sendEmailAsync: vi.fn(),
    getWelcomeEmailHtml: vi.fn(() => ""),
    getInternalSignupAlertEmailHtml: vi.fn(() => ""),
}));

import { POST } from "@/app/api/onboard/route";

const ID = {
    email: "ana@empresa.com",
    tenantId: "tenant-a",
    isCorporateDomain: false,
    claims: { tid: "tenant-a", oid: "oid-ana" },
};

function req(body?: BodyInit | null, headers: Record<string, string> = {}) {
    return new NextRequest("https://app/api/onboard", {
        method: "POST",
        headers: { authorization: "Bearer x", "content-type": "application/json", ...headers },
        body: body ?? null,
        // @ts-expect-error undici requiere duplex para bodies en stream
        duplex: "half",
    });
}

function connection() {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    return {
        queries,
        beginTransaction: vi.fn(async () => {}),
        commit: vi.fn(async () => {}),
        rollback: vi.fn(async () => {}),
        release: vi.fn(),
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
            queries.push({ sql: String(sql), params });
            return [[], []];
        }),
    };
}

beforeEach(() => {
    h.counters.clear();
    vi.clearAllMocks();
    h.identity.mockResolvedValue(ID);
    h.query.mockResolvedValue([[{ 1: 1 }]]);
    delete process.env.TRUST_CLOUDFLARE_CLIENT_IP;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("PERIM-04 — /api/onboard", () => {
    it("un JWT inválido no inicializa la base, no consume cuota ni toca MySQL", async () => {
        h.identity.mockRejectedValue(new h.AuthError("Firma de token inválida.", 401));
        const res = await POST(req(JSON.stringify({ plan: "pro" })));
        expect(res.status).toBe(401);
        expect(h.initializeDatabase).not.toHaveBeenCalled();
        expect(h.checkByKeyDistributed).not.toHaveBeenCalled();
        expect(h.query).not.toHaveBeenCalled();
        expect(h.getConnection).not.toHaveBeenCalled();
    });

    it("autentica antes de inicializar la base", async () => {
        const order: string[] = [];
        h.identity.mockImplementation(async () => { order.push("auth"); return ID; });
        h.initializeDatabase.mockImplementation(async () => { order.push("init"); });
        h.getConnection.mockResolvedValue(connection());
        await POST(req(JSON.stringify({ plan: null })));
        expect(order).toEqual(["auth", "init"]);
    });

    it("cuota de 10/min por identidad verificada: el 11º no provisiona", async () => {
        h.getConnection.mockResolvedValue(connection());
        for (let i = 0; i < 10; i++) {
            expect((await POST(req(JSON.stringify({ plan: null })))).status).toBe(200);
        }
        h.getConnection.mockClear();
        h.initializeDatabase.mockClear();
        const res = await POST(req(JSON.stringify({ plan: "business" })));
        expect(res.status).toBe(429);
        expect(res.headers.get("retry-after")).toBe("60");
        expect((await res.json()).success).toBe(false);
        expect(h.getConnection).not.toHaveBeenCalled();
        expect(h.initializeDatabase).not.toHaveBeenCalled();
        expect(h.checkByKeyDistributed).toHaveBeenLastCalledWith("onboard:tenant-a:oid-ana", 10);
    });

    it("la clave de cuota sale del token, no de cabeceras ni del body", async () => {
        h.getConnection.mockResolvedValue(connection());
        await POST(req(JSON.stringify({ plan: null, tenantId: "otro", email: "x@y" }), {
            "x-forwarded-for": "9.9.9.9",
            "x-tenant-id": "otro",
        }));
        expect(h.checkByKeyDistributed).toHaveBeenCalledWith("onboard:tenant-a:oid-ana", 10);
    });

    it("otra identidad tiene su propio presupuesto", async () => {
        h.counters.set("onboard:tenant-a:oid-ana", 10);
        h.identity.mockResolvedValue({ ...ID, email: "bob@empresa.com", claims: { tid: "tenant-a", oid: "oid-bob" } });
        h.getConnection.mockResolvedValue(connection());
        expect((await POST(req(JSON.stringify({ plan: null })))).status).toBe(200);
    });

    it("body ausente sigue siendo un login común (contrato opcional)", async () => {
        h.query.mockResolvedValue([[]]);
        const res = await POST(req(null));
        expect(res.status).toBe(403);
        expect((await res.json()).needsSubscription).toBe(true);
        expect(h.getConnection).not.toHaveBeenCalled();
    });

    it("JSON roto se trata como sin plan, igual que antes", async () => {
        h.query.mockResolvedValue([[]]);
        const res = await POST(req("{no-json"));
        expect(res.status).toBe(403);
        expect(h.getConnection).not.toHaveBeenCalled();
    });

    it("body sobredimensionado: 413 sin inicializar ni provisionar", async () => {
        const res = await POST(req(JSON.stringify({ plan: "pro", pad: "x".repeat(8 * 1024) })));
        expect(res.status).toBe(413);
        expect(h.initializeDatabase).not.toHaveBeenCalled();
        expect(h.getConnection).not.toHaveBeenCalled();
    });

    it.each([
        ["número", 42],
        ["objeto", { tier: "Enterprise" }],
        ["string gigante", "p".repeat(33)],
    ])("plan no string o desmedido (%s) responde 400", async (_n, plan) => {
        const res = await POST(req(JSON.stringify({ plan })));
        expect(res.status).toBe(400);
        expect(h.getConnection).not.toHaveBeenCalled();
    });

    it("checkout legítimo sigue creando el tenant inerte y no guarda XFF del cliente", async () => {
        const conn = connection();
        h.getConnection.mockResolvedValue(conn);
        const res = await POST(req(JSON.stringify({ plan: "Pro" }), { "x-forwarded-for": "6.6.6.6" }));
        expect(res.status).toBe(200);
        const insert = conn.queries.find((q) => q.sql.includes("INSERT IGNORE INTO Tenants"));
        expect(insert?.params[3]).toBe("PENDING_PAYMENT");
        expect(insert?.params[4]).toBeNull();
        const signup = conn.queries.find((q) => q.sql.includes("INSERT INTO SignupEvents"));
        const metadata = JSON.parse(String(signup?.params[4]));
        expect(metadata.plan).toBe("pro");
        expect(metadata.ip).toBeNull();
        expect(JSON.stringify(metadata)).not.toContain("6.6.6.6");
    });

    it("con contrato de proxy confiable guarda cf-connecting-ip", async () => {
        process.env.TRUST_CLOUDFLARE_CLIENT_IP = "true";
        const conn = connection();
        h.getConnection.mockResolvedValue(conn);
        await POST(req(JSON.stringify({ plan: "pro" }), { "cf-connecting-ip": "203.0.113.5", "x-forwarded-for": "6.6.6.6" }));
        const signup = conn.queries.find((q) => q.sql.includes("INSERT INTO SignupEvents"));
        expect(JSON.parse(String(signup?.params[4])).ip).toBe("203.0.113.5");
    });
});
