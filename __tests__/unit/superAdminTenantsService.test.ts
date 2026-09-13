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
        expect(result.tenant.subscriptionStatus).toBe("ACTIVE");
        expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
            expect.stringContaining("INSERT INTO Tenants"),
            ["guid-real-001", "Live Tenant Provisioned", "Business", "ACTIVE"]
        );
    });

    // Las columnas reales de Tenants son tenant_id/company_name. El INSERT usaba
    // domain/name, que no existen en ninguna migración: el alta manual real
    // siempre tiraba error y sólo "andaba" en mock. Este test lo fija.
    it("createManualTenant uses the real Tenants column names", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{}, []]);

        await createManualTenant(
            { entraTenantId: "guid-cols", organizationName: "Col Check", initialPlanTier: "Business" },
            false
        );

        const sql = String(mocks.mockPoolQuery.mock.calls[0][0]);
        expect(sql).toContain("tenant_id");
        expect(sql).toContain("company_name");
        expect(sql).not.toMatch(/\bdomain\b/);
        expect(sql).not.toMatch(/\bname\b(?!_)/);
    });

    it.each([7, 15, 30] as const)("createManualTenant sets a %i-day trial", async (days) => {
        mocks.mockPoolQuery.mockResolvedValue([{}, []]);

        const result = await createManualTenant(
            {
                entraTenantId: `guid-trial-${days}`,
                organizationName: "Trial Corp",
                initialPlanTier: "Professional",
                trialDays: days,
            },
            false
        );

        expect(result.tenant.subscriptionStatus).toBe("TRIAL");
        const [sql, values] = mocks.mockPoolQuery.mock.calls[0];
        expect(String(sql)).toContain("DATE_ADD(NOW(), INTERVAL ? DAY)");
        expect(values).toEqual([`guid-trial-${days}`, "Trial Corp", "Professional", "TRIAL", days]);
    });

    it("createManualTenant ignores a trial length outside the whitelist", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{}, []]);

        const result = await createManualTenant(
            {
                entraTenantId: "guid-bogus",
                organizationName: "Bogus Corp",
                initialPlanTier: "Business",
                trialDays: 300 as never,
            },
            false
        );

        // Sin trial, no un trial de 300 días.
        expect(result.tenant.subscriptionStatus).toBe("ACTIVE");
        const [sql, values] = mocks.mockPoolQuery.mock.calls[0];
        expect(String(sql)).toContain("NULL");
        expect(values).not.toContain(300);
    });

    it("createManualTenant in mock mode reflects the requested trial", async () => {
        const result = await createManualTenant(
            {
                entraTenantId: "guid-mock-trial",
                organizationName: "Mock Trial Corp",
                initialPlanTier: "Business",
                trialDays: 15,
            },
            true
        );

        expect(result.tenant.subscriptionStatus).toBe("TRIAL");
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
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
        // El WHERE viejo era `id = ? OR domain = ?`: `domain` no existe y `id` es
        // el autoincrement, no el GUID. El UPDATE nunca tocaba una fila.
        expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
            expect.stringContaining("WHERE tenant_id = ?"),
            ["Enterprise", "ACTIVE", "tenant-live-01"]
        );
        const tierSql = String(mocks.mockPoolQuery.mock.calls[0][0]);
        expect(tierSql).not.toMatch(/\bdomain\b/);
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
        const [sql, values] = mocks.mockPoolQuery.mock.calls[0];
        expect(String(sql)).toContain("INSERT INTO TenantCommercialDeals");
        // `id` es VARCHAR(36) PK sin default: sin él el INSERT tira error 1364.
        expect(String(sql)).toContain("id");
        // 6 desde MEJ-14: se sumaron `sold_at` y `contract_term`, que son el
        // arranque y la modalidad del devengamiento de comisiones.
        expect(values).toHaveLength(6);
        expect(String(values[0])).toMatch(/^[0-9a-f-]{36}$/);
        expect(values.slice(1, 4)).toEqual(["tenant-live-01", "Mariana Lopez", 14.5]);
        expect(String(values[4])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(values[5]).toBe("monthly");
    });

    it("createManualTenant registers is_manual_bypass on TenantSubscriptions, not on the deals table", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{}, []]);

        await createManualTenant(
            { entraTenantId: "guid-bypass", organizationName: "Bypass SA", initialPlanTier: "Business" },
            false
        );

        const allSql = mocks.mockPoolQuery.mock.calls.map((c) => String(c[0]));
        const dealsSql = allSql.find((s) => s.includes("TenantCommercialDeals")) ?? "";
        const subsSql = allSql.find((s) => s.includes("TenantSubscriptions")) ?? "";

        expect(dealsSql).not.toContain("is_manual_bypass");
        expect(subsSql).toContain("is_manual_bypass");
    });

    it("generatePaddleCheckoutLink persists paddle_price_id on TenantSubscriptions", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{}, []]);

        await generatePaddleCheckoutLink({ tenantId: "tenant-x", paddlePriceId: "pri_abc" }, false);

        const sql = String(mocks.mockPoolQuery.mock.calls[0][0]);
        expect(sql).toContain("TenantSubscriptions");
        expect(sql).toContain("paddle_price_id");
        expect(sql).not.toContain("TenantCommercialDeals");
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
