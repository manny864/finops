import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { priceIdToTier, tierToPriceId, getPaddleEnvironment, getPaddleBaseUrl } from "@/lib/paddleTierMap";

describe("paddleTierMap", () => {
  const originalEnv: NodeJS.ProcessEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("priceIdToTier", () => {
    it("returns Professional for NEXT_PUBLIC_PADDLE_PRO_YEARLY", () => {
      process.env.NEXT_PUBLIC_PADDLE_PRO_YEARLY = "pri_456";
      expect(priceIdToTier("pri_456")).toBe("Professional");
    });

    it("returns Business for NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY", () => {
      process.env.NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY = "pri_789";
      expect(priceIdToTier("pri_789")).toBe("Business");
    });

    it("returns null for unknown price ID", () => {
      expect(priceIdToTier("unknown_id")).toBeNull();
    });

    it("handles multiple tiers with same month", () => {
      process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY = "pri_pro_m";
      process.env.NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY = "pri_bus_m";
      
      expect(priceIdToTier("pri_pro_m")).toBe("Professional");
      expect(priceIdToTier("pri_bus_m")).toBe("Business");
    });
  });

  describe("tierToPriceId", () => {
    it("returns price ID for Professional monthly", () => {
      process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY = "pri_pro_m";
      expect(tierToPriceId("Professional", "monthly")).toBe("pri_pro_m");
    });

    it("returns price ID for Professional yearly", () => {
      process.env.NEXT_PUBLIC_PADDLE_PRO_YEARLY = "pri_pro_y";
      expect(tierToPriceId("Professional", "yearly")).toBe("pri_pro_y");
    });

    it("returns null for Enterprise tier", () => {
      expect(tierToPriceId("Enterprise", "monthly")).toBeNull();
    });

    it("returns null when env var not set", () => {
      const empty: NodeJS.ProcessEnv = {};
      process.env = empty;
      expect(tierToPriceId("Essential", "monthly")).toBeNull();
    });

    it("round-trip conversion works", () => {
      process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY = "pri_pro_m";
      const priceId = tierToPriceId("Professional", "monthly");
      expect(priceId).toBe("pri_pro_m");
      expect(priceIdToTier(priceId!)).toBe("Professional");
    });
  });

  describe("getPaddleEnvironment", () => {
    it("returns sandbox when API key starts with pdl_sdbx_", () => {
      process.env.PADDLE_API_KEY = "pdl_sdbx_test123";
      expect(getPaddleEnvironment()).toBe("sandbox");
    });

    it("returns production when API key doesn't start with pdl_sdbx_", () => {
      process.env.PADDLE_API_KEY = "pdl_live_key123";
      expect(getPaddleEnvironment()).toBe("production");
    });

    it("returns sandbox when PADDLE_API_KEY not set", () => {
      delete process.env.PADDLE_API_KEY;
      expect(getPaddleEnvironment()).toBe("sandbox");
    });
  });

  describe("getPaddleBaseUrl", () => {
    it("returns sandbox URL for sandbox environment", () => {
      process.env.PADDLE_API_KEY = "pdl_sdbx_test";
      expect(getPaddleBaseUrl()).toBe("https://sandbox-api.paddle.com");
    });

    it("returns production URL for production environment", () => {
      process.env.PADDLE_API_KEY = "pdl_live_prod";
      expect(getPaddleBaseUrl()).toBe("https://api.paddle.com");
    });

    it("defaults to sandbox when no API key", () => {
      delete process.env.PADDLE_API_KEY;
      expect(getPaddleBaseUrl()).toBe("https://sandbox-api.paddle.com");
    });
  });
});

describe("paddleTierMap: config is read at runtime, not frozen into the build", () => {
  const src = readFileSync(join(__dirname, "..", "..", "src", "lib", "paddleTierMap.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("uses the same runtime projection as the browser", () => {
    expect(src).toContain("getPublicRuntimeConfig()");
    expect(src).not.toMatch(/process\.env\.NEXT_PUBLIC_/);
  });
  it("can change environment without importing or building again", () => {
    process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY = "pri_staging";
    expect(tierToPriceId("Professional", "monthly")).toBe("pri_staging");
    process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY = "pri_production";
    expect(tierToPriceId("Professional", "monthly")).toBe("pri_production");
    expect(priceIdToTier("pri_staging")).toBeNull();
  });
});
