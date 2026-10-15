// @vitest-environment node
/**
 * PERIM-05 — Las cuotas pre-login no derivan su clave de X-Forwarded-For.
 *
 * Sin contrato de proxy (`TRUST_CLOUDFLARE_CLIENT_IP`), rotar XFF/X-Real-IP no
 * debe abrir buckets nuevos; con contrato, la clave es `cf-connecting-ip`.
 * Cubre /api/auth/sso/start (hallazgo), /api/leads y /api/csp-report.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
    const counters = new Map<string, number>();
    return {
        counters,
        query: vi.fn(),
        check: vi.fn(async (key: string, limit: number) => {
            const n = (counters.get(key) ?? 0) + 1;
            counters.set(key, n);
            return { allowed: n <= limit, remaining: Math.max(0, limit - n), resetAt: new Date() };
        }),
    };
});

vi.mock("@/lib/rateLimiter", () => ({ default: { checkByKeyDistributed: h.check } }));
vi.mock("@/modules/storage/db", () => ({ default: { query: h.query } }));
vi.mock("@/lib/workosClient", () => ({
    isWorkOSConfigured: () => true,
    getWorkOS: () => ({ sso: { getAuthorizationUrl: () => "https://idp.example/authorize" } }),
}));

import { GET as ssoStart } from "@/app/api/auth/sso/start/route";
import { POST as leadsPOST } from "@/app/api/leads/route";
import { POST as cspPOST } from "@/app/api/csp-report/route";

let n = 0;
const rotating = () => {
    n++;
    return { "x-forwarded-for": `10.0.${n >> 8}.${n & 255}, 1.1.1.1`, "x-real-ip": `10.9.${n >> 8}.${n & 255}` };
};

const sso = (headers: Record<string, string> = {}, tenantId = "tenant-a", domain = "acme.com") =>
    ssoStart(new NextRequest(
        `https://app/api/auth/sso/start?domain=${encodeURIComponent(domain)}&tenantId=${encodeURIComponent(tenantId)}`,
        { headers }
    ));

beforeEach(() => {
    h.counters.clear();
    vi.clearAllMocks();
    n = 0;
    delete process.env.TRUST_CLOUDFLARE_CLIENT_IP;
    process.env.SSO_STATE_SECRET = "s".repeat(40);
    process.env.WORKOS_REDIRECT_URI = "https://app/api/auth/sso/callback";
    process.env.WORKOS_CLIENT_ID = "client_x";
    h.query.mockResolvedValue([[{ workos_connection_id: "conn_1", enabled: 1 }]]);
});

describe("PERIM-05 — /api/auth/sso/start", () => {
    it("sin proxy confiable, rotar XFF/X-Real-IP no evade la cuota (20/min)", async () => {
        for (let i = 0; i < 20; i++) expect((await sso(rotating())).status).toBe(307);
        const res = await sso(rotating());
        expect(res.status).toBe(429);
        expect(res.headers.get("retry-after")).toBe("60");
        const keys = h.check.mock.calls.map((c) => c[0]);
        expect(keys.some((k) => /10\.0\.|10\.9\.|1\.1\.1\.1|unknown/.test(k))).toBe(false);
    });

    it("con proxy confiable la clave es cf-connecting-ip, no XFF", async () => {
        process.env.TRUST_CLOUDFLARE_CLIENT_IP = "true";
        await sso({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "6.6.6.6" });
        expect(h.check).toHaveBeenCalledWith("sso-start:ip:203.0.113.7", 20, 60_000);
        expect(h.check).toHaveBeenCalledWith("sso-start:global", 600, 60_000);
    });

    it("con proxy confiable, IPs distintas tienen buckets distintos", async () => {
        process.env.TRUST_CLOUDFLARE_CLIENT_IP = "true";
        h.counters.set("sso-start:ip:203.0.113.7", 20);
        expect((await sso({ "cf-connecting-ip": "203.0.113.7" })).status).toBe(429);
        expect((await sso({ "cf-connecting-ip": "203.0.113.8" })).status).toBe(307);
    });

    it("cf-connecting-ip inválido o sin flag no se usa como clave", async () => {
        process.env.TRUST_CLOUDFLARE_CLIENT_IP = "true";
        await sso({ "cf-connecting-ip": "no-es-ip" });
        delete process.env.TRUST_CLOUDFLARE_CLIENT_IP;
        await sso({ "cf-connecting-ip": "203.0.113.9" });
        const keys = h.check.mock.calls.map((c) => c[0]);
        expect(keys.filter((k) => k.startsWith("sso-start:ip:"))).toEqual([]);
    });

    it("tope global: rotar tenants no supera 600/min", async () => {
        h.counters.set("sso-start:global", 600);
        expect((await sso({}, "otro-tenant")).status).toBe(429);
        expect(h.query).not.toHaveBeenCalled();
    });

    it("tenantId o domain fuera de formato: 400 sin tocar cuota ni DB", async () => {
        expect((await sso({}, "x".repeat(65))).status).toBe(400);
        expect((await sso({}, "a b")).status).toBe(400);
        expect((await sso({}, "tenant-a", "d".repeat(254))).status).toBe(400);
        expect(h.check).not.toHaveBeenCalled();
        expect(h.query).not.toHaveBeenCalled();
    });
});

describe("PERIM-05 — /api/leads", () => {
    const lead = (headers: Record<string, string>) =>
        leadsPOST(new NextRequest("https://app/api/leads", {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify({ fullName: "A", email: "a@b.co", company: "C" }),
        }));

    it("rotar XFF no evade 5/hora y nunca usa XFF como clave", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
        vi.spyOn(console, "error").mockImplementation(() => {});
        for (let i = 0; i < 5; i++) await lead(rotating());
        expect((await lead(rotating())).status).toBe(429);
        expect(fetchSpy).toHaveBeenCalledTimes(5);
        const keys = h.check.mock.calls.map((c) => c[0]);
        expect(keys.some((k) => /10\.0\.|1\.1\.1\.1|unknown/.test(k))).toBe(false);
        expect(h.check).toHaveBeenCalledWith("leads:enterprise:global", 50, 3_600_000);
        fetchSpy.mockRestore();
    });
});

describe("PERIM-05 — /api/csp-report", () => {
    it("sin proxy confiable ignora cf-connecting-ip y XFF", async () => {
        for (const headers of [{ "cf-connecting-ip": "1.2.3.4" }, rotating()]) {
            await cspPOST(new NextRequest("https://app/api/csp-report", {
                method: "POST",
                headers: { "content-type": "application/csp-report", ...headers },
                body: "{}",
            }));
        }
        const perIp = h.check.mock.calls.map((c) => c[0]).filter((k) => k !== "csp-report:global");
        expect(perIp).toEqual(["csp-report:untrusted", "csp-report:untrusted"]);
    });
});
