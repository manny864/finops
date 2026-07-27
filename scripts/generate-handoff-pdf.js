const { marked } = require('marked');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SOURCE_MD = path.join(process.cwd(), 'docs', 'aws-multicloud-handoff.md');
const OUTPUT_PDF = path.join(process.cwd(), 'docs', 'aws-multicloud-handoff.pdf');

const LOGO_PATH = path.join(process.cwd(), 'public', 'CSCloudSolutions.png');
const LOGO_DATA_URI = fs.existsSync(LOGO_PATH)
  ? `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`
  : '';

function wrapHtml(bodyHtml) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 22mm 18mm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1f2430;
      line-height: 1.52;
      font-size: 11px;
    }
    h1 { font-size: 22px; color: #0054A6; border-bottom: 3px solid #00AEEF; padding-bottom: 8px; margin-top: 0; }
    h2 { font-size: 16px; color: #0054A6; margin-top: 24px; border-bottom: 1px solid #c7e2f5; padding-bottom: 4px; page-break-after: avoid; }
    h3 { font-size: 13px; color: #333; margin-top: 16px; page-break-after: avoid; }
    p { margin: 6px 0; }
    ul, ol { margin: 6px 0; padding-left: 20px; }
    li { margin: 2px 0; }
    blockquote {
      border-left: 4px solid #f0ad4e;
      background: #fff8ec;
      margin: 10px 0;
      padding: 8px 14px;
      color: #6b4a12;
      page-break-inside: avoid;
    }
    code { background: #E6F2FB; color: #0054A6; padding: 1px 5px; border-radius: 3px; font-size: 10px; }
    pre { background: #0a2a4a; color: #E6F2FB; padding: 10px 14px; border-radius: 6px; overflow-x: auto; font-size: 10px; }
    pre code { background: none; color: inherit; padding: 0; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 10px; page-break-inside: avoid; }
    th, td { border: 1px solid #c7e2f5; padding: 5px 8px; text-align: left; vertical-align: top; }
    th { background: #0054A6; color: white; }
    tr:nth-child(even) { background: #f4f9fd; }
    .wm {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: -1;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }
    .wm img { width: 70%; opacity: 0.05; transform: rotate(-45deg); }
  </style>
</head>
<body>
  ${LOGO_DATA_URI ? `<div class="wm"><img src="${LOGO_DATA_URI}" alt="" /></div>` : ''}
  ${bodyHtml}
</body>
</html>`;
}

async function main() {
  if (!fs.existsSync(SOURCE_MD)) {
    throw new Error(`No existe ${SOURCE_MD}`);
  }

  const md = fs.readFileSync(SOURCE_MD, 'utf-8');
  const bodyHtml = marked.parse(md);
  const html = wrapHtml(bodyHtml);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.pdf({
    path: OUTPUT_PDF,
    format: 'A4',
    printBackground: true,
    margin: { top: '22mm', bottom: '18mm', left: '18mm', right: '18mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="width:100%;font-size:8px;color:#999;text-align:center;padding-top:4px;">© 2026 CSCloudSolutions. Documento interno. — Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>',
  });
  await page.close();
  await browser.close();

  const sizeKb = (fs.statSync(OUTPUT_PDF).size / 1024).toFixed(0);
  console.log(`OK: aws-multicloud-handoff.pdf (${sizeKb} KB)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
