// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { rateMock } = vi.hoisted(() => ({ rateMock: vi.fn() }));
vi.mock("@/lib/rateLimiter", () => ({ default: { checkByKeyDistributed: rateMock } }));

import proxy from "@/proxy";
import { forwardRequestHeaders, nonceCsp } from "@/lib/cspNonce";
import { extractViolations, redactUrl } from "@/lib/cspReport";
import { POST as reportPOST } from "@/app/api/csp-report/route";

const page = (path: string, headers: Record<string, string> = {}) =>
    new NextRequest(`http://localhost${path}`, { headers: { cookie: "finops_session=abc", "accept-language": "es", ...headers } });

const nonceOf = (policy: string | null) => policy?.match(/'nonce-([^']+)'/)?.[1];
const scriptSrc = (policy: string) => policy.split("; ").find((d) => d.startsWith("script-src "))!;
const overrides = (res: Response) => (res.headers.get("x-middleware-override-headers") ?? "").split(",");

afterEach(() => {
    delete process.env.CSP_ENFORCE;
});

describe("política con nonce (PERIM-01)", () => {
    it("script-src con nonce + strict-dynamic, sin 'unsafe-inline'; reporta a /api/csp-report", () => {
        const p = nonceCsp("abc");
        expect(scriptSrc(p)).toMatch(/^script-src 'self' 'nonce-abc' 'strict-dynamic' https:/);
        expect(scriptSrc(p)).not.toContain("'unsafe-inline'");
        expect(p).toContain("script-src-attr 'none'");
        expect(p).toContain("object-src 'none'");
        expect(p).toContain("frame-ancestors 'none'");
        expect(p).toContain("report-uri /api/csp-report");
        expect(p).toContain("report-to csp");
    });

    it("'unsafe-eval' sólo fuera de producción", () => {
        vi.stubEnv("NODE_ENV", "production");
        expect(nonceCsp("x")).not.toContain("'unsafe-eval'");
        vi.stubEnv("NODE_ENV", "development");
        expect(nonceCsp("x")).toContain("'unsafe-eval'");
        vi.unstubAllEnvs();
    });
});

describe("proxy: nonce propagado a Next.js (PERIM-01)", () => {
    it("el mismo nonce va en la petición (x-nonce y CSP) y en la respuesta", () => {
        const res = proxy(page("/es/overview"));
        const policy = res.headers.get("content-security-policy-report-only");
        const nonce = nonceOf(policy);
        expect(nonce).toMatch(/^[A-Za-z0-9+/=]{24,}$/);
        expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
        expect(nonceOf(res.headers.get("x-middleware-request-content-security-policy"))).toBe(nonce);
        expect(overrides(res)).toEqual(expect.arrayContaining(["x-nonce", "content-security-policy"]));
    });

    it("no se pierden las demás cabeceras de la petición (cookies) al declarar overrides", () => {
        const res = proxy(page("/es/overview"));
        expect(overrides(res)).toContain("cookie");
        expect(res.headers.get("x-middleware-request-cookie")).toBe("finops_session=abc");
    });

    it("nonce distinto por documento", () => {
        const a = nonceOf(proxy(page("/es/overview")).headers.get("content-security-policy-report-only"));
        const b = nonceOf(proxy(page("/es/overview")).headers.get("content-security-policy-report-only"));
        expect(a).not.toBe(b);
    });

    it("Report-Only por defecto; CSP_ENFORCE=true la promueve a enforcing", () => {
        let res = proxy(page("/es/overview"));
        expect(res.headers.get("content-security-policy")).toBeNull();
        process.env.CSP_ENFORCE = "true";
        res = proxy(page("/es/overview"));
        expect(res.headers.get("content-security-policy-report-only")).toBeNull();
        expect(nonceOf(res.headers.get("content-security-policy"))).toBe(res.headers.get("x-middleware-request-x-nonce"));
    });

    it("HTML no cacheable y endpoint de reportes declarado", () => {
        const res = proxy(page("/es/overview"));
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        expect(res.headers.get("reporting-endpoints")).toBe('csp="/api/csp-report"');
    });

    it("la redirección de locale (sin render) no declara overrides pero lleva la CSP", () => {
        const res = proxy(page("/"));
        expect([307, 308]).toContain(res.status);
        expect(res.headers.get("x-middleware-override-headers")).toBeNull();
        expect(res.headers.get("content-security-policy-report-only")).toContain("'nonce-");
    });
});

describe("forwardRequestHeaders", () => {
    it("si la respuesta no traía overrides, declara la petición completa", () => {
        const req = new Headers({ cookie: "a=1", authorization: "Bearer t", "x-nonce": "n" });
        const res = NextResponse.next();
        forwardRequestHeaders(res, req, ["x-nonce"]);
        expect(overrides(res).sort()).toEqual(["authorization", "cookie", "x-nonce"]);
        expect(res.headers.get("x-middleware-request-authorization")).toBe("Bearer t");
    });

    it("si ya había overrides, agrega sólo las nuevas y respeta las existentes", () => {
        const req = new Headers({ cookie: "a=1", "x-nonce": "n" });
        const res = NextResponse.next({ request: { headers: new Headers({ cookie: "a=1", "x-next-intl-locale": "es" }) } });
        forwardRequestHeaders(res, req, ["x-nonce"]);
        expect(overrides(res).sort()).toEqual(["cookie", "x-next-intl-locale", "x-nonce"]);
    });

    it("no toca redirecciones", () => {
        const res = NextResponse.redirect("http://localhost/es");
        forwardRequestHeaders(res, new Headers({ "x-nonce": "n" }), ["x-nonce"]);
        expect(res.headers.get("x-middleware-override-headers")).toBeNull();
    });
});

describe("colector de reportes CSP", () => {
    beforeEach(() => {
        rateMock.mockReset().mockResolvedValue({ allowed: true });
    });

    it("redacta query y fragmento; conserva keywords", () => {
        expect(redactUrl("https://app.x.com/es/overview?token=SECRETO#frag")).toBe("https://app.x.com/es/overview");
        expect(redactUrl("inline")).toBe("inline");
        expect(redactUrl("data:text/html;base64,AAAA")).toBe("data:…");
        expect(redactUrl("no es url")).toBe("[invalid-url]");
    });

    it("acepta el formato legado y el de la Reporting API, con allowlist de campos", () => {
        const legacy = extractViolations({ "csp-report": {
            "document-uri": "https://a.com/x?s=1", "blocked-uri": "inline", "effective-directive": "script-src-elem",
            "script-sample": "alert(document.cookie)//" + "x".repeat(100), "line-number": 3, "extra": "ignorado",
        } });
        expect(legacy).toEqual([expect.objectContaining({ documentUrl: "https://a.com/x", blockedUrl: "inline", directive: "script-src-elem", line: 3 })]);
        expect(String(legacy[0].sample).length).toBe(40);
        expect(legacy[0]).not.toHaveProperty("extra");

        const modern = extractViolations([
            { type: "csp-violation", body: { documentURL: "https://a.com/y?t=1", blockedURL: "https://evil.com/s.js?k=1", effectiveDirective: "script-src-elem", disposition: "report" } },
            { type: "deprecation", body: { id: "x" } },
        ]);
        expect(modern).toEqual([expect.objectContaining({ documentUrl: "https://a.com/y", blockedUrl: "https://evil.com/s.js", disposition: "report" })]);
    });

    it("máximo 10 reportes por envío", () => {
        const many = Array.from({ length: 50 }, () => ({ type: "csp-violation", body: { documentURL: "https://a.com" } }));
        expect(extractViolations(many)).toHaveLength(10);
    });

    const post = (body: string, type = "application/csp-report", headers: Record<string, string> = {}) =>
        new NextRequest("http://localhost/api/csp-report", { method: "POST", headers: { "content-type": type, "cf-connecting-ip": "1.2.3.4", ...headers }, body });

    it("registra la violación redactada y responde 204", async () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const res = await reportPOST(post(JSON.stringify({ "csp-report": { "document-uri": "https://a.com/p?tok=S", "blocked-uri": "inline" } })));
        expect(res.status).toBe(204);
        expect(spy).toHaveBeenCalledOnce();
        expect(String(spy.mock.calls[0][1])).not.toContain("tok=S");
        expect(rateMock).toHaveBeenCalledWith("csp-report:1.2.3.4", 20, 60_000);
        spy.mockRestore();
    });

    it("descarta en silencio: content-type ajeno, rate limit, body > 16 KB, JSON inválido", async () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const ok = JSON.stringify({ "csp-report": { "document-uri": "https://a.com" } });
        expect((await reportPOST(post(ok, "text/plain"))).status).toBe(204);
        rateMock.mockResolvedValueOnce({ allowed: false }).mockResolvedValueOnce({ allowed: true });
        expect((await reportPOST(post(ok))).status).toBe(204);
        expect((await reportPOST(post(JSON.stringify({ "csp-report": { x: "y".repeat(20_000) } })))).status).toBe(204);
        expect((await reportPOST(post("{roto"))).status).toBe(204);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});
