import { describe, it, expect } from 'vitest';
import { compileExecutiveReportPdfBuffer } from '@/services/pdfCompiler.service';
import type { ExecutiveReportFullData } from '@/types/executiveReport.types';

describe('pdfCompiler.service — A4 PDF Document Generation Engine', () => {
    const mockReportData: ExecutiveReportFullData = {
        tenantId: 'demo-tenant',
        organizationName: 'Demo Corporation',
        scope: 'TENANT_ALL',
        scopeId: 'All',
        scopeDisplayName: 'Tenant completo',
        generatedAtIso: new Date().toISOString(),
        kpiMetrics: {
            mtdSpendUSD: 675.84,
            momVariationPercent: 12.4,
            projectedMonthEndUSD: 936.37,
            monthlySavingsIdentifiedUSD: 9930.0,
            annualizedSavingsUSD: 119160.0,
            criticalHighHaRisksCount: 45,
            co2ImpactKg: 142.5,
            taggingCoveragePercent: 47.0,
            commitmentsCoveragePercent: 0.0,
            rightsizingCandidatesCount: 6,
            rightsizingSavingsUSD: 1113.5,
            activeAnomaliesCount: 3,
            budgetBurnPercent: 68.5,
        },
        aiMarkdown: `
## 1. Resumen Ejecutivo
El entorno Azure de Demo Corporation presenta una oportunidad de ahorro inmediato de $9,930.00/mes.

| Recurso | Tipo | Ahorro Mensual |
| :--- | :--- | :--- |
| vm-prod-01 | Virtual Machine | $240.00 |
| disk-orphaned-02 | Managed Disk | $85.00 |

> Se recomienda proceder con el plan de desasignación y derechos de reserva.
`,
        historicalSpend6M: [
            { month: 'Mar 2026', spendUSD: 580000, momDeltaPercent: null },
            { month: 'Abr 2026', spendUSD: 595000, momDeltaPercent: 2.5 },
        ],
        costByService: [{ name: 'Virtual Machines', costUSD: 350.0, percentage: 51.8 }],
        costByResourceGroup: [{ name: 'rg-production', costUSD: 450.0, percentage: 66.6 }],
        costByRegion: [{ name: 'eastus2', costUSD: 675.84, percentage: 100.0 }],
        topCostlyResources: [
            { id: '1', name: 'vm-db-master', type: 'Virtual Machine', resourceGroup: 'rg-prod', costUSD: 180.0 },
        ],
        zombieFindings: [
            {
                resourceId: 'r1',
                resourceName: 'disk-temp-01',
                type: 'Disk',
                resourceGroup: 'rg-prod',
                costUSD: 45.0,
                impact: 'HIGH',
                confidence: 'CONFIRMED',
            },
        ],
        haRisks: [
            {
                resourceId: 'vm1',
                resourceName: 'vm-app-01',
                type: 'Virtual Machine',
                resourceGroup: 'rg-prod',
                impact: 'CRITICAL',
                riskDescription: 'Sin zona de disponibilidad',
            },
        ],
        activeAnomalies: [
            {
                id: 'a1',
                serviceName: 'Storage Accounts',
                expectedCostUSD: 20.0,
                actualCostUSD: 120.0,
                deviationPercent: 500.0,
                detectedAtIso: new Date().toISOString(),
            },
        ],
        rightsizingOpportunities: [
            {
                resourceName: 'vm-compute-02',
                currentSku: 'Standard_D8s_v5',
                recommendedSku: 'Standard_D4s_v5',
                monthlySavingsUSD: 180.0,
            },
        ],
        budgetsExecution: [
            {
                name: 'Presupuesto General',
                amountUSD: 1500.0,
                currentSpendUSD: 675.84,
                burnPercent: 45.0,
                isExceeded: false,
            },
        ],
    };

    it('debe compilar un buffer binario PDF válido con cabecera estándar %PDF-', async () => {
        const buffer = await compileExecutiveReportPdfBuffer(mockReportData);

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(500);

        const pdfHeader = buffer.subarray(0, 5).toString('ascii');
        expect(pdfHeader).toBe('%PDF-');
    });
});
