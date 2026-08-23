/**
 * pdfCompiler.service.ts — Motor de Compilación de Documentos PDF A4
 * con Playwright Chromium y soporte de CSS Paged Media.
 */
import { jsPDF } from 'jspdf';
import {
    parseExecutiveMarkdownToHtml,
    compileKpiGridHtml,
} from '@/lib/reports/reportHtmlTransformer';
import {
    renderPdfReportHtml,
} from '@/lib/reports/templates/pdfReportTemplate';
import type { ExecutiveReportFullData } from '@/types/executiveReport.types';

/**
 * Compila un buffer PDF A4 de alta fidelidad a partir de la estructura del reporte.
 */
export async function compileExecutiveReportPdfBuffer(
    data: ExecutiveReportFullData,
    markdownText?: string
): Promise<Buffer> {
    const rawMarkdown = markdownText || data.aiMarkdown || '';
    const parsedHtml = parseExecutiveMarkdownToHtml(rawMarkdown);
    const kpiGridHtml = compileKpiGridHtml(data.kpiMetrics);

    const fullHtml = renderPdfReportHtml({
        organizationName: data.organizationName || 'Organización',
        scopeDisplayName: data.scopeDisplayName || 'Tenant completo',
        generationDate: new Date(data.generatedAtIso || Date.now()).toLocaleString('es-AR'),
        kpiGridHtml,
        parsedContentHtml: parsedHtml,
    });

    return compileHtmlToPdfBuffer(fullHtml, data, rawMarkdown);
}

/**
 * Compila HTML a PDF Buffer utilizando Playwright si está disponible,
 * o un generador estructurado de respaldo (jsPDF).
 */
export async function compileHtmlToPdfBuffer(
    htmlContent: string,
    reportData?: ExecutiveReportFullData,
    rawMarkdown?: string
): Promise<Buffer> {
    try {
        // Intentar compilar con Playwright Chromium
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });

        try {
            const page = await browser.newPage();
            await page.setContent(htmlContent, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const pdfUint8 = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: { top: '18mm', bottom: '18mm', left: '15mm', right: '15mm' },
                preferCSSPageSize: true,
            });
            return Buffer.from(pdfUint8);
        } finally {
            await browser.close();
        }
    } catch (playwrightError) {
        console.warn(
            '[pdfCompiler.service] Playwright PDF compilation failed, using fallback engine:',
            playwrightError instanceof Error ? playwrightError.message : playwrightError
        );

        return compileFallbackJsPdfBuffer(reportData, rawMarkdown);
    }
}

/**
 * Generador PDF estructurado de respaldo con jsPDF.
 */
function compileFallbackJsPdfBuffer(
    data?: ExecutiveReportFullData,
    rawMarkdown?: string
): Buffer {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const orgName = data?.organizationName || 'CSCloudSolutions';
    const scopeName = data?.scopeDisplayName || 'Tenant completo';
    const dateStr = new Date(data?.generatedAtIso || Date.now()).toLocaleString('es-AR');

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(0, 84, 166);
    doc.text('CSCloudSolutions · Reporte Ejecutivo FinOps', 18, 18);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`Organización: ${orgName} | Alcance: ${scopeName} | Fecha: ${dateStr}`, 18, 25);

    // Línea divisoria
    doc.setDrawColor(0, 120, 212);
    doc.setLineWidth(0.5);
    doc.line(18, 28, 192, 28);

    // KPI Summary Box
    if (data?.kpiMetrics) {
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(18, 32, 174, 22, 2, 2, 'F');
        doc.setDrawColor(203, 213, 225);
        doc.roundedRect(18, 32, 174, 22, 2, 2, 'S');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text('GASTO MTD', 24, 38);
        doc.text('PROYECCIÓN MES', 68, 38);
        doc.text('AHORRO DETECTADO', 114, 38);
        doc.text('RIESGOS HA', 160, 38);

        doc.setFontSize(11);
        doc.setTextColor(0, 84, 166);
        doc.text(`$${data.kpiMetrics.mtdSpendUSD.toFixed(2)}`, 24, 46);
        doc.text(`$${data.kpiMetrics.projectedMonthEndUSD.toFixed(2)}`, 68, 46);
        doc.text(`$${data.kpiMetrics.monthlySavingsIdentifiedUSD.toFixed(2)}`, 114, 46);
        doc.text(`${data.kpiMetrics.criticalHighHaRisksCount}`, 160, 46);
    }

    // Body Text
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);

    const bodyText = (rawMarkdown || data?.aiMarkdown || '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim();

    const lines = doc.splitTextToSize(bodyText, 174);
    let y = 62;

    for (const line of lines) {
        if (y > 275) {
            doc.addPage('a4', 'portrait');
            y = 20;
        }
        doc.text(line, 18, y);
        y += 5.5;
    }

    return Buffer.from(doc.output('arraybuffer'));
}
