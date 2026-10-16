// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicRuntimeConfig } from "@/lib/publicRuntimeConfig";
import { GET } from "@/app/api/config/public/route";

afterEach(() => vi.unstubAllEnvs());
describe("public runtime configuration", () => {
  it("projects only the six public identity/billing values", () => {
    const config = getPublicRuntimeConfig({
      NEXT_PUBLIC_CLIENT_ID: "staging-client",
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "test_public",
      NEXT_PUBLIC_PADDLE_PRO_MONTHLY: "pri_staging",
      PADDLE_API_KEY: "synthetic-private", AZURE_CLIENT_SECRET: "synthetic-secret",
      APP_SECRET_ENCRYPTION_KEY: "synthetic-encryption-key", MYSQL_PASSWORD: "synthetic-db",
      NEXT_PUBLIC_UNKNOWN: "not-explicitly-allowed",
    });
    expect(config).toEqual({
      clientId: "staging-client", paddleClientToken: "test_public",
      paddleProMonthly: "pri_staging", paddleProYearly: "",
      paddleBusinessMonthly: "", paddleBusinessYearly: "",
    });
    expect(JSON.stringify(config)).not.toMatch(/synthetic|not-explicitly-allowed/);
  });
  it("preserves the existing local-development auth default and missing-billing behavior", () => {
    expect(getPublicRuntimeConfig({})).toMatchObject({
      clientId: "876d8a5b-6023-4484-b3ba-73c186e4a72b", paddleClientToken: "",
    });
    expect(getPublicRuntimeConfig({ NEXT_PUBLIC_AZURE_CLIENT_ID: "alias" }).clientId).toBe("alias");
  });
  it("never caches environment values or exposes secrets through the endpoint", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLIENT_ID", "staging-client");
    vi.stubEnv("APP_SECRET_ENCRYPTION_KEY", "synthetic-secret");
    const first = GET();
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(await first.json()).toMatchObject({ clientId: "staging-client" });
    vi.stubEnv("NEXT_PUBLIC_CLIENT_ID", "prod-client");
    const second = GET();
    expect(await second.json()).toMatchObject({ clientId: "prod-client" });
  });
});
