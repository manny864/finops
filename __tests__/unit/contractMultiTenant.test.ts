import { describe, it, expect, vi, beforeEach } from "vitest";
import { getSubscriptionLimit, getUserLimit, hasAccess, normalizeTier } from "@/lib/tierLogic";
import { getTenantTierLimitStatus, isFeatureIncludedInTier } from "@/middleware/tierLimitsGuard";
import pool from "@/modules/storage/db";

vi.mock("@/modules/storage/db", () => ({
    default: {
        query: vi.fn(),
    },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

describe("contractMultiTenant - Capacidad y Límites Heredados por Contrato", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("Límites Contractuales por Tier para cada Tenant vinculado", () => {
        it("Tier Professional otorga 2 suscripciones Azure por tenant", () => {
            expect(getSubscriptionLimit("Professional")).toBe(2);
            expect(getSubscriptionLimit("pro")).toBe(2);
        });

        it("Tier Business otorga 3 suscripciones Azure por tenant", () => {
            expect(getSubscriptionLimit("Business")).toBe(3);
            expect(getSubscriptionLimit("business")).toBe(3);
        });

        it("Tier Enterprise otorga suscripciones Azure ilimitadas por tenant", () => {
            expect(getSubscriptionLimit("Enterprise")).toBe(Infinity);
            expect(getSubscriptionLimit("enterprise")).toBe(Infinity);
        });

        it("Límites de usuarios por tenant en cada Tier", () => {
            expect(getUserLimit("Professional")).toBe(3);
            expect(getUserLimit("Business")).toBe(5);
            expect(getUserLimit("Enterprise")).toBe(Infinity);
        });
    });

    describe("Herencia de Tier desde Tenant Titular del Contrato", () => {
        it("Resuelve el tier Business heredado del parent_tenant_id para un tenant hijo", async () => {
            // Mock de query a Tenants con LEFT JOIN al parent
            (pool.query as any).mockImplementation((sql: string) => {
                if (sql.includes("FROM Tenants t") && sql.includes("LEFT JOIN Tenants p")) {
                    return Promise.resolve([
                        [
                            {
                                tier: "Business",
                                subscription_status: "ACTIVE",
                            },
                        ],
                    ]);
                }
                if (sql.includes("SELECT COUNT")) {
                    return Promise.resolve([[{ total: 1 }]]);
                }
                return Promise.resolve([[]]);
            });

            const status = await getTenantTierLimitStatus("child-tenant-guid-123");

            expect(status.planTier).toBe("Business");
            expect(status.maxAllowedSubscriptions).toBe(3);
            expect(status.currentSubscriptionsCount).toBe(1);
            expect(status.isSubscriptionLimitReached).toBe(false);
            expect(status.canAddMoreSubscriptions).toBe(true);
            expect(isFeatureIncludedInTier(status.planTier, "CSP_MARKUP")).toBe(true);
            expect(isFeatureIncludedInTier(status.planTier, "FOCUS_EXPORT")).toBe(true);
        });

        it("Resuelve el tier Enterprise heredado del parent_tenant_id con capacidad ilimitada", async () => {
            (pool.query as any).mockImplementation((sql: string) => {
                if (sql.includes("FROM Tenants t") && sql.includes("LEFT JOIN Tenants p")) {
                    return Promise.resolve([
                        [
                            {
                                tier: "Enterprise",
                                subscription_status: "ACTIVE",
                            },
                        ],
                    ]);
                }
                if (sql.includes("SELECT COUNT")) {
                    return Promise.resolve([[{ total: 5 }]]);
                }
                return Promise.resolve([[]]);
            });

            const status = await getTenantTierLimitStatus("child-tenant-enterprise-456");

            expect(status.planTier).toBe("Enterprise");
            expect(status.maxAllowedSubscriptions).toBe(9999);
            expect(status.isSubscriptionLimitReached).toBe(false);
            expect(status.canAddMoreSubscriptions).toBe(true);
            expect(isFeatureIncludedInTier(status.planTier, "UNLIMITED_SUBS")).toBe(true);
            expect(isFeatureIncludedInTier(status.planTier, "ADVANCED_AI")).toBe(true);
        });

        it("Aplica tope estricto de 2 suscripciones en tier Professional para un tenant hijo", async () => {
            (pool.query as any).mockImplementation((sql: string) => {
                if (sql.includes("FROM Tenants t") && sql.includes("LEFT JOIN Tenants p")) {
                    return Promise.resolve([
                        [
                            {
                                tier: "Professional",
                                subscription_status: "ACTIVE",
                            },
                        ],
                    ]);
                }
                if (sql.includes("SELECT COUNT")) {
                    return Promise.resolve([[{ total: 2 }]]);
                }
                return Promise.resolve([[]]);
            });

            const status = await getTenantTierLimitStatus("child-tenant-pro-789");

            expect(status.planTier).toBe("Professional");
            expect(status.maxAllowedSubscriptions).toBe(2);
            expect(status.currentSubscriptionsCount).toBe(2);
            expect(status.isSubscriptionLimitReached).toBe(true);
            expect(status.canAddMoreSubscriptions).toBe(false);
            expect(status.upgradeTargetTier).toBe("Business");
        });
    });
});
