import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ingestCostExportsForTenant } from '@/services/costExportIngestionService';
import * as azureBlob from '@/lib/azureBlobStorage';
import pool from '@/modules/storage/db';

vi.mock('@/lib/azureBlobStorage', () => ({
    isBlobStorageEnabled: vi.fn(),
    listBlobs: vi.fn(),
    downloadBlob: vi.fn(),
}));

vi.mock('@/modules/storage/db', () => ({
    default: {
        query: vi.fn(),
    },
}));

describe('costExportIngestionService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns error when blob storage is not enabled', async () => {
        vi.mocked(azureBlob.isBlobStorageEnabled).mockReturnValue(false);
        const res = await ingestCostExportsForTenant('test-tenant');
        expect(res.success).toBe(false);
        expect(res.error).toContain('Blob Storage no está habilitado');
    });

    it('returns success with 0 ingested rows when no blobs exist', async () => {
        vi.mocked(azureBlob.isBlobStorageEnabled).mockReturnValue(true);
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([]);
        const res = await ingestCostExportsForTenant('test-tenant');
        expect(res.success).toBe(true);
        expect(res.blobsProcessed).toBe(0);
        expect(res.rowsIngested).toBe(0);
    });

    it('processes CSV export files and inserts into CostSnapshots', async () => {
        vi.mocked(azureBlob.isBlobStorageEnabled).mockReturnValue(true);
        vi.mocked(azureBlob.listBlobs).mockResolvedValue(['focus-cost-data/test-tenant/export_20260814.csv']);
        
        const mockCsv = `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost\n` +
                        `2026-08-14,sub-123,rg-test,Virtual Machines,42.50\n` +
                        `2026-08-14,sub-123,rg-test,Storage,10.25\n`;
        
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(mockCsv, 'utf-8'));
        vi.mocked(pool.query).mockResolvedValue([[]] as any);

        const res = await ingestCostExportsForTenant('test-tenant');
        expect(res.success).toBe(true);
        expect(res.blobsProcessed).toBe(1);
        expect(res.rowsIngested).toBe(2);
        expect(pool.query).toHaveBeenCalledTimes(2);
    });
});
