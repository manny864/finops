# Directiva: Estándar Obligatorio de Iconos Informativos con Popovers Explicativos (SOP)

## 1. Propósito y Alcance
Esta directiva establece el estándar visual y funcional obligatorio y universal para la inclusión de **iconos informativos interactivos (`InfoTooltip`) con diálogos popover contextuales** en toda la plataforma **CSCloudSolutions**.

Aplica de forma estricta e inexcusable a:
1. **Encabezados de Página:** Títulos principales (`h1`/`h2`) y subtítulos explicativos de cada vista.
2. **Pestañas y Subpestañas (Tabs):** Cada pestaña de navegación de módulos y tabuladores internos.
3. **Títulos de Tablas y Secciones:** Cada sección de datos, panel comparativo y tarjeta de recomendaciones.
4. **Columnas de Tablas y Tarjetas KPI:** Métricas clave, cálculos unitarios y columnas de tablas de recursos/costos.

---

## 2. Reglas Obligatorias de Diseño y Arquitectura (Binding Standard)

### A. Componente Oficial
- Utilizar exclusivamente el componente centralizado [`src/components/InfoTooltip.tsx`](file:///Users/manuelchavez/Documents/FinOpsProyect/src/components/InfoTooltip.tsx).
- Nunca crear tooltips ad-hoc ni usar librerías externas no estandarizadas.

### B. Visual y Estilo Corporativo
1. **Icono Oficial:** `IconInfoCircle` de **Tabler Icons** (`@tabler/icons-react`).
2. **Fondo del Popover:** Sólido azul empresarial profundo `#1B2A41` (`bg-[#1B2A41]` / `dark:bg-slate-800`), 100% opaco (`opacity: 1`), con borde nítido (`border border-slate-600`) y sombra de elevación alta (`shadow-2xl`).
3. **Tipografía del Popover:** Texto blanco `#FFFFFF` en modo claro y oscuro, con tamaño `text-[11px]`, interlineado relajado (`leading-relaxed`), peso normal (`font-normal`), alineación izquierda (`text-left`) y sin transformación forzada (`normal-case tracking-normal`).
4. **Posicionamiento y Capas (Z-Index):**
   - Siempre renderizar con `z-[9999]` o `z-[100]` para evitar solapamientos con modales, tarjetas o tablas.
   - En encabezados de tablas y elementos superiores, usar `position="bottom"` con alineación adaptativa (`align="left"`, `align="center"` o `align="right"`) para evitar recortes con los bordes de la pantalla o contenedores con scroll.

### C. Reglas de Validación HTML y React (Semántica DOM)
- El tooltip debe contener etiquetas inline (`<span>`, nunca `<div>` internos) para permitir su inserción segura dentro de etiquetas `<p>`, `<span>`, `<h1>` a `<h6>`, `<th>`, `<td>`, `<button>`, etc. sin generar errores de hidratación (`In HTML, <div> cannot be a descendant of <p>`).

---

## 3. Internacionalización Obligatoria (i18n)
- **Cero strings hardcodeados:** Todo contenido explicativo de los tooltips DEBE residir en los diccionarios de internacionalización bajo una clave descriptiva (ej. `tooltip_page_title`, `tooltip_tab_name`, `tooltip_table_title`, `tooltip_col_cost`).
- **Paridad en los 3 idiomas:** Cada clave añadida debe existir obligatoriamente en `messages/es.json`, `messages/en.json` y `messages/pt-BR.json`.

---

## 4. Ejemplos de Implementación en Código

```tsx
// 1. Título de Página / Módulo
<div className="flex items-center gap-2">
  <h1 className="text-2xl font-bold text-[#1B2A41] dark:text-white">{t("pageTitle")}</h1>
  <InfoTooltip content={t("tooltip_page_title")} position="bottom" align="left" />
</div>

// 2. Pestañas / Tabs
<button className="...">
  <span>{t("tabCompute")}</span>
  <InfoTooltip content={t("tooltip_tab_compute")} position="bottom" align="center" />
</button>

// 3. Título de Tabla / Sección
<div className="flex items-center gap-2 mb-3">
  <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-white">{t("tableTitle")}</h3>
  <InfoTooltip content={t("tooltip_table_title")} position="bottom" align="left" />
</div>

// 4. Encabezado de Columna en Tabla
<ResizableTh minWidth={140} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right">
  <span className="inline-flex items-center justify-end gap-1">
    {t("colMonthlyCost")}
    <InfoTooltip content={t("tooltip_col_monthly_cost")} position="bottom" align="right" />
  </span>
</ResizableTh>
```

---

## 5. Checklist de Verificación para el Agente
- [ ] ¿Cada título de página nuevo o modificado cuenta con su `InfoTooltip` explicativo?
- [ ] ¿Cada pestaña / tab de navegación contiene un `InfoTooltip` descriptivo?
- [ ] ¿Cada tabla de datos y sección tiene un `InfoTooltip` en su título y columnas clave?
- [ ] ¿Las claves de traducción están presentes de forma idéntica en `messages/es.json`, `messages/en.json` y `messages/pt-BR.json`?
- [ ] ¿El popover abre en posición correcta (`position="bottom"`, `align="left"|"right"`) sin quedar cortado por el viewport ni detrás de tablas?
