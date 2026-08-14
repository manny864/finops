# Directiva: Sistema de Diseño Corporativo, Paleta Empresarial, Tipografía e Iconos Tabler

## Descripción del Objetivo
Garantizar la consistencia estética, elegancia visual y alineación estricta con la identidad corporativa de **CSCloudSolutions** en todas las vistas, componentes, paneles de control, tablas y visualizaciones gráficas del SaaS.

---

## 1. Paleta de Colores Empresariales

- **Color Primario de Títulos y Encabezados:** Azul empresarial profundo `rgb(27, 42, 65)` (`#1B2A41`).
- **Color de Texto General (Cuerpo / Párrafos / Labels):** `#1B2A41` (en modo claro) / `--ink: #EEF3F9` (en modo oscuro).
- **Azul de Acción / Brand Deep:** `#0054A6` (utilizado para CTAs principales, bordes activos, badges destacados y barras primarias).
- **Azul Acento / Brand Bright:** `#00AEEF` (cian secundario para gradientes y métricas complementarias).
- **Superficies y Fondos:**
  - Fondo general: `#EEF3F9` (Modo claro) / `#0C1B30` (Modo oscuro).
  - Superficie de tarjetas (`bg-surface`): `#FFFFFF` / `#0A1728`.
  - Superficie secundaria (`bg-surface-2`): `#F6F9FD` / `#102442`.
  - Bordes de separación (`border-line`): `#E3EBF3` / `#1C3149`.

---

## 2. Estándar de Tipografías

### A. Tipografía para Títulos y Encabezados (H1, H2, H3, H4, Card Headers)
- **Familia:** `font-family: Montserrat, "Montserrat Fallback";`
- **Color obligatorio:** Azul empresarial `rgb(27, 42, 65)` / `#1B2A41` (en modo claro) y `#FFFFFF` / `#F6F9FD` (en modo oscuro).
- **Pesos:** `font-bold` (700) o `font-extrabold` (800).

### B. Tipografía para Texto de Cuerpo, Tablas, Formularios y Párrafos
- **Familia:** `font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";`
- **Color obligatorio:** `#1B2A41` (en modo claro) y `--ink: #EEF3F9` (en modo oscuro).
- **Pesos:** `font-normal` (400), `font-medium` (500), `font-semibold` (600).

---

## 3. Estándar de Gráficas y Visualizaciones (Recharts / SVG)

Todas las gráficas de evolución temporal, barras, áreas, líneas y donas deben emplear **estrictamente el azul empresarial y colores armónicos**:

- **Serie Principal / Gasto Real / Tendencia:** `#0054A6` (Azul Empresarial Primario).
- **Serie Secundaria / Forecast / Contrafactual:** `#1B2A41` (Azul Noche), `#00AEEF` (Cian Acento), `#90CAF9` (Celeste Claro).
- **Gradientes de Área:** Desde `#0054A6` (opacidad 0.25 - 0.30) hasta `#0054A6` (opacidad 0.00).
- **Ahorro / Métricas Positivas:** `#10B981` (Verde esmeralda equilibrado).
- **Presupuestos / Umbrales de Alerta:** `#EF4444` (Línea punteada de límite).
- **Prohibición:** Queda prohibido el uso de colores saturados genéricos o combinaciones fuera de la paleta institucional.

---

## 4. Biblioteca Oficial de Iconos

- **Iconos Oficiales:** Se debe utilizar la biblioteca **Tabler Icons** (`@tabler/icons-react` o SVGs oficiales de Tabler).
- **Estilo:** Trazo moderno, grosor `strokeWidth={1.5}` o `strokeWidth={2}`, tamaño consistente (`w-4 h-4` para tablas y badges, `w-5 h-5` para tarjetas y headers de página).
- **Color del Icono:** Heredar el azul empresarial `text-brand-deep` / `text-[#1B2A41]` o el color semántico correspondiente según el contexto (verde para éxito, ámbar para advertencia).

---

## 5. Trampas Conocidas / Restricciones
- **No hardcodear fuentes ad-hoc:** No declarar familias tipográficas arbitrarias (ej. Comic Sans, Times, Arial genérico) en estilos en línea o clases custom. Usar las variables `--font-heading` (`Montserrat`) y `--font-sans` configuradas en el proyecto.
- **Sincronización Dark Mode:** Al usar `#1B2A41` para títulos y textos en modo claro, asegurarse siempre de agregar la clase de dark mode `dark:text-white` o `dark:text-foreground` para garantizar contraste óptimo en temas oscuros.
