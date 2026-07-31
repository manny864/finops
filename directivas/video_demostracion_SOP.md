# Directiva: Video Demostrativo Corporativo FinOps (CSCloudSolutions)

## Descripción del Objetivo
Generar un video corporativo y material audiovisual de alta fidelidad que muestre las capacidades reales de la plataforma **CSCloudSolutions FinOps Command Center** a partir de capturas de pantalla reales suministradas por el usuario y con locución de audio (TTS / voz sintética) sincronizada para cada escena.

## Entradas
1. Capturas de pantalla reales provistas por el usuario ubicadas en `/Users/manuelchavez/Desktop` (ej. `Captura de pantalla 2026-07-31...png`).
2. Nombre oficial de marca estricto: **CSCloudSolutions** (sin espacios).
3. Motor TTS (edge-tts / macOS say / ffmpeg audio synthesis) para generar las voces de narración en español de alta calidad por cada escena.

## Salidas
- `public/video-assets/desktop_shots/`: Copia organizada de las capturas del escritorio.
- `public/video-assets/audio/`: Archivos de voz narrada en MP3/WAV por cada escena.
- `public/video-assets/finops_demo_video.mp4`: Video HD 1080p con capturas de pantalla reales, superposiciones de UI, transiciones y pista de audio narrativa sincronizada.
- `public/video-assets/index.html`: Showcase con reproductor HTML5 con audio habilitado.

## Lógica y Pasos a Seguir
1. **Copiar e Inspeccionar Capturas Reales:**
   - Copiar las imágenes de `/Users/manuelchavez/Desktop` a `public/video-assets/desktop_shots/`.
   - Analizar el contenido visual de cada captura (dashboard, gráficos de costo, presupuestos, gobernanza, recursos zombie, etc.) para extraer información clave.
2. **Redactar Guión de Narración (Audio):**
   - Escribir la locución escena por escena utilizando el nombre **CSCloudSolutions**.
   - Generar los archivos de audio con `edge-tts` o la herramienta de voz de macOS (`say` a wav/mp3).
3. **Ensamblado y Compilación con FFmpeg:**
   - Crear marcos HD 1920x1080 incrustando las capturas reales dentro de contenedores estilizados (browser frame / glassmorphism).
   - Mezclar la pista de video y la pista de audio narrativa usando `ffmpeg`.

## Trampas Conocidas / Restricciones
- La marca **CSCloudSolutions** DEBE escribirse siempre unida sin espacios en títulos, gráficos, marcas de agua y locuciones.
- El video final DEBE incluir pista de audio sincronizada con la duración de las escenas.
