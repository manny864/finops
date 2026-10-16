// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/secrets/keyvault", () => ({ getSecret: async () => "synthetic-private-secret" }));
import { getLoadTestServicePrincipalToken } from "@/lib/loadTestAuth";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("requests load-test tokens for the runtime login audience, without freezing a build value", async () => {
  vi.useFakeTimers();
  vi.stubEnv("AZURE_TENANT_ID", "synthetic-tenant");
  vi.stubEnv("LOAD_TEST_SP_APP_ID", "synthetic-load-test-client");
  vi.stubEnv("NEXT_PUBLIC_CLIENT_ID", "staging-login");
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ access_token: "synthetic-token", expires_in: 120 }));
  vi.stubGlobal("fetch", fetcher);
  await getLoadTestServicePrincipalToken();
  expect(fetcher.mock.calls[0][1].body.get("scope")).toBe("api://staging-login/.default");
  vi.advanceTimersByTime(120_000);
  vi.stubEnv("NEXT_PUBLIC_CLIENT_ID", "prod-login");
  await getLoadTestServicePrincipalToken();
  expect(fetcher.mock.calls[1][1].body.get("scope")).toBe("api://prod-login/.default");
});
