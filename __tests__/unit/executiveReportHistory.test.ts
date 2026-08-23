import { describe, it, expect } from 'vitest';
import {
    getTierRetentionDays,
    getExecutiveReportHistory,
    generateDownloadSas,
    rehydrateReportData,
    deleteReportFromHistory,
} from '@/services/executiveReportHistory.service';

describe('ExecutiveReportHistory Service', () => {
    it('should map tier retention days correctly', () => {
        expect(getTierRetentionDays('Professional')).toBe(90);
        expect(getTierRetentionDays('Business')).toBe(180);
        expect(getTierRetentionDays('Enterprise')).toBe(365);
    });

    it('should retrieve mock report history summary metrics with tier retention', async () => {
        const mockTenantId = 'demo-tenant-finops';
        const res = await getExecutiveReportHistory({
            tenantId: mockTenantId,
            page: 1,
            pageSize: 15,
        });

        expect(res).toBeDefined();
        expect(res.totalReportsCount).toBeGreaterThan(0);
        expect(res.tierRetentionDays).toBe(90);
        expect(res.activePlanTier).toBe('Professional');
        expect(res.reports.length).toBeGreaterThan(0);

        const firstReport = res.reports[0];
        expect(firstReport.id).toBeDefined();
        expect(firstReport.tenantId).toBe(mockTenantId);
        expect(firstReport.formattedCreatedAt).toBeDefined();
        expect(firstReport.daysRemainingBeforeExpiry).toBeGreaterThan(0);
        expect(firstReport.formattedSizeMb).toContain('MB');
        expect(firstReport.totalMonthlyCostSnapshotUSD).toBe(675.84);
        expect(firstReport.totalMonthlySavingsSnapshotUSD).toBe(9930.00);
    });

    it('should filter mock history by search term and email', async () => {
        const mockTenantId = 'demo-tenant-finops';
        const res = await getExecutiveReportHistory({
            tenantId: mockTenantId,
            search: 'Production',
            scopeFilter: 'ALL',
            emailFilter: 'ALL',
        });

        expect(res.reports.length).toBe(1);
        expect(res.reports[0].scopeDisplayName).toContain('Production');
    });

    it('should generate ephemeral SAS download link', async () => {
        const mockTenantId = 'demo-tenant-finops';
        const sas = await generateDownloadSas({
            tenantId: mockTenantId,
            reportId: '90003',
            fileType: 'pdf',
        });

        expect(sas).toBeDefined();
        expect(sas.fileName).toBe('Reporte-Ejecutivo-demo-tenant-finops-90003.pdf');
        expect(sas.sasDownloadUrl).toContain('/api/reports/history/90003/download');
        expect(new Date(sas.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('should rehydrate snapshot data for live panel viewing', async () => {
        const mockTenantId = 'demo-tenant-finops';
        const rehydrated = await rehydrateReportData(mockTenantId, '90003');

        expect(rehydrated).toBeDefined();
        expect(rehydrated.report).toContain('Reporte Ejecutivo FinOps');
        expect(rehydrated.metadata.requestedBy).toBe('demo@cscloudsolutions.com.ar');
    });

    it('should handle deletion of report', async () => {
        const mockTenantId = 'demo-tenant-finops';
        const success = await deleteReportFromHistory(mockTenantId, '90003');
        expect(success).toBe(true);
    });
});
