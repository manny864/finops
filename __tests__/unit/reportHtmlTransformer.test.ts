import { describe, it, expect } from 'vitest';
import {
    parseExecutiveMarkdownToHtml,
    compileKpiGridHtml,
} from '@/lib/reports/reportHtmlTransformer';
import { renderPdfReportHtml } from '@/lib/reports/templates/pdfReportTemplate';
import { renderEmailReportHtml } from '@/lib/reports/templates/emailReportTemplate';

describe('reportHtmlTransformer — Markdown to Semantic HTML Pipeline', () => {
    it('debe transformar encabezados markdown en clases semánticas de reporte', () => {
        const md = '# 1. Título Principal\n## 2. Sección Ejecutiva\n### 3. Subsección Detalle';
        const html = parseExecutiveMarkdownToHtml(md);

        expect(html).toContain('<h1 class="report-h1">1. Título Principal</h1>');
        expect(html).toContain('<h2 class="report-h2">2. Sección Ejecutiva</h2>');
        expect(html).toContain('<h3 class="report-h3">3. Subsección Detalle</h3>');
    });

    it('debe transformar tablas GFM con pipes en tablas semánticas con wrapper responsivo', () => {
        const md = `
| Métrica | Valor MTD | Proyección |
| :--- | :--- | :--- |
| Gasto Azure | $675.84 | $936.37 |
| Ahorro Potencial | $9,930.00 | $119,160.00 |
`;
        const html = parseExecutiveMarkdownToHtml(md);

        expect(html).toContain('<div class="report-table-wrapper">');
        expect(html).toContain('<table class="report-table">');
        expect(html).toContain('<th>Métrica</th>');
        expect(html).toContain('<th>Valor MTD</th>');
        expect(html).toContain('<td>Gasto Azure</td>');
        expect(html).toContain('<td>$675.84</td>');
    });

    it('debe transformar blockquotes en callouts ejecutivos con icono informativo', () => {
        const md = '> Esta es una advertencia de costo crítico sobre discos huérfanos.';
        const html = parseExecutiveMarkdownToHtml(md);

        expect(html).toContain('<div class="report-callout">');
        expect(html).toContain('<div class="callout-icon">ℹ️</div>');
        expect(html).toContain('Esta es una advertencia de costo crítico sobre discos huérfanos.');
    });

    it('debe transformar listas desordenadas y ordenadas en elementos con clases CSS', () => {
        const md = '- Optimizar Storage Accounts\n- Desasignar VMs inactivas\n- Migrar a Reservations';
        const html = parseExecutiveMarkdownToHtml(md);

        expect(html).toContain('<ul class="report-ul">');
        expect(html).toContain('<li class="report-li">Optimizar Storage Accounts</li>');
        expect(html).toContain('<li class="report-li">Desasignar VMs inactivas</li>');
    });

    it('debe compilar el grid de 10 KPIs ejecutivos con formato monetario y colores corporativos', () => {
        const gridHtml = compileKpiGridHtml({
            mtdSpendUSD: 675.84,
            momVariationPercent: 12.4,
            projectedMonthEndUSD: 936.37,
            monthlySavingsIdentifiedUSD: 9930.0,
            annualizedSavingsUSD: 119160.0,
            criticalHighHaRisksCount: 45,
            co2ImpactKg: 142.5,
            taggingCoveragePercent: 47,
            commitmentsCoveragePercent: 0,
            rightsizingCandidatesCount: 6,
            rightsizingSavingsUSD: 1113.5,
            activeAnomaliesCount: 3,
            budgetBurnPercent: 68.5,
        });

        expect(gridHtml).toContain('$675.84');
        expect(gridHtml).toContain('$936.37');
        expect(gridHtml).toContain('$9,930.00');
        expect(gridHtml).toContain('45');
        expect(gridHtml).toContain('142.5 kg');
        expect(gridHtml).toContain('47%');
    });

    it('debe renderizar el documento PDF A4 completo con metadatos y CSS Paged Media', () => {
        const fullHtml = renderPdfReportHtml({
            organizationName: 'Acme Corp',
            scopeDisplayName: 'Production Subscription',
            generationDate: '22/08/2026 22:00',
            kpiGridHtml: '<div class="kpi-grid-mock">KPIs</div>',
            parsedContentHtml: '<h2 class="report-h2">Resumen</h2><p>Contenido analítico</p>',
        });

        expect(fullHtml).toContain('<!DOCTYPE html>');
        expect(fullHtml).toContain('@page {');
        expect(fullHtml).toContain('size: A4 portrait;');
        expect(fullHtml).toContain('Acme Corp');
        expect(fullHtml).toContain('Production Subscription');
        expect(fullHtml).toContain('CSCloudSolutions FinOps SaaS · Confidencial');
    });

    it('debe renderizar la plantilla de correo electrónico con estilos inlined y 4 KPIs destacados', () => {
        const emailHtml = renderEmailReportHtml({
            tenantName: 'Acme Corp',
            scopeDisplayName: 'Tenant completo',
            generationDate: '22/08/2026 22:00',
            kpiHighlights: [
                { label: 'Gasto MTD', value: '$675.84', color: '#0054A6' },
                { label: 'Proyección Mes', value: '$936.37', color: '#2563EB' },
                { label: 'Ahorro Remediable', value: '$9,930.00/m', color: '#0284C7' },
                { label: 'Riesgos HA', value: '45', color: '#0054A6' },
            ],
            parsedContentHtml: '<p>Resumen ejecutivo</p>',
            reportUrl: 'https://finops.cscloudsolutions.com.ar/es/admin/reports?tab=executive',
        });

        expect(emailHtml).toContain('<!DOCTYPE html PUBLIC');
        expect(emailHtml).toContain('CSCloudSolutions <span style="font-weight: 400; opacity: 0.85;">· FinOps SaaS</span>');
        expect(emailHtml).toContain('Acme Corp');
        expect(emailHtml).toContain('$675.84');
        expect(emailHtml).toContain('$9,930.00/m');
        expect(emailHtml).toContain('Ver Reporte Completo en la Plataforma →');
    });
});
