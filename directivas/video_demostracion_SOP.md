# Directiva: Video Demostrativo Corporativo FinOps (CSCloudSolutions)

## Descripción del Objetivo
Generar un video corporativo y material audiovisual de alta fidelidad que muestre las capturas de pantalla reales de la plataforma **CSCloudSolutions FinOps Command Center** inyectadas en formato **Base64 Data URL** para garantizar su renderizado 100% confiable, con la imagen del logo oficial al inicio y final del video, y una pista de música electrónica corporativa interactiva en sustitución de la locución hablada.

## Entradas
1. Capturas de pantalla reales en `public/video-assets/desktop_shots/shot_01.png` .. `shot_16.png` convertidas a base64.
2. Logo oficial de la marca: `public/Logo_CSCloudSolutions.png` / `public/logo.png` convertido a base64.
3. Denominación oficial única: **CSCloudSolutions** (sin espacios).
4. Pista de música interactiva en `.tmp/bg_music.wav` / `.mp3`.

## Salidas
- `public/video-assets/finops_demo_video.mp4`: Video HD 1080p con logo oficial de apertura/cierre, capturas reales incrustadas en Base64, transiciones de pantalla y pista de música corporativa.
- `public/video-assets/finops_demo_preview.gif`: GIF animado de vista previa.
- `public/video-assets/index.html`: Showcase HTML5 con reproductor de video y galería de capturas.

## Lógica y Pasos a Seguir
1. **Base64 Inlining de Capturas y Logo:**
   - Leer cada imagen PNG desde Node.js (`fs.readFileSync(...)`) y convertir a `data:image/png;base64,...`.
   - Inyectar el string base64 directamente en las etiquetas `<img>` del HTML renderizado por Playwright. Esto elimina cualquier bloqueo de políticas CORS o `file://` en Chromium.
2. **Escenas de Apertura y Cierre:**
   - Intro (Escena 0): Renderizar `Logo_CSCloudSolutions.png` (Base64) centrado con animación glow y título **CSCloudSolutions FinOps Command Center**.
   - Escenas Intermedias (Escenas 1 a 6): Renderizar las capturas reales base64 en un marco de navegador HD con URL `https://finops.cscloudsolutions.com.ar`.
   - Outro (Escena Final): Renderizar `Logo_CSCloudSolutions.png` (Base64) con llamada a la acción `finops.cscloudsolutions.com.ar`.
3. **Mezcla Audiovisual con Música:**
   - Eliminar voz hablada.
   - Sincronizar la pista de audio musical `.tmp/bg_music.wav` con la secuencia de frames mediante `ffmpeg`.

## Trampas Conocidas / Restricciones
- NUNCA usar `file://` en el `src` de las imágenes dentro de `page.setContent()`; SIEMPRE usar Base64 Data URLs (`data:image/png;base64,...`).
- Mantener la marca **CSCloudSolutions** unida sin espacios en toda la composición.
