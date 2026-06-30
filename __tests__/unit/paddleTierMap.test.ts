import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
    it("returns Essential for NEXT_PUBLIC_PADDLE_ESSENTIAL_MONTHLY", () => {
      process.env.NEXT_PUBLIC_PADDLE_ESSENTIAL_MONTHLY = "pri_123";
      expect(priceIdToTier("pri_123")).toBe("Essential");
    });

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
      process.env.NEXT_PUBLIC_PADDLE_ESSENTIAL_MONTHLY = "pri_ess_m";
      process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY = "pri_pro_m";
      process.env.NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY = "pri_bus_m";
      
      expect(priceIdToTier("pri_ess_m")).toBe("Essential");
      expect(priceIdToTier("pri_pro_m")).toBe("Professional");
      expect(priceIdToTier("pri_bus_m")).toBe("Business");
    });
  });

  describe("tierToPriceId", () => {
    it("returns price ID for Essential monthly", () => {
      process.env.NEXT_PUBLIC_PADDLE_ESSENTIAL_MONTHLY = "pri_ess_m";
      expect(tierToPriceId("Essential", "monthly")).toBe("pri_ess_m");
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
