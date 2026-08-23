/**
 * reportHtmlTransformer.ts — Pipeline de transformación de Markdown a HTML Semántico Estructurado
 * para Reportes Ejecutivos FinOps.
 *
 * Transforma sintaxis Markdown (GFM, tablas con pipes, viñetas, blockquotes) en HTML semántico
 * con clases CSS corporativas (#0078D4 / #0F172A), zebra striping y callouts estilizados.
 */
import { marked } from 'marked';

// Configurar marked con soporte GFM completo
marked.setOptions({
    gfm: true,
    breaks: true,
});

/**
 * Parsea el contenido Markdown generado por la IA a HTML semántico estilizado.
 */
export function parseExecutiveMarkdownToHtml(markdownText: string): string {
    if (!markdownText || typeof markdownText !== 'string') {
        return '<p class="text-slate-400">No hay contenido de análisis disponible.</p>';
    }

    // Normalizar saltos y formatear callouts
    let cleanMarkdown = markdownText.trim();

    // Reemplazar bloques de callout `> [!NOTE]` o `> [!WARNING]` si existieran
    cleanMarkdown = cleanMarkdown.replace(/^>\s*\[!NOTE\]\s*(.*)$/gim, '> ℹ️ **Nota:** $1');
    cleanMarkdown = cleanMarkdown.replace(/^>\s*\[!WARNING\]\s*(.*)$/gim, '> ⚠️ **Advertencia:** $1');
    cleanMarkdown = cleanMarkdown.replace(/^>\s*\[!IMPORTANT\]\s*(.*)$/gim, '> ⚡ **Importante:** $1');

    const renderer = new marked.Renderer();

    // Renderizado de Tablas con wrapper responsivo y clases corporativas
    renderer.table = function ({ header, rows }) {
        let headerHtml = '';
        if (header) {
            const cells = header.map((cell) => `<th>${cell.text}</th>`).join('');
            headerHtml = `<thead><tr>${cells}</tr></thead>`;
        }

        let bodyHtml = '';
        if (rows && rows.length > 0) {
            const rowsHtml = rows
                .map((row) => {
                    const cells = row.map((cell) => `<td>${cell.text}</td>`).join('');
                    return `<tr>${cells}</tr>`;
                })
                .join('');
            bodyHtml = `<tbody>${rowsHtml}</tbody>`;
        }

        return `<div class="report-table-wrapper"><table class="report-table">${headerHtml}${bodyHtml}</table></div>`;
    };

    // Renderizado de Blockquotes como Callouts ejecutivos
    renderer.blockquote = function ({ text }) {
        return `<div class="report-callout"><div class="callout-icon">ℹ️</div><div class="callout-content">${text}</div></div>`;
    };

    // Renderizado de Encabezados H1, H2, H3
    renderer.heading = function ({ text, depth }) {
        if (depth === 1) {
            return `<h1 class="report-h1">${text}</h1>`;
        } else if (depth === 2) {
            return `<h2 class="report-h2">${text}</h2>`;
        } else if (depth === 3) {
            return `<h3 class="report-h3">${text}</h3>`;
        }
        return `<h4 class="report-h4">${text}</h4>`;
    };

    // Renderizado de Listas
    renderer.list = function ({ ordered, items }) {
        const tag = ordered ? 'ol' : 'ul';
        const cls = ordered ? 'report-ol' : 'report-ul';
        const itemsHtml = items.map((it) => `<li class="report-li">${it.text}</li>`).join('');
        return `<${tag} class="${cls}">${itemsHtml}</${tag}>`;
    };

    // Renderizado de código en línea y badges
    renderer.codespan = function ({ text }) {
        return `<code class="report-code">${text}</code>`;
    };

    const parsed = marked.parse(cleanMarkdown, { renderer }) as string;
    return parsed;
}

/**
 * Genera el marcado HTML para el Grid de 10 KPIs de Salud FinOps en el PDF.
 */
export function compileKpiGridHtml(kpiMetrics: {
    mtdSpendUSD: number;
    momVariationPercent: number;
    projectedMonthEndUSD: number;
    monthlySavingsIdentifiedUSD: number;
    annualizedSavingsUSD: number;
    criticalHighHaRisksCount: number;
    co2ImpactKg: number;
    taggingCoveragePercent: number;
    commitmentsCoveragePercent: number;
    rightsizingCandidatesCount: number;
    rightsizingSavingsUSD: number;
    activeAnomaliesCount: number;
    budgetBurnPercent: number;
}): string {
    const fmt = (n: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

    const mtdDelta = `${kpiMetrics.momVariationPercent > 0 ? '+' : ''}${kpiMetrics.momVariationPercent.toFixed(1)}%`;

    return `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Gasto MTD</div>
        <div class="kpi-value">${fmt(kpiMetrics.mtdSpendUSD)}</div>
        <div class="kpi-subtext">vs Mes Ant: ${mtdDelta}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Proyección Fin de Mes</div>
        <div class="kpi-value" style="color: #2563EB;">${fmt(kpiMetrics.projectedMonthEndUSD)}</div>
        <div class="kpi-subtext">Basado en run-rate</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Ahorro Mensual Remediable</div>
        <div class="kpi-value" style="color: #0284C7;">${fmt(kpiMetrics.monthlySavingsIdentifiedUSD)}</div>
        <div class="kpi-subtext">Anual: ${fmt(kpiMetrics.annualizedSavingsUSD)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Riesgos HA Críticos/Altos</div>
        <div class="kpi-value">${kpiMetrics.criticalHighHaRisksCount}</div>
        <div class="kpi-subtext">Sin zona o backup</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Impacto CO2</div>
        <div class="kpi-value" style="color: #2563EB;">${kpiMetrics.co2ImpactKg} kg</div>
        <div class="kpi-subtext">Emisiones de carbono</div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Cobertura de Tags</div>
        <div class="kpi-value">${kpiMetrics.taggingCoveragePercent.toFixed(0)}%</div>
        <div class="kpi-subtext">Etiquetas FinOps</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Compromisos (RI / Savings)</div>
        <div class="kpi-value" style="color: #2563EB;">${kpiMetrics.commitmentsCoveragePercent.toFixed(0)}%</div>
        <div class="kpi-subtext">Cobertura de tasa</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Rightsizing Candidatos</div>
        <div class="kpi-value" style="color: #0284C7;">${kpiMetrics.rightsizingCandidatesCount}</div>
        <div class="kpi-subtext">${fmt(kpiMetrics.rightsizingSavingsUSD)}/mes</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Anomalías Detectadas</div>
        <div class="kpi-value">${kpiMetrics.activeAnomaliesCount}</div>
        <div class="kpi-subtext">Alertas de costo</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Consumo Presupuesto</div>
        <div class="kpi-value" style="color: #2563EB;">${kpiMetrics.budgetBurnPercent.toFixed(0)}%</div>
        <div class="kpi-subtext">Ejecución del mes</div>
      </div>
    </div>
    `;
}
