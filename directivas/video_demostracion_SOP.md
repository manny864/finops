# Directiva: Video Demostrativo Corporativo FinOps (HyperFrames / Demo Video)

## Descripción del Objetivo
Generar un video corporativo y material audiovisual de alta fidelidad que muestre las capacidades de la plataforma **CSCloudSolutions FinOps Command Center** (KPIs de costo, inteligencia por categoría, detección de anomalías y puntaje de gobernanza).

## Entradas
1. Capturas HD (1920x1080) tomadas vía Playwright desde la versión de producción o demo interactivo (`public/video-assets/`):
   - `01_dashboard_kpis.png` (Overview & KPIs principal)
   - `02_cost_by_category.png` (Desglose de costos cloud)
   - `03_anomalies_detection.png` (Detección de anomalías en consumo)
   - `04_governance_score.png` (Score de gobernanza y etiquetado)
2. Narrativa visual y guión técnico en HTML/CSS responsivo o composiciones frame-by-frame.

## Salidas
- assets de imagen en `public/video-assets/`
- Render o estructura de escenas listas para visualización o exportación a video/GIF (`.mp4` / `.gif` / HTML interactivo).

## Lógica y Pasos a Seguir
1. **Captura de Pantalla HD Automática:**
   - Ejecutar `node scripts/capture-playwright-shots.js` con Viewport 1920x1080 (Factor 2x) para obtener imágenes nítidas de la app real.
2. **Ensamblado y Estructura de Escenas:**
   - Hook inicial (Logo CSCloudSolutions + Título)
   - Escena 1: KPIs y Control FinOps
   - Escena 2: Análisis por Categoría y Optimización
   - Escena 3: Detección de Anomalías e IA
   - Escena 4: Gobernanza y Cumplimiento
   - Cierre: Call-to-action con URL oficial (`finops.cscloudsolutions.com.ar`)
3. **Generación / Verificación:**
   - Asegurar resolución 1080p, tipografía institucional (Montserrat / Open Sans) y paleta de colores oficial.

## Trampas Conocidas / Restricciones
- Las capturas web deben esperar a que los gráficos (Recharts / SVG) estén completamente renderizados antes de capturar (`networkidle` + timeout adicional).
- Mantener la estética visual premium (dark/glassmorphism con acentos corporativos `#0054A6` y `#00AEEF`).
