import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { baselineCsp, nonceCsp } from "@/lib/cspNonce";

afterEach(() => vi.unstubAllEnvs());
describe.each([["nonce", nonceCsp], ["baseline", baselineCsp]] as const)("%s CSP reads runtime configuration", (_name, policy) => {
  it.each([
    ["production", "live_abc123", false],
    ["production", "", false],
    ["production", "test_abc123", true],
    ["development", "", true],
  ])("%s with token %s enables sandbox: %s", (environment, token, sandbox) => {
    vi.stubEnv("NODE_ENV", environment);
    vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", token);
    const result = policy("synthetic-nonce");
    expect(result.includes("sandbox-cdn.paddle.com")).toBe(sandbox);
    expect(result.includes("sandbox-api.paddle.com")).toBe(sandbox);
    expect(result.includes("sandbox-buy.paddle.com")).toBe(sandbox);
    expect(result.includes("'unsafe-eval'")).toBe(environment !== "production");
  });
  it("switches from staging to prod without a rebuild or module reload", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", "test_staging");
    expect(policy("nonce")).toContain("sandbox-api.paddle.com");
    vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", "live_prod");
    expect(policy("nonce")).not.toContain("sandbox-api.paddle.com");
  });
});
it("overrides the build-time baseline on document responses, even in report-only mode", () => {
  const source = readFileSync("src/proxy.ts", "utf8");
  expect(source).toContain("response.headers.set('Content-Security-Policy', baselineCsp())");
});
