const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(process.cwd(), '.tmp', 'saas_shots');
fs.mkdirSync(outputDir, { recursive: true });

const pages = [
  { name: '01_dashboard', url: 'https://finops.cscloudsolutions.com.ar/es/overview/whiteboard' },
  { name: '02_cost_groups', url: 'https://finops.cscloudsolutions.com.ar/es/intelligence/cost-groups' },
  { name: '03_anomalies', url: 'https://finops.cscloudsolutions.com.ar/es/intelligence/anomalies' },
  { name: '04_governance', url: 'https://finops.cscloudsolutions.com.ar/es/governance/reporting' },
];

console.log('Capturando pantallas de la app logueada en Chrome...');

for (const p of pages) {
  console.log(`Navegando a ${p.url}...`);
  const appleScript = `
    tell application "Google Chrome"
      activate
      repeat with w in windows
        set tabIndex to 1
        repeat with t in tabs of w
          if title of t contains "FinOps" or title of t contains "CSCloud" or URL of t contains "finops.cscloudsolutions" then
            set active tab index of w to tabIndex
            set index of w to 1
            set URL of t to "${p.url}"
            return "OK"
          end if
          set tabIndex to tabIndex + 1
        end repeat
      end repeat
    end tell
  `;
  try {
    execSync(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`);
  } catch (err) {
    console.error(`Error navegando a ${p.url}:`, err.message);
  }

  // Esperar a que cargue la página
  execSync('sleep 3');

  // Capturar pantalla de la ventana de Chrome
  const targetPath = path.join(outputDir, `${p.name}.png`);
  // Captura la ventana frontal (-l window id o ventana activa con CGWindowID)
  // Con -c o -x se toma screenshot limpio de la pantalla principal o ventana
  execSync(`screencapture -x "${targetPath}"`);
  console.log(`✅ Guardado: ${targetPath}`);
}

console.log('Capturas completadas.');
