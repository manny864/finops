const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const tmpFramesDir = path.join(projectRoot, '.tmp', 'video_frames');
const videoAssetsDir = path.join(projectRoot, 'public', 'video-assets');
const outputMp4 = path.join(videoAssetsDir, 'finops_demo_video.mp4');

fs.mkdirSync(tmpFramesDir, { recursive: true });
fs.mkdirSync(videoAssetsDir, { recursive: true });

// Definición del Guión y Escenas del Video (1920x1080)
const scenes = [
  {
    id: 'scene_00_intro',
    durationSec: 4,
    title: 'CSCloudSolutions',
    subtitle: 'FinOps Command Center',
    tag: 'PLATAFORMA ENTERPRISE DE OPTIMIZACIÓN CLOUD',
    bgGradient: 'linear-gradient(135deg, #0C1B30 0%, #0054A6 60%, #00AEEF 100%)',
    type: 'title',
  },
  {
    id: 'scene_01_dashboard',
    durationSec: 5,
    title: 'Control Ejecutivo & KPIs en Tiempo Real',
    subtitle: 'Visibilidad centralizada de costos Azure, proyecciones MTD y salud de infraestructura',
    image: '01_dashboard_kpis.png',
    type: 'showcase',
  },
  {
    id: 'scene_02_cost_by_category',
    durationSec: 5,
    title: 'Inteligencia de Costos por Categoría',
    subtitle: 'Análisis detallado de gasto en Cómputo, Almacenamiento, Redes y PaaS',
    image: '02_cost_by_category.png',
    type: 'showcase',
  },
  {
    id: 'scene_03_anomalies',
    durationSec: 5,
    title: 'Detección Proactiva de Anomalías',
    subtitle: 'Alertas tempranas mediante aprendizaje estadístico para evitar sorpresas en la factura',
    image: '03_anomalies_detection.png',
    type: 'showcase',
  },
  {
    id: 'scene_04_governance',
    durationSec: 5,
    title: 'Gobernanza & Cumplimiento de Etiquetas',
    subtitle: 'Monitoreo continuo de políticas FinOps, tagging compliance y optimización de licencias',
    image: '04_governance_score.png',
    type: 'showcase',
  },
  {
    id: 'scene_05_outro',
    durationSec: 4,
    title: 'Optimice su Nube con Precisión',
    subtitle: 'Pruebe la demo interactiva en finops.cscloudsolutions.com.ar',
    tag: 'CS CLOUD SOLUTIONS · FINOPS PRO',
    bgGradient: 'linear-gradient(135deg, #001E3D 0%, #0054A6 50%, #1E88E5 100%)',
    type: 'outro',
  },
];

function generateSceneHtml(scene) {
  if (scene.type === 'title' || scene.type === 'outro') {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800;900&family=Open+Sans:wght@400;600&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1920px; height: 1080px;
      background: ${scene.bgGradient};
      color: #FFFFFF;
      font-family: 'Open Sans', sans-serif;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      padding: 80px;
      position: relative;
      overflow: hidden;
    }
    .glow {
      position: absolute;
      width: 800px; height: 800px;
      background: radial-gradient(circle, rgba(0,174,239,0.25) 0%, rgba(0,0,0,0) 70%);
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    .tag {
      font-family: 'Montserrat', sans-serif;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: 4px;
      color: #90CAF9;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.18);
      padding: 10px 24px;
      border-radius: 99px;
      margin-bottom: 30px;
      text-transform: uppercase;
    }
    h1 {
      font-family: 'Montserrat', sans-serif;
      font-size: 76px;
      font-weight: 900;
      letter-spacing: -1px;
      line-height: 1.1;
      margin-bottom: 24px;
      background: linear-gradient(180deg, #FFFFFF 0%, #D0E4FF 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p {
      font-size: 28px;
      color: #E0EFFF;
      max-width: 1000px;
      line-height: 1.5;
      font-weight: 400;
    }
    .footer-logo {
      margin-top: 50px;
      font-family: 'Montserrat', sans-serif;
      font-weight: 800;
      font-size: 22px;
      color: #00AEEF;
      letter-spacing: 2px;
    }
  </style>
</head>
<body>
  <div class="glow"></div>
  <div class="tag">${scene.tag}</div>
  <h1>${scene.title}</h1>
  <p>${scene.subtitle}</p>
  <div class="footer-logo">CSCloudSolutions</div>
</body>
</html>`;
  }

  const imagePath = `file://${path.join(videoAssetsDir, scene.image)}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&family=Open+Sans:wght@400;600&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1920px; height: 1080px;
      background: #0C1B30;
      color: #FFFFFF;
      font-family: 'Open Sans', sans-serif;
      display: flex;
      flex-direction: column;
      padding: 40px 60px;
      overflow: hidden;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      padding-bottom: 18px;
    }
    .title-box { display: flex; flex-direction: column; gap: 6px; }
    h2 {
      font-family: 'Montserrat', sans-serif;
      font-size: 38px;
      font-weight: 800;
      color: #FFFFFF;
      letter-spacing: -0.5px;
    }
    p.sub {
      font-size: 19px;
      color: #90CAF9;
      font-weight: 400;
    }
    .badge {
      font-family: 'Montserrat', sans-serif;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 2px;
      color: #00AEEF;
      background: rgba(0,174,239,0.12);
      border: 1px solid rgba(0,174,239,0.3);
      padding: 8px 18px;
      border-radius: 8px;
    }
    .shot-container {
      flex: 1;
      background: #112239;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.15);
      box-shadow: 0 20px 50px rgba(0,0,0,0.5);
      overflow: hidden;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    .shot-container img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top center;
    }
  </style>
</head>
<body>
  <header>
    <div class="title-box">
      <h2>${scene.title}</h2>
      <p class="sub">${scene.subtitle}</p>
    </div>
    <div class="badge">FINOPS PRO</div>
  </header>
  <div class="shot-container">
    <img src="${imagePath}" alt="${scene.title}" />
  </div>
</body>
</html>`;
}

async function renderVideoFrames() {
  console.log('🎬 Generando frames para el video demostrativo...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  let frameCount = 0;
  const fps = 30;

  for (let sIdx = 0; sIdx < scenes.length; sIdx++) {
    const scene = scenes[sIdx];
    console.log(`Renderizando Escena ${sIdx + 1}/${scenes.length}: ${scene.id} (${scene.durationSec}s)`);

    const htmlContent = generateSceneHtml(scene);
    await page.setContent(htmlContent, { waitUntil: 'load' });
    await page.waitForTimeout(500);

    const numFrames = scene.durationSec * fps;
    for (let f = 0; f < numFrames; f++) {
      frameCount++;
      const frameFileName = `frame_${String(frameCount).padStart(5, '0')}.png`;
      const framePath = path.join(tmpFramesDir, frameFileName);
      await page.screenshot({ path: framePath, fullPage: false });
    }
  }

  await browser.close();
  console.log(`✅ ${frameCount} frames generados en .tmp/video_frames/`);

  // Compilar con ffmpeg a MP4
  console.log('📹 Compilando MP4 con FFmpeg...');
  const ffmpegCmd = `/opt/homebrew/bin/ffmpeg -y -r 30 -i "${tmpFramesDir}/frame_%05d.png" -c:v libx264 -pix_fmt yuv420p "${outputMp4}"`;
  execSync(ffmpegCmd);
  console.log(`🎉 ¡Video generado con éxito!: ${outputMp4}`);

  // Opcional: Generar también GIF animado ligero de vista previa
  const outputGif = path.join(videoAssetsDir, 'finops_demo_preview.gif');
  console.log('🖼️ Generando GIF animado de vista previa...');
  const gifCmd = `/opt/homebrew/bin/ffmpeg -y -r 10 -i "${tmpFramesDir}/frame_%05d.png" -vf "scale=960:-1:flags=lanczos,fps=10" "${outputGif}"`;
  execSync(gifCmd);
  console.log(`🎉 ¡GIF animado generado!: ${outputGif}`);
}

renderVideoFrames().catch((err) => {
  console.error('Error generando video:', err);
  process.exit(1);
});
