// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import {
    getTenantBillingDetails,
    getCustomerPortalUrl,
    cancelTenantSubscription,
} from "@/services/saasBilling.service";

const mocks = vi.hoisted(() => {
    return {
        mockPoolQuery: vi.fn(),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: { query: mocks.mockPoolQuery, getConnection: vi.fn() },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

describe("saasBilling.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
    });

    it("getTenantBillingDetails returns synthetic Enterprise plan for demo tenant", async () => {
        const details = await getTenantBillingDetails("demo-tenant-123");
        expect(details.planTier).toBe("Enterprise");
        expect(details.status).toBe("ACTIVE");
        expect(details.billingCycle).toBe("ANNUAL");
        expect(details.paymentGateway).toBe("PADDLE");
        expect(details.isEnterprise).toBe(true);
        expect(details.invoices.length).toBe(3);
        expect(details.invoices[0].invoiceNumber).toBe("INV-2026-0842");
        expect(details.invoices[0].amountUSD).toBe(1200);
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
    });

    it("getTenantBillingDetails queries TenantSaaSSubscriptions and SaaSInvoices for real tenant", async () => {
        mocks.mockPoolQuery.mockImplementation((sql) => {
            if (sql.includes("SELECT plan_tier, status, billing_cycle, payment_gateway, current_period_end, cancel_at_period_end FROM TenantSaaSSubscriptions")) {
                return Promise.resolve([
                    [
                        {
                            plan_tier: "Business",
                            status: "ACTIVE",
                            billing_cycle: "MONTHLY",
                            payment_gateway: "STRIPE",
                            current_period_end: "2026-09-01T00:00:00Z",
                            cancel_at_period_end: 0,
                        },
                    ],
                    [],
                ]);
            }
            if (sql.includes("SELECT id, invoice_number, billing_date, amount_usd, status, download_pdf_url FROM SaaSInvoices")) {
                return Promise.resolve([
                    [
                        {
                            id: 1,
                            invoice_number: "INV-REAL-100",
                            billing_date: "2026-08-01T00:00:00Z",
                            amount_usd: 499.0,
                            status: "PAID",
                            download_pdf_url: "/invoices/1.pdf",
                        },
                    ],
                    [],
                ]);
            }
            return Promise.resolve([[], []]);
        });

        const details = await getTenantBillingDetails("tenant-live-abc");
        expect(details.planTier).toBe("Business");
        expect(details.paymentGateway).toBe("STRIPE");
        expect(details.cancelAtPeriodEnd).toBe(false);
        expect(details.invoices.length).toBe(1);
        expect(details.invoices[0].invoiceNumber).toBe("INV-REAL-100");
    });

    it("getCustomerPortalUrl returns sandbox demo URL for mock tenant", async () => {
        const portal = await getCustomerPortalUrl("demo-tenant-123");
        expect(portal.success).toBe(true);
        expect(portal.portalUrl).toContain("paddle.com");
        expect(portal.gateway).toBe("PADDLE");
    });

    it("cancelTenantSubscription returns success for demo tenant without inserting into db", async () => {
        const result = await cancelTenantSubscription("demo-tenant-123");
        expect(result.success).toBe(true);
        expect(result.message).toContain("cancelada");
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
    });

    it("cancelTenantSubscription updates database and logs audit event for real tenant", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{}, []]);

        const result = await cancelTenantSubscription("tenant-live-abc", "owner@company.com");
        expect(result.success).toBe(true);
        expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
            expect.stringContaining("UPDATE TenantSaaSSubscriptions SET cancel_at_period_end = TRUE WHERE tenant_id = ?"),
            ["tenant-live-abc"]
        );
        expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
            expect.stringContaining("INSERT INTO SecurityAuditTrail"),
            expect.arrayContaining(["tenant-live-abc", "SUBSCRIPTION_CANCEL_REQUESTED", "owner@company.com"])
        );
    });
});
