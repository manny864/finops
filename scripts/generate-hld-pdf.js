/**
 * Genera el PDF del documento HLD con la marca CSCloudSolutions.
 *
 * Usa el mismo pipeline que generate-lld-pdf.js (Playwright + marked),
 * con portada, marca de agua, colores corporativos y tipografía Montserrat.
 *
 * Uso:
 *   node scripts/generate-hld-pdf.js
 *
 * Output:
 *   docs/hld/HLD-FinOps-CSCloudSolutions.pdf
 */
const { marked } = require('marked');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HLD_MD = path.join(process.cwd(), 'docs', 'hld', '00-hld-completo.md');
const OUTPUT_PDF = path.join(process.cwd(), 'docs', 'hld', 'HLD-FinOps-CSCloudSolutions.pdf');

const LOGO_DATA_URI = 'data:image/png;base64,' +
  fs.readFileSync(path.join(process.cwd(), 'public', 'CSCloudSolutions.png')).toString('base64');

const COPYRIGHT = '© 2026 CSCloudSolutions. Todos los derechos reservados. — CONFIDENCIAL';

/**
 * Renderiza bloques ```mermaid como SVG inline vía mermaid.js CDN.
 * Playwright lo ejecuta en el contexto del navegador.
 */
function preprocessMermaid(html) {
  return html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    (_, code) => {
      const decoded = code
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      return `<pre class="mermaid">${decoded}</pre>`;
    }
  );
}

function buildCoverHtml() {
  const today = new Date().toISOString().slice(0, 10);
  return `
<div class="cover">
  <img src="${LOGO_DATA_URI}" class="cover-logo" alt="CSCloudSolutions" />
  <h1 class="cover-title">High-Level Design</h1>
  <p class="cover-sub">Plataforma FinOps SaaS — Azure-Only</p>
  <p class="cover-meta">Versión 1.0 — ${today}</p>
  <p class="cover-meta" style="margin-top:12px;">
    <strong>CSCloudSolutions</strong><br/>
    Cloud Solutions & FinOps Consulting
  </p>
  <div class="cover-badges">
    <span class="badge">Azure-Only</span>
    <span class="badge">Multi-Tenant</span>
    <span class="badge">Next.js 16</span>
    <span class="badge">Terraform</span>
    <span class="badge">HLD Architecture</span>
  </div>
  <p class="cover-copyright">${COPYRIGHT}</p>
</div>`;
}

function wrapHtml(bodyHtml) {
  const cover = buildCoverHtml();
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>
<script>
  document.addEventListener('DOMContentLoaded', function() {
    mermaid.initialize({
      startOnLoad: true,
      theme: 'base',
      themeVariables: {
        primaryColor: '#E6F2FB',
        primaryBorderColor: '#0054A6',
        primaryTextColor: '#1f2430',
        lineColor: '#00AEEF',
        secondaryColor: '#f4f9fd',
        tertiaryColor: '#fff',
        fontFamily: 'Open Sans, sans-serif',
        fontSize: '12px'
      },
      flowchart: { curve: 'basis', htmlLabels: true },
      sequence: { mirrorActors: false }
    });
  });
<\/script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Open+Sans:wght@400;600&family=JetBrains+Mono:wght@400;500&display=swap');

  @page { size: A4; margin: 24mm 18mm 20mm 18mm; }
  * { box-sizing: border-box; }

  :root {
    --azul-oscuro: #0054A6;
    --azul-profundo: #1E3A8A;
    --celeste: #00AEEF;
    --celeste-claro: #90CAF9;
    --gris-oscuro: #3C3C3C;
    --gris-medio: #7F7F7F;
    --fondo-claro: #f4f9fd;
    --borde-azul: #c7e2f5;
    --accent-warn: #f0ad4e;
    --accent-success: #27ae60;
    --accent-danger: #e74c3c;
  }

  body {
    font-family: 'Open Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1f2430;
    line-height: 1.6;
    font-size: 10.5px;
  }

  /* --- Headings --- */
  h1 {
    font-family: 'Montserrat', sans-serif;
    font-weight: 800;
    font-size: 22px;
    color: var(--azul-oscuro);
    border-bottom: 3px solid var(--celeste);
    padding-bottom: 8px;
    margin-top: 0;
    letter-spacing: -0.3px;
  }
  h2 {
    font-family: 'Montserrat', sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: var(--azul-oscuro);
    margin-top: 28px;
    border-bottom: 2px solid var(--celeste);
    padding-bottom: 5px;
    page-break-after: avoid;
    letter-spacing: -0.2px;
  }
  h3 {
    font-family: 'Montserrat', sans-serif;
    font-weight: 600;
    font-size: 13px;
    color: var(--azul-profundo);
    margin-top: 20px;
    page-break-after: avoid;
  }
  h4 {
    font-family: 'Montserrat', sans-serif;
    font-weight: 600;
    font-size: 11.5px;
    color: #444;
    margin-top: 14px;
    page-break-after: avoid;
  }

  p { margin: 6px 0; }
  strong { color: #003a73; }
  a { color: #1E88E5; text-decoration: none; }

  /* --- Code --- */
  code {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    background: #E6F2FB;
    color: var(--azul-oscuro);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 9.5px;
  }
  pre {
    background: linear-gradient(135deg, #0a2a4a 0%, #0d3d6b 100%);
    color: #E6F2FB;
    padding: 12px 16px;
    border-radius: 8px;
    overflow-x: auto;
    font-size: 9.5px;
    border-left: 4px solid var(--celeste);
    page-break-inside: avoid;
  }
  pre code { background: none; color: inherit; padding: 0; }

  /* --- Mermaid (rendered as SVG by mermaid.js) --- */
  pre.mermaid {
    background: white;
    border: 1px solid var(--borde-azul);
    border-left: 4px solid var(--celeste);
    border-radius: 0 8px 8px 0;
    color: #333;
    text-align: center;
    padding: 20px 16px;
    page-break-inside: avoid;
    overflow-x: auto;
  }
  pre.mermaid svg {
    max-width: 100%;
    height: auto;
  }

  /* --- Blockquotes / Alerts --- */
  blockquote {
    border-left: 4px solid var(--accent-warn);
    background: #fff8ec;
    margin: 10px 0;
    padding: 8px 14px;
    color: #6b4a12;
    font-size: 10px;
    border-radius: 0 6px 6px 0;
    page-break-inside: avoid;
  }
  blockquote:has(> p:first-child > strong:first-child) {
    border-radius: 0 6px 6px 0;
  }

  /* --- Tables --- */
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 10px 0;
    font-size: 9.5px;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid var(--borde-azul);
    padding: 5px 8px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: linear-gradient(135deg, var(--azul-oscuro) 0%, var(--azul-profundo) 100%);
    color: white;
    font-family: 'Montserrat', sans-serif;
    font-weight: 600;
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  tr:nth-child(even) { background: var(--fondo-claro); }
  tr:hover { background: #e8f4fd; }

  /* --- Lists --- */
  ul, ol { margin: 6px 0; padding-left: 22px; }
  li { margin: 2px 0; }

  hr { border: none; border-top: 2px solid var(--borde-azul); margin: 24px 0; }

  /* --- Cover page --- */
  .cover {
    text-align: center;
    padding-top: 16%;
    page-break-after: always;
    background: linear-gradient(180deg, #ffffff 0%, #f0f7ff 60%, #e0eef9 100%);
    margin: -24mm -18mm 0 -18mm;
    padding-left: 18mm;
    padding-right: 18mm;
    padding-bottom: 40mm;
  }
  .cover-logo {
    width: 320px;
    max-width: 65%;
    height: auto;
    display: block;
    margin: 0 auto 32px;
    filter: drop-shadow(0 4px 12px rgba(0,84,166,0.15));
  }
  .cover-title {
    border: none !important;
    font-family: 'Montserrat', sans-serif;
    font-size: 36px;
    font-weight: 800;
    color: var(--azul-oscuro);
    margin: 0 0 8px;
    letter-spacing: -1px;
    text-shadow: 0 2px 4px rgba(0,84,166,0.08);
  }
  .cover-sub {
    color: var(--celeste);
    font-family: 'Montserrat', sans-serif;
    font-size: 16px;
    font-weight: 600;
    margin: 6px 0;
  }
  .cover-meta {
    color: var(--gris-medio);
    font-size: 12px;
    margin: 6px 0;
    line-height: 1.5;
  }
  .cover-badges {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin-top: 24px;
    flex-wrap: wrap;
  }
  .badge {
    display: inline-block;
    background: linear-gradient(135deg, var(--azul-oscuro) 0%, var(--celeste) 100%);
    color: white;
    font-family: 'Montserrat', sans-serif;
    font-weight: 600;
    font-size: 10px;
    padding: 4px 14px;
    border-radius: 20px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
  }
  .cover-copyright {
    color: #aaa;
    font-size: 10px;
    margin-top: 50px;
  }

  /* --- Watermark --- */
  .watermark {
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    z-index: -1;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .watermark img { width: 65%; opacity: 0.03; transform: rotate(-35deg); }

  /* --- Section dividers --- */
  hr + h2 { margin-top: 16px; }

  /* --- Print optimizations --- */
  h2, h3, h4 { page-break-after: avoid; }
  table, pre, blockquote { page-break-inside: avoid; }

  .emoji { font-size: 12px; }
</style>
</head>
<body>
<div class="watermark"><img src="${LOGO_DATA_URI}" alt="" /></div>
${cover}
${bodyHtml}
</body>
</html>`;
}

async function main() {
  if (!fs.existsSync(HLD_MD)) {
    console.error(`No se encontró: ${HLD_MD}`);
    process.exit(1);
  }

  const md = fs.readFileSync(HLD_MD, 'utf-8');
  let bodyHtml = marked.parse(md);

  bodyHtml = bodyHtml.replace(
    /src="[^"]*CSCloudSolutions\.png"/g,
    `src="${LOGO_DATA_URI}"`
  );

  bodyHtml = preprocessMermaid(bodyHtml);

  bodyHtml = bodyHtml.replace(
    /<a href="file:\/\/\/[^"]*">(.*?)<\/a>/g,
    '<code>$1</code>'
  );

  const html = wrapHtml(bodyHtml);

  console.log('Lanzando Playwright para generar HLD PDF...');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setContent(html, { waitUntil: 'networkidle' });

  const diagramCount = await page.locator('pre.mermaid').count();
  if (diagramCount > 0) {
    console.log(`Renderizando ${diagramCount} diagramas Mermaid...`);
    await page.waitForFunction(
      (expected) => {
        const processed = document.querySelectorAll('pre.mermaid[data-processed="true"]');
        return processed.length >= expected;
      },
      diagramCount,
      { timeout: 20000 }
    );
    console.log('Diagramas renderizados OK.');
  }

  await page.pdf({
    path: OUTPUT_PDF,
    format: 'A4',
    printBackground: true,
    margin: { top: '24mm', bottom: '20mm', left: '18mm', right: '18mm' },
    displayHeaderFooter: true,
    headerTemplate: `
      <div style="width:100%;font-size:7px;color:#999;display:flex;justify-content:space-between;padding:0 18mm;">
        <span style="font-family:Montserrat,sans-serif;font-weight:600;color:#0054A6;">CSCloudSolutions</span>
        <span>High-Level Design — FinOps Platform</span>
      </div>`,
    footerTemplate: `
      <div style="width:100%;font-size:7.5px;color:#999;display:flex;justify-content:space-between;padding:0 18mm;">
        <span>${COPYRIGHT}</span>
        <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
      </div>`,
  });

  await page.close();
  await browser.close();

  const size = (fs.statSync(OUTPUT_PDF).size / 1024).toFixed(0);
  console.log(`✅ PDF generado exitosamente: ${OUTPUT_PDF} (${size} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
