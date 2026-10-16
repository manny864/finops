// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { getInternalBaseUrl } from "@/lib/internalBaseUrl";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

afterEach(() => vi.unstubAllEnvs());
describe("trusted self-fetch origin", () => {
    it("ignores request-derived overrides, including attacker-selected ports", () => {
        vi.stubEnv("INTERNAL_BASE_URL", "");
        vi.stubEnv("PORT", "3000");
        expect(Reflect.apply(getInternalBaseUrl, null, ["9999"])).toBe("http://127.0.0.1:3000");
    });
    it("takes only the configured origin", () => {
        vi.stubEnv("INTERNAL_BASE_URL", "http://127.0.0.1:3003/");
        expect(getInternalBaseUrl()).toBe("http://127.0.0.1:3003");
    });
    it.each(["http://a.test/path", "http://user:pass@a.test", "ftp://a.test", "http://a.test/?secret=x", "http://a.test/#x"])(
        "rejects invalid configured origin %s", value => {
            vi.stubEnv("INTERNAL_BASE_URL", value);
            expect(() => getInternalBaseUrl()).toThrow();
        },
    );
    it.each(["0", "65536", "3000@evil.test", "3000/path", "-1"])("rejects invalid PORT %s", value => {
        vi.stubEnv("INTERNAL_BASE_URL", "");
        vi.stubEnv("PORT", value);
        expect(() => getInternalBaseUrl()).toThrow();
    });
    it("no production caller passes request data into the helper", () => {
        const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
            entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []);
        expect(walk("src/app/api").filter(file => /getInternalBaseUrl\(\s*[^)\s]/.test(readFileSync(file, "utf8")))).toEqual([]);
    });
    it("only the trusted local server receives a forwarded synthetic token", async () => {
        let trustedToken = "";
        let alternateCalls = 0;
        const trusted = createServer((req, res) => {
            trustedToken = req.headers.authorization || "";
            res.end("ok");
        }).listen(0, "127.0.0.1");
        const alternate = createServer((_req, res) => {
            alternateCalls++;
            res.end("unexpected");
        }).listen(0, "127.0.0.1");
        await Promise.all([once(trusted, "listening"), once(alternate, "listening")]);
        try {
            const trustedAddress = trusted.address();
            const alternateAddress = alternate.address();
            if (!trustedAddress || typeof trustedAddress === "string" || !alternateAddress || typeof alternateAddress === "string") throw new Error("Expected TCP servers");
            vi.stubEnv("INTERNAL_BASE_URL", "");
            vi.stubEnv("PORT", String(trustedAddress.port));
            const origin = Reflect.apply(getInternalBaseUrl, null, [String(alternateAddress.port)]);
            await (await fetch(`${origin}/api/test`, { headers: { authorization: "Bearer synthetic-only" }, redirect: "error" })).text();
            expect(trustedToken).toBe("Bearer synthetic-only");
            expect(alternateCalls).toBe(0);
        } finally {
            trusted.closeAllConnections();
            alternate.closeAllConnections();
            await Promise.all([
                new Promise<void>(resolve => trusted.close(() => resolve())),
                new Promise<void>(resolve => alternate.close(() => resolve())),
            ]);
        }
    });
});
