import { describe, it, expect } from 'vitest';
import {
    startExecutiveReportJob,
    getExecutiveReportJobStatus,
    getActiveExecutiveReportJob,
    getLatestCompletedReport,
} from '@/services/executiveReportJob.service';

describe('ExecutiveReportJob Service', () => {
    it('should start an async job for mock tenant in QUEUED status', async () => {
        const mockTenantId = 'demo-tenant-async';
        const res = await startExecutiveReportJob({
            tenantId: mockTenantId,
            scope: 'TENANT_ALL',
            scopeId: 'All',
            scopeName: 'Tenant completo',
            triggerAiAnalysis: true,
            sendEmailNotification: false,
        });

        expect(res).toBeDefined();
        expect(res.success).toBe(true);
        expect(res.jobId).toBeDefined();
        expect(res.status).toBe('QUEUED');
        expect(res.progressPercent).toBe(5);
        expect(res.currentStepLabel).toContain('cola');
    });

    it('should poll job status and reflect steps', async () => {
        const mockTenantId = 'demo-tenant-async';
        const startRes = await startExecutiveReportJob({
            tenantId: mockTenantId,
            scope: 'TENANT_ALL',
            scopeId: 'All',
            triggerAiAnalysis: false,
        });

        const statusRes = await getExecutiveReportJobStatus(startRes.jobId, mockTenantId);
        expect(statusRes).toBeDefined();
        expect(statusRes.success).toBe(true);
        expect(statusRes.jobId).toBe(startRes.jobId);
        expect(statusRes.progressPercent).toBeGreaterThanOrEqual(5);
    });

    it('should retrieve latest completed report for idle state without auto-generating', async () => {
        const mockTenantId = 'demo-tenant-async';
        const latest = await getLatestCompletedReport(mockTenantId);

        expect(latest).toBeDefined();
        expect(latest?.reportId).toBeDefined();
        expect(latest?.data).toBeDefined();
        expect(latest?.completedAt).toBeDefined();
    });

    it('should return null or active job for active executive job query', async () => {
        const mockTenantId = 'demo-tenant-active-test';
        const active = await getActiveExecutiveReportJob(mockTenantId);
        // If no active in memory, returns null
        expect(active === null || active.tenantId === mockTenantId).toBe(true);
    });
});
