/**
 * pdfReportTemplate.ts — Plantilla Maestra HTML para Compilación de PDF A4
 * con estilos CSS Paged Media, cabeceras/pies de página y formateo ejecutivo.
 */

export interface RenderPdfReportParams {
    organizationName: string;
    scopeDisplayName: string;
    generationDate: string;
    kpiGridHtml: string;
    parsedContentHtml: string;
}

export function renderPdfReportHtml(params: RenderPdfReportParams): string {
    const {
        organizationName,
        scopeDisplayName,
        generationDate,
        kpiGridHtml,
        parsedContentHtml,
    } = params;

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Reporte Ejecutivo FinOps · ${organizationName}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 18mm 15mm 18mm 15mm;
      @top-left {
        content: "${organizationName} · Reporte Ejecutivo FinOps";
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        font-size: 8pt;
        color: #64748b;
      }
      @top-right {
        content: "Generado: ${generationDate}";
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        font-size: 8pt;
        color: #64748b;
      }
      @bottom-left {
        content: "CSCloudSolutions FinOps SaaS · Confidencial";
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        font-size: 8pt;
        color: #64748b;
      }
      @bottom-right {
        content: "Página " counter(page) " de " counter(pages);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        font-size: 8pt;
        color: #64748b;
      }
    }

    /*
     * Marca de agua corporativa. El position fixed en Paged Media la repite en
     * TODAS las paginas; el alfa 0.035 la deja por debajo del umbral de lectura
     * para que no compita con el texto ni ensucie una impresion en blanco y
     * negro. pointer-events/user-select en none para que no se pueda
     * seleccionar ni copiar junto con el contenido.
     */
    .watermark {
      position: fixed;
      top: 45%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-30deg);
      font-size: 5rem;
      font-weight: 800;
      color: rgba(0, 84, 166, 0.035);
      pointer-events: none;
      z-index: 0;
      user-select: none;
      white-space: nowrap;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      line-height: 1.6;
      font-size: 9.5pt;
      margin: 0;
      padding: 0;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .header-cover {
      border-bottom: 2px solid #0078D4;
      padding-bottom: 12px;
      margin-bottom: 18px;
    }
    .header-title {
      font-size: 18pt;
      font-weight: 700;
      color: #0078D4;
      margin: 0 0 6px 0;
      font-family: 'Segoe UI', Helvetica, Arial, sans-serif;
    }
    .header-meta {
      font-size: 8.5pt;
      color: #475569;
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }

    /* KPI Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 6px;
      margin-bottom: 10px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .kpi-card {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 8px 10px;
      background: #ffffff;
    }
    .kpi-label {
      font-size: 7pt;
      text-transform: uppercase;
      font-weight: 700;
      color: #64748b;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .kpi-value {
      font-size: 11pt;
      font-weight: 700;
      color: #0078D4;
    }
    .kpi-subtext {
      font-size: 6.5pt;
      color: #64748b;
      margin-top: 1px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Section & Typography */
    h1.report-h1 {
      font-size: 14pt;
      font-weight: 700;
      color: #0078D4;
      margin-top: 18px;
      margin-bottom: 8px;
      page-break-after: avoid;
      break-after: avoid;
    }
    h2.report-h2 {
      font-size: 12pt;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
      margin-top: 16px;
      margin-bottom: 8px;
      page-break-after: avoid;
      break-after: avoid;
    }
    h3.report-h3 {
      font-size: 10pt;
      font-weight: 600;
      color: #1e293b;
      margin-top: 12px;
      margin-bottom: 6px;
      page-break-after: avoid;
      break-after: avoid;
    }
    h4.report-h4 {
      font-size: 9pt;
      font-weight: 600;
      color: #334155;
      margin-top: 8px;
      margin-bottom: 4px;
      page-break-after: avoid;
      break-after: avoid;
    }
    p {
      margin: 0 0 8px 0;
      text-align: justify;
    }

    /* Tables */
    .report-table-wrapper {
      margin: 10px 0 14px 0;
      page-break-inside: auto;
      break-inside: auto;
    }
    table.report-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8pt;
      text-align: left;
      page-break-inside: auto;
      break-inside: auto;
      border: 1px solid #e2e8f0;
    }
    table.report-table thead tr {
      background-color: #f1f5f9;
      border-bottom: 2px solid #cbd5e1;
      page-break-inside: avoid;
      page-break-after: avoid;
      break-inside: avoid;
      break-after: avoid;
    }
    table.report-table th {
      padding: 6px 8px;
      font-weight: 700;
      color: #1e293b;
      border: 1px solid #e2e8f0;
    }
    table.report-table td {
      padding: 6px 8px;
      border: 1px solid #e2e8f0;
      color: #334155;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    table.report-table tbody tr:nth-child(even) {
      background-color: #f8fafc;
    }

    /* Callouts & Highlights */
    .report-callout {
      background: #f0f9ff;
      border-left: 4px solid #0078D4;
      border-radius: 0 6px 6px 0;
      padding: 8px 12px;
      margin: 10px 0;
      font-size: 8.5pt;
      color: #0369a1;
      page-break-inside: avoid;
      break-inside: avoid;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .callout-icon {
      font-size: 10pt;
      line-height: 1;
    }
    .callout-content {
      flex: 1;
    }

    .report-ul, .report-ol {
      margin: 4px 0 10px 18px;
      padding: 0;
      font-size: 9pt;
      color: #334155;
    }
    .report-li {
      margin-bottom: 3px;
    }
    .report-code {
      background: #f1f5f9;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 8pt;
      font-family: monospace;
      color: #0f172a;
      border: 1px solid #e2e8f0;
    }

    .badge {
      display: inline-block;
      padding: 1px 5px;
      font-size: 7pt;
      font-weight: 700;
      border-radius: 3px;
    }
    .badge-blue {
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
    }

    .page-break-avoid {
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .footer-doc {
      margin-top: 24px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
      font-size: 7.5pt;
      color: #94a3b8;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="watermark" aria-hidden="true">CSCloudSolutions</div>
  <div class="header-cover">
    <div class="header-title">CSCloudSolutions · Reporte Ejecutivo FinOps</div>
    <div class="header-meta">
      <div><strong>Tenant:</strong> ${organizationName}</div>
      <div><strong>Alcance:</strong> ${scopeDisplayName}</div>
      <div><strong>Fecha:</strong> ${generationDate}</div>
    </div>
  </div>

  <!-- Grid de 10 KPIs ejecutivos -->
  ${kpiGridHtml}

  <!-- Contenido parseado de las 6 secciones -->
  <div class="report-content">
    ${parsedContentHtml}
  </div>

  <div class="footer-doc">
    CSCloudSolutions FinOps Management Platform · Documento confidencial para directivos del tenant ${organizationName}.
  </div>
</body>
</html>`;
}
