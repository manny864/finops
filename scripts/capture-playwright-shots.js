const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(process.cwd(), 'public', 'video-assets');
fs.mkdirSync(outputDir, { recursive: true });

async function main() {
  console.log('Iniciando captura de imágenes HD para el video corporativo HyperFrames...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const targets = [
    {
      name: '01_dashboard_kpis',
      url: 'https://finops.cscloudsolutions.com.ar/es/demo',
      waitSelector: 'main',
    },
    {
      name: '02_cost_by_category',
      url: 'https://finops.cscloudsolutions.com.ar/es/intelligence/cost-by-category',
      waitSelector: 'main',
    },
    {
      name: '03_anomalies_detection',
      url: 'https://finops.cscloudsolutions.com.ar/es/intelligence/anomalies',
      waitSelector: 'main',
    },
    {
      name: '04_governance_score',
      url: 'https://finops.cscloudsolutions.com.ar/es/governance/reporting',
      waitSelector: 'main',
    },
  ];

  for (const t of targets) {
    console.log(`Capturando ${t.name} desde ${t.url}...`);
    try {
      await page.goto(t.url, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(2000); // Esperar renderizado de gráficos Recharts
      const dest = path.join(outputDir, `${t.name}.png`);
      await page.screenshot({ path: dest, fullPage: false });
      console.log(`✅ Capturado: ${dest}`);
    } catch (err) {
      console.error(`Error al capturar ${t.name}:`, err.message);
    }
  }

  await browser.close();
  console.log('Todas las capturas HD listas en public/video-assets/');
}

main().catch(console.error);
