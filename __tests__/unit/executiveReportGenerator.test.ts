import { describe, it, expect, vi } from 'vitest';
import {
    aggregateExecutiveTelemetry,
    buildExecutiveReportHtmlDocument,
    EXECUTIVE_REPORT_SYSTEM_PROMPT,
    HARD_WASTE_CONFIG,
} from '@/services/executiveReportGenerator.service';

describe('ExecutiveReportGenerator Service', () => {
    it('should generate complete mock executive report full data for demo tenant', async () => {
        const mockTenantId = 'demo-tenant-123';
        const data = await aggregateExecutiveTelemetry(mockTenantId, 'TENANT_ALL');

        expect(data).toBeDefined();
        expect(data.tenantId).toBe(mockTenantId);
        expect(data.organizationName).toContain('Demo');
        expect(data.kpiMetrics).toBeDefined();
        expect(data.kpiMetrics.mtdSpendUSD).toBe(675.84);
        expect(data.kpiMetrics.projectedMonthEndUSD).toBe(936.37);
        expect(data.kpiMetrics.monthlySavingsIdentifiedUSD).toBe(9930.00);
        expect(data.kpiMetrics.annualizedSavingsUSD).toBe(119160.00);
        expect(data.kpiMetrics.criticalHighHaRisksCount).toBe(45);
        expect(data.kpiMetrics.taggingCoveragePercent).toBe(83.0);
        expect(data.kpiMetrics.commitmentsCoveragePercent).toBe(45.0);
        expect(data.historicalTrends.length).toBe(6);
        expect(data.inefficiencyDistribution.length).toBeGreaterThan(0);
        expect(data.haRisks.length).toBeGreaterThan(0);
        expect(data.rightsizingRecommendations.length).toBeGreaterThan(0);
    });

    it('should contain all 7 mandatory C-Level sections in the system prompt', () => {
        // La 2 es nueva: el barrido por familias de recursos. Las que le siguen
        // corrieron un numero.
        expect(EXECUTIVE_REPORT_SYSTEM_PROMPT).toContain('1. Resumen Ejecutivo y Diagnóstico Financiero C-Level');
        expect(EXECUTIVE_REPORT_SYSTEM_PROMPT).toContain('2. Barrido 360° por Familias de Recursos');
        expect(EXECUTIVE_REPORT_SYSTEM_PROMPT).toContain('3. Economía Unitaria y Eficiencia de Asignación (Showback / Chargeback)');
        expect(EXECUTIVE_REPORT_SYSTEM_PROMPT).toContain('4. Matriz de Ineficiencias y Fuga de Capital (Hard Waste & Rightsizing)');
        expect(EXECUTIVE_REPORT_SYSTEM_PROMPT).toContain('5. Optimización de Tarifas y Cobertura de Compromisos (Rate Optimization)');
        expect(EXECUTIVE_REPORT_SYSTEM_PROMPT).toContain('6. Riesgos Operacionales, Alta Disponibilidad y Gobernanza');
        expect(EXECUTIVE_REPORT_SYSTEM_PROMPT).toContain('7. Hoja de Ruta y Plan de Acción Priorizado (30 - 60 - 90 Días)');
        expect(EXECUTIVE_REPORT_SYSTEM_PROMPT).toContain('Cero Alucinación');
        expect(EXECUTIVE_REPORT_SYSTEM_PROMPT).toContain('Dato no disponible en este tenant');
        // La regla que impide que un colector caido se lea como "cero hallazgos".
        expect(EXECUTIVE_REPORT_SYSTEM_PROMPT).toContain('collectorStatus');
    });

    it('should build valid A4 paged media HTML document', async () => {
        const mockTenantId = 'demo-tenant-123';
        const data = await aggregateExecutiveTelemetry(mockTenantId, 'TENANT_ALL');
        const markdown = '## 1. Resumen Ejecutivo\nDiagnóstico de salud FinOps óptimo.';

        const html = buildExecutiveReportHtmlDocument(data, markdown);

        expect(html.toLowerCase()).toContain('<!doctype html>');
        expect(html).toContain('@page {');
        expect(html).toContain('size: A4 portrait;');
        expect(html).toContain('margin: 18mm 15mm 18mm 15mm;');
        expect(html).toContain('CSCloudSolutions · Reporte Ejecutivo FinOps');
        expect(html).toContain('$675.84');
        expect(html).toContain('Diagnóstico de salud FinOps óptimo.');

    });

    it('should include all hard waste categories in config', () => {
        expect(HARD_WASTE_CONFIG.unattachedDisks).toBeDefined();
        expect(HARD_WASTE_CONFIG.unusedIps).toBeDefined();
        expect(HARD_WASTE_CONFIG.staleSnapshots).toBeDefined();
        expect(HARD_WASTE_CONFIG.emptyAppServicePlans).toBeDefined();
        expect(HARD_WASTE_CONFIG.elasticPools).toBeDefined();
        expect(HARD_WASTE_CONFIG.orphanBackups).toBeDefined();
        expect(HARD_WASTE_CONFIG.expiredTtlResources).toBeDefined();
    });
});
