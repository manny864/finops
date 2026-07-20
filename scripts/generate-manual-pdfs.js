const { marked } = require('marked');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const MANUAL_DIR = path.join(process.cwd(), 'docs', 'manual');
// Los manuales de USUARIO se sirven a los clientes vía el ícono de ayuda del
// header (userManualHref en ClientShell -> /manual/MANUAL_USUARIO_<lang>.pdf),
// así que su copia final vive en public/manual. Los de SUPERADMIN no se sirven
// públicamente (public: false). `public: true` sincroniza el PDF a public/manual
// tras generarlo para que no se desincronice del de docs/manual.
const PUBLIC_MANUAL_DIR = path.join(process.cwd(), 'public', 'manual');

const FILES = [
  { md: 'MANUAL_USUARIO_ES.md', pdf: 'MANUAL_USUARIO_ES.pdf', lang: 'es', public: true },
  { md: 'MANUAL_USUARIO_EN.md', pdf: 'MANUAL_USUARIO_EN.pdf', lang: 'en', public: true },
  { md: 'MANUAL_USUARIO_PT-BR.md', pdf: 'MANUAL_USUARIO_PT-BR.pdf', lang: 'pt-BR', public: true },
  { md: 'MANUAL_SUPERADMIN_ES.md', pdf: 'MANUAL_SUPERADMIN_ES.pdf', lang: 'es', public: false },
  { md: 'MANUAL_SUPERADMIN_EN.md', pdf: 'MANUAL_SUPERADMIN_EN.pdf', lang: 'en', public: false },
  { md: 'MANUAL_SUPERADMIN_PT-BR.md', pdf: 'MANUAL_SUPERADMIN_PT-BR.pdf', lang: 'pt-BR', public: false },
];

function wrapHtml(bodyHtml, lang) {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 22mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1f2430;
    line-height: 1.55;
    font-size: 11.5px;
  }
  h1 { font-size: 22px; color: #0054A6; border-bottom: 3px solid #00AEEF; padding-bottom: 8px; margin-top: 0; }
  h2 { font-size: 17px; color: #0054A6; margin-top: 28px; border-bottom: 1px solid #c7e2f5; padding-bottom: 4px; page-break-after: avoid; }
  h3 { font-size: 13.5px; color: #333; margin-top: 18px; page-break-after: avoid; }
  h4 { font-size: 12px; color: #444; margin-top: 14px; page-break-after: avoid; }
  p { margin: 6px 0; }
  strong { color: #003a73; }
  a { color: #1E88E5; text-decoration: none; }
  code { background: #E6F2FB; color: #0054A6; padding: 1px 5px; border-radius: 3px; font-size: 10.5px; }
  pre { background: #0a2a4a; color: #E6F2FB; padding: 10px 14px; border-radius: 6px; overflow-x: auto; font-size: 10px; }
  pre code { background: none; color: inherit; padding: 0; }
  blockquote {
    border-left: 4px solid #f0ad4e;
    background: #fff8ec;
    margin: 10px 0;
    padding: 8px 14px;
    color: #6b4a12;
    font-size: 11px;
    page-break-inside: avoid;
  }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 10.5px; page-break-inside: avoid; }
  th, td { border: 1px solid #c7e2f5; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #0054A6; color: white; }
  tr:nth-child(even) { background: #f4f9fd; }
  hr { border: none; border-top: 1px solid #c7e2f5; margin: 20px 0; }
  ul, ol { margin: 6px 0; padding-left: 22px; }
  li { margin: 2px 0; }
  .cover {
    text-align: center;
    padding-top: 30%;
    page-break-after: always;
  }
  .cover .emoji { font-size: 64px; }
  .cover h1 { border: none; font-size: 30px; margin-top: 20px; }
  .cover p { color: #666; font-size: 13px; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

async function main() {
  const browser = await chromium.launch();
  for (const f of FILES) {
    const mdPath = path.join(MANUAL_DIR, f.md);
    if (!fs.existsSync(mdPath)) {
      console.log(`skip (missing): ${f.md}`);
      continue;
    }
    const md = fs.readFileSync(mdPath, 'utf-8');
    const bodyHtml = marked.parse(md);
    const html = wrapHtml(bodyHtml, f.lang);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdfPath = path.join(MANUAL_DIR, f.pdf);
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '22mm', bottom: '18mm', left: '18mm', right: '18mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="width:100%;font-size:8px;color:#999;text-align:center;padding-top:4px;">Página <span class="pageNumber"></span> de <span class="totalPages"></span> — FinOps SaaS CSCloudSolutions</div>',
    });
    await page.close();
    const size = (fs.statSync(pdfPath).size / 1024).toFixed(0);
    // Sincroniza la copia servida públicamente (ver nota en FILES).
    if (f.public) {
      fs.mkdirSync(PUBLIC_MANUAL_DIR, { recursive: true });
      fs.copyFileSync(pdfPath, path.join(PUBLIC_MANUAL_DIR, f.pdf));
      console.log(`OK: ${f.pdf} (${size} KB) -> docs/manual + public/manual`);
    } else {
      console.log(`OK: ${f.pdf} (${size} KB) -> docs/manual`);
    }
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
