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

    // El tier sale de `Tenants`, no de `TenantSaaSSubscriptions`: esa tabla NO
    // EXISTE (sin DDL en el repo, sin otro lector ni escritor). La query moría,
    // el catch se la tragaba y el panel mostraba el default del inicializador
    // --"Enterprise"-- a todo tenant real. Y el fallback tampoco servía: filtraba
    // por `WHERE id = ?` cuando la clave es `tenant_id`.
    it("getTenantBillingDetails lee el tier de Tenants para un tenant real", async () => {
        mocks.mockPoolQuery.mockImplementation((sql) => {
            if (sql.includes("FROM Tenants WHERE tenant_id = ?")) {
                return Promise.resolve([
                    [
                        {
                            tier: "Business",
                            subscription_status: "ACTIVE",
                            marketplace_plan_id: null,
                            marketplace_source: "direct",
                            paddle_subscription_id: "sub_live_1",
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
        // La única pasarela es Paddle. Antes esto esperaba "STRIPE", que salía de
        // una columna de la tabla inexistente.
        expect(details.paymentGateway).toBe("PADDLE");
        expect(details.hasPaddleSubscription).toBe(true);
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
        mocks.mockPoolQuery.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await cancelTenantSubscription("tenant-live-abc", "owner@company.com");
        expect(result.success).toBe(true);
        // La baja se registra en `Tenants.cancel_at_period_end`. Antes escribía en
        // `TenantSaaSSubscriptions` (inexistente) y caía a un fallback con
        // `WHERE id = ?` y un valor que el ENUM no admite: no persistía nada.
        expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
            expect.stringContaining("UPDATE Tenants SET cancel_at_period_end = TRUE WHERE tenant_id = ?"),
            ["tenant-live-abc"]
        );
        expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
            expect.stringContaining("INSERT INTO SecurityAuditTrail"),
            expect.arrayContaining(["tenant-live-abc", "SUBSCRIPTION_CANCEL_REQUESTED", "owner@company.com"])
        );
    });

    // Antes devolvía success aunque no escribiera en ningún lado: el cliente
    // pedía la baja, la app decía "listo" y no quedaba registro.
    it("cancelTenantSubscription falla si no actualizó ninguna fila", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{ affectedRows: 0 }, []]);
        await expect(cancelTenantSubscription("tenant-que-no-existe")).rejects.toThrow();
    });
});
