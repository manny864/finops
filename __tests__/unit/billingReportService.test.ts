import { describe, it, expect, vi } from 'vitest';
import {
    getBillingReportData,
    serializeBillingCsv,
    generatePbidsConnector,
    generateBillingZipPackage,
    generateCustomerInvoicePdf,
    MOCK_BILLING_DATA,
} from '@/services/billingReport.service';

vi.mock('@/modules/storage/db', () => ({
    default: {
        query: vi.fn().mockResolvedValue([[]]),
    },
}));

vi.mock('@/services/tenantPartnerMarkup.service', () => ({
    getMarkupSettings: vi.fn().mockResolvedValue({
        tenantId: 'real-enterprise-tenant-abc',
        isMarkupEnabled: true,
        globalMarkupPercentage: 15.0,
    }),
    getActiveOverrides: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/azure', () => ({
    getAzureCredential: vi.fn().mockResolvedValue({}),
}));

describe('billingReport.service — Partner Markup, FOCUS 1.0 & Export Engine', () => {
    it('debe devolver métricas y líneas de facturación sintéticas exclusivamente para tenants demo', async () => {
        const result = await getBillingReportData('demo-tenant', '2026-07');

        expect(result.success).toBe(true);
        expect(result.mock).toBe(true);
        expect(result.totals).toBeDefined();
        expect(result.totals?.originalCost).toBe(18454.00);
        expect(result.totals?.markupAmount).toBe(2768.10);
        expect(result.totals?.adjustedCost).toBe(21222.10);

        expect(result.byCustomer.length).toBeGreaterThan(0);
        expect(result.bySubscription.length).toBeGreaterThan(0);
        expect(result.lines.length).toBeGreaterThan(0);

        // Verificar que ningún costo ajustado sea 0 o negativo
        result.byCustomer.forEach((c) => {
            expect(c.adjustedCostUSD).toBeGreaterThanOrEqual(c.originalCostUSD);
        });
    });

    it('TOLERANCIA CERO A MOCKS EN TENANTS REALES: debe devolver ceros y arrays vacíos legítimos si no hay datos en DB', async () => {
        const result = await getBillingReportData('real-enterprise-tenant-abc', '2026-07');

        expect(result.success).toBe(true);
        expect(result.mock).toBe(false); // NUNCA MOCK
        expect(result.totals?.originalCost).toBe(0);
        expect(result.totals?.markupAmount).toBe(0);
        expect(result.totals?.adjustedCost).toBe(0);
        expect(result.byCustomer).toEqual([]);
        expect(result.bySubscription).toEqual([]);
        expect(result.byInvoiceSection).toEqual([]);
        expect(result.lines).toEqual([]);
    });

    it('debe serializar el detalle de líneas a formato CSV con columnas FOCUS 1.0', () => {
        const csv = serializeBillingCsv(MOCK_BILLING_DATA.lines);

        expect(csv).toContain('Fecha,Customer ID,Cliente,Billing Profile,Invoice Section,Servicio,Resource Group,Costo Original USD,Costo Ajustado USD');
        expect(csv).toContain('cust-001');
        expect(csv).toContain('ACME Corp');
        expect(csv).toContain('1230.50');
        expect(csv).toContain('1415.08');
    });

    it('debe generar el conector Power BI Data Source (.pbids) estructurado', () => {
        const pbidsString = generatePbidsConnector('demo-tenant', '2026-07', 'https://finops.cscloudsolutions.com.ar');
        const parsed = JSON.parse(pbidsString);

        expect(parsed.version).toBe('0.1');
        expect(parsed.connections).toBeDefined();
        expect(parsed.connections[0].mode).toBe('Import');
        expect(parsed.connections[0].details.protocol).toBe('https');
        expect(parsed.connections[0].details.address.url).toContain('/api/exports/powerbi-feed?type=invoicing');
    });

    it('debe generar un archivo ZIP empaquetando los 5 artefactos de facturación', async () => {
        const zipBuffer = await generateBillingZipPackage(
            MOCK_BILLING_DATA,
            'demo-tenant',
            '2026-07',
            'https://finops.cscloudsolutions.com.ar'
        );

        expect(zipBuffer).toBeInstanceOf(Buffer);
        expect(zipBuffer.length).toBeGreaterThan(500);

        // Header ZIP 'PK'
        const zipHeader = zipBuffer.subarray(0, 2).toString('ascii');
        expect(zipHeader).toBe('PK');
    });

    it('debe generar una factura proforma individual en PDF A4 con cabecera %PDF-', async () => {
        const pdfBuffer = await generateCustomerInvoicePdf(
            MOCK_BILLING_DATA,
            'cust-001',
            'CSCloudSolutions Partner'
        );

        expect(pdfBuffer).toBeInstanceOf(Buffer);
        expect(pdfBuffer.length).toBeGreaterThan(500);

        const pdfHeader = pdfBuffer.subarray(0, 5).toString('ascii');
        expect(pdfHeader).toBe('%PDF-');
    });
});
