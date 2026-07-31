const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const tmpDir = path.join(projectRoot, '.tmp');
const tmpFramesDir = path.join(tmpDir, 'video_frames_real');
const tmpAudioDir = path.join(tmpDir, 'video_audio_real');
const videoAssetsDir = path.join(projectRoot, 'public', 'video-assets');
const outputMp4 = path.join(videoAssetsDir, 'finops_demo_video.mp4');
const outputGif = path.join(videoAssetsDir, 'finops_demo_preview.gif');

fs.mkdirSync(tmpFramesDir, { recursive: true });
fs.mkdirSync(tmpAudioDir, { recursive: true });
fs.mkdirSync(videoAssetsDir, { recursive: true });

// Definición de Escenas con Capturas Reales del Escritorio y Guión Narrativo (Marca: CSCloudSolutions)
const scenes = [
  {
    id: 'scene_00_intro',
    type: 'title',
    title: 'CSCloudSolutions',
    subtitle: 'FinOps Command Center',
    tag: 'PLATAFORMA ENTERPRISE DE OPTIMIZACIÓN CLOUD AZURE',
    bgGradient: 'linear-gradient(135deg, #0C1B30 0%, #0054A6 60%, #00AEEF 100%)',
    narration: 'Bienvenido a CSCloudSolutions FinOps Command Center, la plataforma líder de gestión y optimización de costos en la nube Azure.',
  },
  {
    id: 'scene_01_login',
    type: 'showcase',
    title: 'Acceso Corporativo & Gobernanza',
    subtitle: 'Autenticación mediante Microsoft Entra ID y control RBAC multi-tenant',
    image: 'desktop_shots/shot_01.png',
    narration: 'Acceso corporativo seguro y simplificado mediante Microsoft Entra ID, garantizando aislamiento multi-tenant y estricto cumplimiento normativo.',
  },
  {
    id: 'scene_02_whiteboard',
    type: 'showcase',
    title: 'Executive Whiteboard & Visibilidad',
    subtitle: 'Centro de control FinOps, Azure Advisor y madurez financiera',
    image: 'desktop_shots/shot_03.png',
    narration: 'Obtenga visibilidad completa en tiempo real sobre su gasto cloud, grado de madurez FinOps, ahorro capturado y detección de fugas financieras.',
  },
  {
    id: 'scene_03_cost_intelligence',
    type: 'showcase',
    title: 'Inteligencia Financiera & Presupuestos',
    subtitle: 'Desglose de consumo real, grupos de costo y optimización de tarifas',
    image: 'desktop_shots/shot_02.png',
    narration: 'Monitoree presupuestos por centro de costos, analice el consumo real y optimice tarifas mediante reservas e Hybrid Benefit de Microsoft Azure.',
  },
  {
    id: 'scene_04_category_savings',
    type: 'showcase',
    title: 'Costo por Categoría & Savings Plans',
    subtitle: 'Análisis comparativo de Savings Plans frente a Instancias Reservadas',
    image: 'desktop_shots/shot_12.png',
    narration: 'Analice en detalle el gasto por categoría de servicio y maximice el retorno de inversión comparando el rendimiento de Savings Plans y Reservas.',
  },
  {
    id: 'scene_05_anomalies_ai',
    type: 'showcase',
    title: 'Detección de Anomalías & AI Copilot',
    subtitle: 'Alertas predictivas e inteligencia artificial para optimización de recursos',
    image: 'desktop_shots/shot_09.png',
    narration: 'Detección proactiva de anomalías y analítica predictiva impulsada por IA para identificar imprevistos en la facturación antes de que ocurran.',
  },
  {
    id: 'scene_06_zombies_efficiency',
    type: 'showcase',
    title: 'Auditoría de Recursos Zombis & Redes',
    subtitle: 'Detección automática de discos desadjuntados e IPs inactivas',
    image: 'desktop_shots/shot_15.png',
    narration: 'Identifique y elimine automáticamente recursos zombis, discos sin adjuntar e infraestructura inactiva para liberar presupuesto valioso.',
  },
  {
    id: 'scene_07_outro',
    type: 'outro',
    title: 'Optimice su Nube con Precisión',
    subtitle: 'Pruebe la demo interactiva en finops.cscloudsolutions.com.ar',
    tag: 'CSCLOUDSOLUTIONS · FINOPS COMMAND CENTER',
    bgGradient: 'linear-gradient(135deg, #001E3D 0%, #0054A6 50%, #1E88E5 100%)',
    narration: 'Optimice su infraestructura Azure hoy mismo con CSCloudSolutions. Visítenos en finops punto cscloudsolutions punto com punto ar.',
  },
];

function getAudioDuration(filePath) {
  try {
    const cmd = `/opt/homebrew/bin/ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    const stdout = execSync(cmd).toString().trim();
    return parseFloat(stdout) || 4.0;
  } catch (err) {
    console.error(`Error obteniendo duración de ${filePath}:`, err.message);
    return 4.0;
  }
}

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
      width: 900px; height: 900px;
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
      font-size: 80px;
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
      max-width: 1100px;
      line-height: 1.5;
      font-weight: 400;
    }
    .footer-brand {
      margin-top: 50px;
      font-family: 'Montserrat', sans-serif;
      font-weight: 900;
      font-size: 24px;
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
  <div class="footer-brand">CSCloudSolutions</div>
</body>
</html>`;
  }

  const imagePath = `file://${path.join(videoAssetsDir, scene.image)}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800;900&family=Open+Sans:wght@400;600&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1920px; height: 1080px;
      background: #0C1B30;
      color: #FFFFFF;
      font-family: 'Open Sans', sans-serif;
      display: flex;
      flex-direction: column;
      padding: 30px 50px;
      overflow: hidden;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      border-bottom: 1px solid rgba(255,255,255,0.12);
      padding-bottom: 14px;
    }
    .title-box { display: flex; flex-direction: column; gap: 4px; }
    h2 {
      font-family: 'Montserrat', sans-serif;
      font-size: 36px;
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
      border: 1px solid rgba(0,174,239,0.3);
      padding: 8px 18px;
      border-radius: 8px;
    }
    .window-frame {
      flex: 1;
      background: #112239;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.18);
      box-shadow: 0 25px 60px rgba(0,0,0,0.6);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .window-header {
      height: 36px;
      background: #091526;
      border-bottom: 1px solid rgba(255,255,255,0.08);
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
      background: rgba(255,255,255,0.06);
      border-radius: 6px;
      padding: 3px 12px;
      font-family: monospace;
      font-size: 12px;
      color: #90CAF9;
    }
    .window-content {
      flex: 1;
      overflow: hidden;
      position: relative;
    }
    .window-content img {
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
      <img src="${imagePath}" alt="${scene.title}" />
    </div>
  </div>
</body>
</html>`;
}

async function buildVideoWithAudio() {
  console.log('🎙️ Paso 1: Generando locución de audio (TTS) para cada escena con marca CSCloudSolutions...');
  
  const audioFiles = [];
  const sceneDurations = [];

  for (let idx = 0; idx < scenes.length; idx++) {
    const scene = scenes[idx];
    const aiffPath = path.join(tmpAudioDir, `${scene.id}.aiff`);
    const mp3Path = path.join(tmpAudioDir, `${scene.id}.mp3`);

    console.log(`[Audio ${idx+1}/${scenes.length}] Generando locución para: ${scene.id}...`);
    
    // Ejecutar macOS say con la voz en español 'Monica'
    const sayCmd = `say -v Monica "${scene.narration.replace(/"/g, '\\"')}" -o "${aiffPath}"`;
    execSync(sayCmd);

    // Convertir a MP3
    const ffmpegAudioCmd = `/opt/homebrew/bin/ffmpeg -y -i "${aiffPath}" -acodec libmp3lame -ab 192k "${mp3Path}"`;
    execSync(ffmpegAudioCmd);

    const dur = getAudioDuration(mp3Path) + 0.8; // Añadir un margen de 0.8s de silencio natural
    sceneDurations.push(dur);
    audioFiles.push(mp3Path);

    console.log(`✅ Audio ${scene.id} listo: ${dur.toFixed(2)}s`);
  }

  // Concatenar pistas de audio en un solo archivo de audio master
  console.log('🎶 Concatenando pistas de audio en audio_master.mp3...');
  const concatListTxt = path.join(tmpAudioDir, 'audio_concat.txt');
  fs.writeFileSync(concatListTxt, audioFiles.map((f) => `file '${f}'`).join('\n'));

  const masterAudioMp3 = path.join(tmpAudioDir, 'audio_master.mp3');
  const concatAudioCmd = `/opt/homebrew/bin/ffmpeg -y -f concat -safe 0 -i "${concatListTxt}" -c copy "${masterAudioMp3}"`;
  execSync(concatAudioCmd);

  console.log('🎬 Paso 2: Renderizando frames HD de video para las capturas reales del escritorio...');
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
    const durSec = sceneDurations[idx];
    console.log(`[Frame ${idx+1}/${scenes.length}] Renderizando escena ${scene.id} (${durSec.toFixed(2)}s)...`);

    const htmlContent = generateSceneHtml(scene);
    await page.setContent(htmlContent, { waitUntil: 'load' });
    await page.waitForTimeout(400);

    const numFrames = Math.ceil(durSec * fps);
    for (let f = 0; f < numFrames; f++) {
      globalFrameCount++;
      const frameFileName = `frame_${String(globalFrameCount).padStart(5, '0')}.png`;
      const framePath = path.join(tmpFramesDir, frameFileName);
      await page.screenshot({ path: framePath, fullPage: false });
    }
  }

  await browser.close();
  console.log(`✅ ${globalFrameCount} frames renderizados en .tmp/video_frames_real/`);

  // Paso 3: Compilar Video + Audio con FFmpeg
  console.log('🎥 Paso 3: Compilando video MP4 HD 1080p sincronizado con audio...');
  const ffmpegVideoCmd = `/opt/homebrew/bin/ffmpeg -y -r ${fps} -i "${tmpFramesDir}/frame_%05d.png" -i "${masterAudioMp3}" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192000 -shortest "${outputMp4}"`;
  execSync(ffmpegVideoCmd);

  console.log(`🎉 ¡Video corporativo narrado generado con éxito!: ${outputMp4}`);

  // Generar GIF de vista previa
  console.log('🖼️ Generando GIF animado de vista previa...');
  const ffmpegGifCmd = `/opt/homebrew/bin/ffmpeg -y -r 10 -i "${tmpFramesDir}/frame_%05d.png" -vf "scale=960:-1:flags=lanczos,fps=10" "${outputGif}"`;
  execSync(ffmpegGifCmd);

  console.log(`🎉 ¡GIF de vista previa generado!: ${outputGif}`);
}

buildVideoWithAudio().catch((err) => {
  console.error('Error al construir el video con audio:', err);
  process.exit(1);
});
