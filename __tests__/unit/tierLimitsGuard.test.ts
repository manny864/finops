import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getTenantTierLimitStatus,
  assertTenantSubscriptionQuota,
  assertFeatureAccess,
  createTierLimitResponse,
  TierLimitException,
  getFeaturesForTier,
  isFeatureIncludedInTier,
} from "@/middleware/tierLimitsGuard";
import pool from "@/modules/storage/db";

vi.mock("@/modules/storage/db", () => ({
  default: {
    query: vi.fn(),
  },
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

describe("Tier Limits Guard & Quota Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Feature Inclusion per Tier", () => {
    it("should allow correct features for Professional tier", () => {
      const features = getFeaturesForTier("Professional");
      expect(features).toEqual(["FOCUS_EXPORT"]);
      expect(isFeatureIncludedInTier("Professional", "CSP_MARKUP")).toBe(false);
      expect(isFeatureIncludedInTier("Professional", "FOCUS_EXPORT")).toBe(true);
    });

    // CSP_MARKUP y POWERBI_TEMPLATES salieron de Business en deafd11, para que
    // el guard coincida con lo que la pagina de precios vende: las dos figuran
    // solo en Enterprise en FinOpsCapabilitiesTable (cspBillingMarkup,
    // powerBiFocus, powerBiInvoicing).
    it("should allow FOCUS_EXPORT in Business tier and keep CSP_MARKUP out", () => {
      const features = getFeaturesForTier("Business");
      expect(features).toContain("FOCUS_EXPORT");
      expect(features).not.toContain("CSP_MARKUP");
      expect(features).not.toContain("POWERBI_TEMPLATES");
      expect(isFeatureIncludedInTier("Business", "UNLIMITED_SUBS")).toBe(false);
    });

    it("should allow all features in Enterprise tier", () => {
      const features = getFeaturesForTier("Enterprise");
      expect(features).toContain("UNLIMITED_SUBS");
      expect(features).toContain("CSP_MARKUP");
      expect(features).toContain("FOCUS_EXPORT");
      expect(features).toContain("PRIORITY_SUPPORT");
    });
  });

  describe("getTenantTierLimitStatus", () => {
    it("should return Enterprise unlimited status for demo/mock tenants", async () => {
      const status = await getTenantTierLimitStatus("demo-tenant-123");
      expect(status.planTier).toBe("Enterprise");
      expect(status.maxAllowedSubscriptions).toBe(9999);
      expect(status.isSubscriptionLimitReached).toBe(false);
      expect(status.canAddMoreSubscriptions).toBe(true);
    });

    it("should return correct limits for Professional tier (max 2 subs)", async () => {
      vi.mocked(pool.query).mockImplementation(async (sql: string) => {
        if (sql.includes("FROM Tenants")) {
          return [[{ tier: "Professional" }]] as any;
        }
        if (sql.includes("FROM CostSnapshots")) {
          // El conteo sale de las suscripciones REALES de Azure, no de
          // `TenantSubscriptions` (registro de facturación, que no tiene
          // columna subscription_id: esa consulta siempre tiraba error).
          return [[{ subscription_id: "sub-0" }, { subscription_id: "sub-1" }]] as any;
        }
        if (sql.includes("FROM TenantSubscriptions")) {
          return [[]] as any; // sin slots comprados: rige el tope del plan
        }
        return [[]] as any;
      });

      const status = await getTenantTierLimitStatus("real-tenant-pro");
      expect(status.planTier).toBe("Professional");
      expect(status.maxAllowedSubscriptions).toBe(2);
      expect(status.currentSubscriptionsCount).toBe(2);
      expect(status.isSubscriptionLimitReached).toBe(true);
      expect(status.canAddMoreSubscriptions).toBe(false);
      expect(status.upgradeTargetTier).toBe("Business");
    });

    it("should return correct limits for Business tier (max 3 subs)", async () => {
      vi.mocked(pool.query).mockImplementation(async (sql: string) => {
        if (sql.includes("FROM Tenants")) {
          return [[{ tier: "Business" }]] as any;
        }
        if (sql.includes("FROM CostSnapshots")) {
          // El conteo sale de las suscripciones REALES de Azure, no de
          // `TenantSubscriptions` (registro de facturación, que no tiene
          // columna subscription_id: esa consulta siempre tiraba error).
          return [[{ subscription_id: "sub-0" }]] as any;
        }
        if (sql.includes("FROM TenantSubscriptions")) {
          return [[]] as any; // sin slots comprados: rige el tope del plan
        }
        return [[]] as any;
      });

      const status = await getTenantTierLimitStatus("real-tenant-biz");
      expect(status.planTier).toBe("Business");
      expect(status.maxAllowedSubscriptions).toBe(3);
      expect(status.currentSubscriptionsCount).toBe(1);
      expect(status.isSubscriptionLimitReached).toBe(false);
      expect(status.canAddMoreSubscriptions).toBe(true);
      expect(status.upgradeTargetTier).toBeUndefined();
    });
  });

  describe("assertTenantSubscriptionQuota", () => {
    it("should pass without error for mock tenant", async () => {
      await expect(assertTenantSubscriptionQuota("demo-tenant-abc")).resolves.toBeUndefined();
    });

    it("should throw TierLimitException when quota is reached in Professional", async () => {
      vi.mocked(pool.query).mockImplementation(async (sql: string) => {
        if (sql.includes("FROM Tenants")) {
          return [[{ tier: "Professional" }]] as any;
        }
        if (sql.includes("FROM CostSnapshots")) {
          // El conteo sale de las suscripciones REALES de Azure, no de
          // `TenantSubscriptions` (registro de facturación, que no tiene
          // columna subscription_id: esa consulta siempre tiraba error).
          return [[{ subscription_id: "sub-0" }, { subscription_id: "sub-1" }]] as any;
        }
        if (sql.includes("FROM TenantSubscriptions")) {
          return [[]] as any; // sin slots comprados: rige el tope del plan
        }
        return [[]] as any;
      });

      await expect(assertTenantSubscriptionQuota("real-tenant-pro")).rejects.toThrowError(
        TierLimitException
      );
    });

    it("should pass when below quota", async () => {
      vi.mocked(pool.query).mockImplementation(async (sql: string) => {
        if (sql.includes("FROM Tenants")) {
          return [[{ tier: "Professional" }]] as any;
        }
        if (sql.includes("FROM CostSnapshots")) {
          // El conteo sale de las suscripciones REALES de Azure, no de
          // `TenantSubscriptions` (registro de facturación, que no tiene
          // columna subscription_id: esa consulta siempre tiraba error).
          return [[{ subscription_id: "sub-0" }]] as any;
        }
        if (sql.includes("FROM TenantSubscriptions")) {
          return [[]] as any; // sin slots comprados: rige el tope del plan
        }
        return [[]] as any;
      });

      await expect(assertTenantSubscriptionQuota("real-tenant-pro")).resolves.toBeUndefined();
    });
  });

  describe("assertFeatureAccess", () => {
    it("should throw when trying to access CSP_MARKUP on Professional tier", async () => {
      vi.mocked(pool.query).mockImplementation(async (sql: string) => {
        if (sql.includes("FROM Tenants")) {
          return [[{ tier: "Professional" }]] as any;
        }
        return [[]] as any;
      });

      await expect(assertFeatureAccess("real-tenant-pro", "CSP_MARKUP")).rejects.toThrowError(
        TierLimitException
      );
    });

    it("should throw when accessing CSP_MARKUP on Business tier", async () => {
      vi.mocked(pool.query).mockImplementation(async (sql: string) => {
        if (sql.includes("FROM Tenants")) {
          return [[{ tier: "Business" }]] as any;
        }
        return [[]] as any;
      });

      await expect(assertFeatureAccess("real-tenant-biz", "CSP_MARKUP")).rejects.toThrowError(
        TierLimitException
      );
    });

    it("should pass when accessing FOCUS_EXPORT on Business tier", async () => {
      vi.mocked(pool.query).mockImplementation(async (sql: string) => {
        if (sql.includes("FROM Tenants")) {
          return [[{ tier: "Business" }]] as any;
        }
        return [[]] as any;
      });

      await expect(assertFeatureAccess("real-tenant-biz", "FOCUS_EXPORT")).resolves.toBeUndefined();
    });
  });

  describe("createTierLimitResponse", () => {
    it("should format structured 402 error response", async () => {
      const response = createTierLimitResponse(
        {
          errorCode: "TIER_SUBSCRIPTION_LIMIT_REACHED",
          currentTier: "Professional",
          message: "Límite alcanzado",
          maxAllowed: 2,
          currentCount: 2,
          upgradeTargetTier: "Business",
          upgradeUrl: "/admin/billing",
        },
        402
      );

      expect(response.status).toBe(402);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("TIER_SUBSCRIPTION_LIMIT_REACHED");
      expect(json.currentTier).toBe("Professional");
      expect(json.upgradeTargetTier).toBe("Business");
    });
  });
});
