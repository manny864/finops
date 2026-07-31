const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const tmpDir = path.join(projectRoot, '.tmp');
const tmpFramesDir = path.join(tmpDir, 'video_frames_music');
const videoAssetsDir = path.join(projectRoot, 'public', 'video-assets');
const bgMusicWav = path.join(tmpDir, 'bg_music.wav');
const outputMp4 = path.join(videoAssetsDir, 'finops_demo_video.mp4');
const outputGif = path.join(videoAssetsDir, 'finops_demo_preview.gif');

fs.mkdirSync(tmpFramesDir, { recursive: true });
fs.mkdirSync(videoAssetsDir, { recursive: true });

// Convertir archivo de imagen local a Base64 Data URL para evitar cualquier restricción de origin en Chromium
function getImageAsBase64(relativeOrAbsolutePath) {
  const fullPath = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(projectRoot, relativeOrAbsolutePath);

  if (!fs.existsSync(fullPath)) {
    console.error(`⚠️ Archivo de imagen no encontrado: ${fullPath}`);
    return '';
  }
  const buffer = fs.readFileSync(fullPath);
  const ext = path.extname(fullPath).toLowerCase().replace('.', '');
  const mimeType = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

// Cargar Logo Oficial CSCloudSolutions en Base64
const logoBase64 = getImageAsBase64('public/Logo_CSCloudSolutions.png') || getImageAsBase64('public/logo.png');

// Cargar Capturas Reales del Escritorio en Base64
const realShots = [
  { file: 'public/video-assets/desktop_shots/shot_01.png', title: 'Acceso Corporativo & Autenticación', sub: 'Inicie sesión de forma segura con Microsoft Entra ID' },
  { file: 'public/video-assets/desktop_shots/shot_03.png', title: 'Executive Whiteboard & Visibilidad', sub: 'Control centralizado de consumo Azure, Azure Advisor y madurez FinOps' },
  { file: 'public/video-assets/desktop_shots/shot_02.png', title: 'Inteligencia Financiera & Presupuestos', sub: 'Gestión por centro de costos, presupuestos mensuales y alertas en tiempo real' },
  { file: 'public/video-assets/desktop_shots/shot_07.png', title: 'Análisis de Consumo & Tendencias MTD', sub: 'Desglose detallado de gasto en cómputo, almacenamiento y redes' },
  { file: 'public/video-assets/desktop_shots/shot_09.png', title: 'Red Perimetral & Application Insights', sub: 'Monitoreo de telemetría, Log Analytics y economía unitaria' },
  { file: 'public/video-assets/desktop_shots/shot_12.png', title: 'Costo por Categoría & Savings Plans', sub: 'Comparativa de eficiencia entre Savings Plans e Instancias Reservadas' },
  { file: 'public/video-assets/desktop_shots/shot_13.png', title: 'Detección de Anomalías & AI Copilot', sub: 'Alertas predictivas e inteligencia artificial para optimizar recursos' },
  { file: 'public/video-assets/desktop_shots/shot_15.png', title: 'Auditoría de Recursos Zombis & Fugas', sub: 'Detección automática de discos desadjuntados e IPs inactivas' },
].map((s) => ({
  ...s,
  base64: getImageAsBase64(s.file),
}));

// Definición de Escenas del Video con Música
const scenes = [
  {
    id: 'scene_00_intro',
    type: 'intro',
    durationSec: 4.5,
    title: 'CSCloudSolutions',
    subtitle: 'FinOps Command Center',
    tag: 'PLATAFORMA ENTERPRISE DE OPTIMIZACIÓN CLOUD AZURE',
    bgGradient: 'linear-gradient(135deg, #0A1728 0%, #0054A6 50%, #00AEEF 100%)',
  },
  ...realShots.map((shot, i) => ({
    id: `scene_${String(i + 1).padStart(2, '0')}`,
    type: 'showcase',
    durationSec: 4.5,
    title: shot.title,
    subtitle: shot.sub,
    base64Image: shot.base64,
  })),
  {
    id: 'scene_outro',
    type: 'outro',
    durationSec: 4.5,
    title: 'Optimice su Nube con Precisión',
    subtitle: 'Solicite su demo personalizada en finops.cscloudsolutions.com.ar',
    tag: 'CSCLOUDSOLUTIONS · FINOPS COMMAND CENTER',
    bgGradient: 'linear-gradient(135deg, #001E3D 0%, #0054A6 60%, #1E88E5 100%)',
  },
];

function generateSceneHtml(scene) {
  if (scene.type === 'intro' || scene.type === 'outro') {
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
      padding: 60px;
      position: relative;
      overflow: hidden;
    }
    .glow {
      position: absolute;
      width: 1000px; height: 1000px;
      background: radial-gradient(circle, rgba(0,174,239,0.3) 0%, rgba(0,0,0,0) 70%);
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    .logo-img {
      max-width: 480px;
      max-height: 180px;
      object-fit: contain;
      margin-bottom: 30px;
      filter: drop-shadow(0 15px 35px rgba(0,0,0,0.5));
    }
    .tag {
      font-family: 'Montserrat', sans-serif;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: 4px;
      color: #90CAF9;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.2);
      padding: 10px 28px;
      border-radius: 99px;
      margin-bottom: 25px;
      text-transform: uppercase;
    }
    h1 {
      font-family: 'Montserrat', sans-serif;
      font-size: 72px;
      font-weight: 900;
      letter-spacing: -1px;
      line-height: 1.1;
      margin-bottom: 20px;
      background: linear-gradient(180deg, #FFFFFF 0%, #D0E4FF 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p {
      font-size: 26px;
      color: #E0EFFF;
      max-width: 1100px;
      line-height: 1.5;
      font-weight: 400;
    }
    .url-badge {
      margin-top: 35px;
      font-family: 'Montserrat', sans-serif;
      font-weight: 900;
      font-size: 22px;
      color: #00AEEF;
      background: rgba(0,174,239,0.15);
      border: 1px solid rgba(0,174,239,0.4);
      padding: 10px 30px;
      border-radius: 12px;
      letter-spacing: 2px;
    }
  </style>
</head>
<body>
  <div class="glow"></div>
  <img src="${logoBase64}" alt="CSCloudSolutions Logo" class="logo-img" />
  <div class="tag">${scene.tag}</div>
  <h1>${scene.title}</h1>
  <p>${scene.subtitle}</p>
  ${scene.type === 'outro' ? '<div class="url-badge">finops.cscloudsolutions.com.ar</div>' : ''}
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800;900&family=Open+Sans:wght@400;600&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1920px; height: 1080px;
      background: #091526;
      color: #FFFFFF;
      font-family: 'Open Sans', sans-serif;
      display: flex;
      flex-direction: column;
      padding: 24px 40px;
      overflow: hidden;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.14);
      padding-bottom: 12px;
    }
    .title-box { display: flex; flex-direction: column; gap: 4px; }
    h2 {
      font-family: 'Montserrat', sans-serif;
      font-size: 34px;
      font-weight: 800;
      color: #FFFFFF;
      letter-spacing: -0.5px;
    }
    p.sub {
      font-size: 18px;
      color: #90CAF9;
      font-weight: 400;
    }
    .brand-badge {
      font-family: 'Montserrat', sans-serif;
      font-size: 14px;
      font-weight: 900;
      letter-spacing: 2px;
      color: #00AEEF;
      background: rgba(0,174,239,0.12);
      border: 1px solid rgba(0,174,239,0.35);
      padding: 8px 18px;
      border-radius: 8px;
    }
    .window-frame {
      flex: 1;
      background: #112239;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.18);
      box-shadow: 0 25px 60px rgba(0,0,0,0.7);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .window-header {
      height: 38px;
      background: #060E1A;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      display: flex;
      align-items: center;
      padding: 0 16px;
      gap: 8px;
    }
    .dot { width: 12px; height: 12px; border-radius: 50%; }
    .dot-red { background: #FF5F56; }
    .dot-yellow { background: #FFBD2E; }
    .dot-green { background: #27C93F; }
    .url-bar {
      margin-left: 16px;
      background: rgba(255,255,255,0.08);
      border-radius: 6px;
      padding: 4px 16px;
      font-family: monospace;
      font-size: 13px;
      color: #90CAF9;
    }
    .window-content {
      flex: 1;
      overflow: hidden;
      position: relative;
      background: #000000;
    }
    .window-content img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      object-position: top center;
      display: block;
    }
  </style>
</head>
<body>
  <header>
    <div class="title-box">
      <h2>${scene.title}</h2>
      <p class="sub">${scene.subtitle}</p>
    </div>
    <div class="brand-badge">CSCLOUDSOLUTIONS</div>
  </header>
  <div class="window-frame">
    <div class="window-header">
      <div class="dot dot-red"></div>
      <div class="dot dot-yellow"></div>
      <div class="dot dot-green"></div>
      <div class="url-bar">https://finops.cscloudsolutions.com.ar</div>
    </div>
    <div class="window-content">
      <img src="${scene.base64Image}" alt="${scene.title}" />
    </div>
  </div>
</body>
</html>`;
}

async function renderVideoWithMusic() {
  console.log('🎬 Paso 1: Renderizando frames HD (1080p) con capturas de pantalla reales en Base64...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  let globalFrameCount = 0;
  const fps = 30;

  for (let idx = 0; idx < scenes.length; idx++) {
    const scene = scenes[idx];
    console.log(`[Escena ${idx + 1}/${scenes.length}] Renderizando: ${scene.id} (${scene.durationSec}s)...`);

    const htmlContent = generateSceneHtml(scene);
    await page.setContent(htmlContent, { waitUntil: 'load' });
    await page.waitForTimeout(300);

    const numFrames = Math.ceil(scene.durationSec * fps);
    for (let f = 0; f < numFrames; f++) {
      globalFrameCount++;
      const frameFileName = `frame_${String(globalFrameCount).padStart(5, '0')}.png`;
      const framePath = path.join(tmpFramesDir, frameFileName);
      await page.screenshot({ path: framePath, fullPage: false });
    }
  }

  await browser.close();
  console.log(`✅ ${globalFrameCount} frames renderizados en .tmp/video_frames_music/`);

  // Paso 2: Mezclar frames de video + música de fondo con FFmpeg
  console.log('🎵 Paso 2: Mezclando frames de video con la pista de música electrónica en FFmpeg...');
  const totalVideoDurationSec = globalFrameCount / fps;

  const ffmpegCmd = `/opt/homebrew/bin/ffmpeg -y -r ${fps} -i "${tmpFramesDir}/frame_%05d.png" -i "${bgMusicWav}" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -t ${totalVideoDurationSec} "${outputMp4}"`;
  execSync(ffmpegCmd);

  console.log(`🎉 ¡Video corporativo con música e imágenes reales generado!: ${outputMp4}`);

  // Paso 3: Generar GIF animado de vista previa
  console.log('🖼️ Paso 3: Generando GIF animado de vista previa...');
  const gifCmd = `/opt/homebrew/bin/ffmpeg -y -r 10 -i "${tmpFramesDir}/frame_%05d.png" -vf "scale=960:-1:flags=lanczos,fps=10" "${outputGif}"`;
  execSync(gifCmd);

  console.log(`🎉 ¡GIF de vista previa generado!: ${outputGif}`);
}

renderVideoWithMusic().catch((err) => {
  console.error('Error al construir el video con música:', err);
  process.exit(1);
});
