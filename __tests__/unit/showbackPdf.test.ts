import { describe, it, expect } from "vitest";
import { renderShowbackPdf } from "@/lib/pdf/showbackInvoice";

describe("showbackPdf", () => {
    it("should render a PDF for minimal data", async () => {
        const data = {
            tenantName: "Test Tenant",
            period: "2026-06",
            generatedDate: new Date().toISOString(),
            customerName: "Test Customer",
            customerId: "cust-001",
            billingPeriod: "2026-06",
            originalCost: 1000,
            adjustedCost: 1150,
            markupPercent: 15,
            markupAmount: 150,
            currency: "USD",
            lines: [
                {
                    date: "2026-06-01",
                    service: "Virtual Machines",
                    resourceGroup: "rg-prod",
                    originalCost: 500,
                    adjustedCost: 575,
                },
                {
                    date: "2026-06-02",
                    service: "SQL Database",
                    resourceGroup: "rg-prod",
                    originalCost: 500,
                    adjustedCost: 575,
                },
            ],
        };

        const buffer = await renderShowbackPdf({ data });

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(0);
        expect(buffer.toString("utf8", 0, 4)).toBe("%PDF");
    });

    it("should render a PDF for large datasets", async () => {
        const lines = Array.from({ length: 50 }, (_, i) => ({
            date: `2026-06-${String((i % 30) + 1).padStart(2, "0")}`,
            service: `Service-${i}`,
            resourceGroup: `rg-${i}`,
            originalCost: 100,
            adjustedCost: 115,
        }));

        const data = {
            tenantName: "Large Test Tenant",
            period: "2026-06",
            generatedDate: new Date().toISOString(),
            customerName: "Large Customer",
            customerId: "cust-large",
            billingPeriod: "2026-06",
            originalCost: 5000,
            adjustedCost: 5750,
            markupPercent: 15,
            markupAmount: 750,
            currency: "USD",
            lines,
        };

        const buffer = await renderShowbackPdf({ data });

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(0);
        expect(buffer.toString("utf8", 0, 4)).toBe("%PDF");
    });

    it("should handle currency formatting correctly", async () => {
        const data = {
            tenantName: "Test Tenant",
            period: "2026-06",
            generatedDate: new Date().toISOString(),
            customerName: "Test Customer",
            customerId: "cust-001",
            billingPeriod: "2026-06",
            originalCost: 123.456,
            adjustedCost: 142.024,
            markupPercent: 15,
            markupAmount: 18.568,
            currency: "ARS",
            lines: [
                {
                    date: "2026-06-01",
                    service: "Virtual Machines",
                    resourceGroup: "rg-prod",
                    originalCost: 123.456,
                    adjustedCost: 142.024,
                },
            ],
        };

        const buffer = await renderShowbackPdf({ data });

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.toString("utf8", 0, 4)).toBe("%PDF");
    });

    it("should handle empty lines array", async () => {
        const data = {
            tenantName: "Test Tenant",
            period: "2026-06",
            generatedDate: new Date().toISOString(),
            customerName: "Test Customer",
            customerId: "cust-001",
            billingPeriod: "2026-06",
            originalCost: 0,
            adjustedCost: 0,
            markupPercent: 15,
            markupAmount: 0,
            currency: "USD",
            lines: [],
        };

        const buffer = await renderShowbackPdf({ data });

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.toString("utf8", 0, 4)).toBe("%PDF");
    });
});
