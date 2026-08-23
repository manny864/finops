// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import {
    listAllTenantsForSuperAdmin,
    createManualTenant,
    updateTenantTierAndStatus,
    updateCommercialDeal,
    generatePaddleCheckoutLink,
} from "@/services/superAdminTenants.service";

const mocks = vi.hoisted(() => {
    return {
        mockPoolQuery: vi.fn(),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: { query: mocks.mockPoolQuery, getConnection: vi.fn() },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

describe("superAdminTenants.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
    });

    it("listAllTenantsForSuperAdmin returns 7 mock tenants when isMock is true", async () => {
        const tenants = await listAllTenantsForSuperAdmin(true);
        expect(tenants.length).toBe(7);
        expect(tenants[0].organizationName).toBe("ACME Corporation");
        expect(tenants[0].planTier).toBe("Enterprise");
        expect(tenants[0].salesRepName).toBe("Juan Manuel Chavez");
        expect(tenants[0].salesCommissionPercent).toBe(15.0);
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
    });

    it("listAllTenantsForSuperAdmin queries database for real superadmin call", async () => {
        mocks.mockPoolQuery.mockResolvedValue([
            [
                {
                    tenant_id: "tenant-live-01",
                    entra_tenant_id: "0000-1111-2222",
                    organization_name: "Live Enterprise Corp",
                    subscription_status: "ACTIVE",
                    plan_tier: "Enterprise",
                    sales_rep_name: "Carlos Vendedor",
                    sales_commission_percent: 12.0,
                    paddle_price_id: "pri_live_123",
                    is_manual_bypass: 1,
                    created_at: "2026-08-01T00:00:00Z",
                },
            ],
            [],
        ]);

        const tenants = await listAllTenantsForSuperAdmin(false);
        expect(tenants.length).toBe(1);
        expect(tenants[0].organizationName).toBe("Live Enterprise Corp");
        expect(tenants[0].planTier).toBe("Enterprise");
        expect(tenants[0].salesRepName).toBe("Carlos Vendedor");
    });

    it("createManualTenant creates tenant in mock mode without database calls", async () => {
        const result = await createManualTenant(
            {
                entraTenantId: "12345678-1234-1234-1234-123456789012",
                organizationName: "Mock Corp B2B",
                initialPlanTier: "Enterprise",
            },
            true
        );

        expect(result.success).toBe(true);
        expect(result.tenant.entraTenantId).toBe("12345678-1234-1234-1234-123456789012");
        expect(result.tenant.organizationName).toBe("Mock Corp B2B");
        expect(result.tenant.isManualBypass).toBe(true);
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
    });

    it("createManualTenant inserts into Tenants and TenantCommercialDeals in real mode", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{}, []]);

        const result = await createManualTenant(
            {
                entraTenantId: "guid-real-001",
                organizationName: "Live Tenant Provisioned",
                initialPlanTier: "Business",
            },
            false
        );

        expect(result.success).toBe(true);
        expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
            expect.stringContaining("INSERT INTO Tenants"),
            expect.arrayContaining(["guid-real-001", "guid-real-001", "Live Tenant Provisioned", "Business"])
        );
    });

    it("updateTenantTierAndStatus updates database for real call", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await updateTenantTierAndStatus(
            {
                tenantId: "tenant-live-01",
                planTier: "Enterprise",
                subscriptionStatus: "ACTIVE",
            },
            false
        );

        expect(result.success).toBe(true);
        expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
            expect.stringContaining("UPDATE Tenants SET tier = ?, subscription_status = ?"),
            ["Enterprise", "ACTIVE", "tenant-live-01", "tenant-live-01"]
        );
    });

    it("updateCommercialDeal updates sales rep and commission in database", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await updateCommercialDeal(
            {
                tenantId: "tenant-live-01",
                salesRepName: "Mariana Lopez",
                salesCommissionPercent: 14.5,
            },
            false
        );

        expect(result.success).toBe(true);
        expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
            expect.stringContaining("INSERT INTO TenantCommercialDeals"),
            ["tenant-live-01", "Mariana Lopez", 14.5]
        );
    });

    it("generatePaddleCheckoutLink generates custom checkout URL", async () => {
        const link = await generatePaddleCheckoutLink(
            {
                tenantId: "tenant-acme-prod",
                paddlePriceId: "pri_01h8_enterprise_annual",
            },
            true
        );

        expect(link.checkoutUrl).toContain("price_id=pri_01h8_enterprise_annual");
        expect(link.checkoutUrl).toContain("custom_data=");
        expect(link.priceId).toBe("pri_01h8_enterprise_annual");
        expect(link.tenantId).toBe("tenant-acme-prod");
    });
});
