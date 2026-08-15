# Directiva: Estándar de Botones Corporativos Clicables (SOP)

## 1. Propósito y Alcance
Esta directiva establece el estándar visual obligatorio y universal para todos los **botones clicables** e **interactivos** dentro de la plataforma **CSCloudSolutions**. Aplica a botones de acción, botones de actualización, pestañas/tabs, botones de tabla, modales y barras de herramientas.

---

## 2. Reglas Obligatorias de Diseño (Binding Standard)

### A. Geometría y Fondo
1. **Forma:** Rectangular con bordes redondeados suaves (`rounded-lg` / `rounded-xl`). Nunca completamente circular (a menos que sea icono flotante aislado) ni con esquinas duras a 90°.
2. **Fondo:** Siempre **blanco puro** (`bg-white` en modo claro, `dark:bg-slate-900` en modo oscuro).
3. **Sombra y Transición:** Sombra muy suave (`shadow-xs`), con transición fluida de `hover` y `active` (`transition-all`).
4. **Hover State:** Micro-tinte translúcido muy suave del mismo color del texto (ej. `hover:bg-blue-50/50 dark:hover:bg-blue-950/30`).

### B. Regla de Coincidencia de Color (Borde == Texto)
El color del borde exterior debe **coincidir estrictamente** con el color de la tipografía y del icono interior del botón.

---

## 3. Paleta de Colores por Tipo y Secuencia de Botones

| Tipo de Botón / Secuencia | Color de Borde | Color de Texto e Icono | Clase Tailwind Recomendada |
| :--- | :--- | :--- | :--- |
| **Primario / Actualizar / Acciones** | Azul Empresarial `#0054A6` | Azul Empresarial `#0054A6` | `bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-blue-950/30` |
| **Secuencia #1 / Pestaña Azul** | Azul Empresarial `#0054A6` | Azul Empresarial `#0054A6` | `border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-300` |
| **Secuencia #2 / Pestaña Cian** | Azul Cian `#00AEEF` | Azul Cian `#008dbf` | `border-[#00AEEF] text-[#008dbf] dark:border-cyan-400 dark:text-cyan-300` |
| **Secuencia #3 / Pestaña Verde** | Verde Esmeralda `#10B981` | Verde Esmeralda `#10B981` | `border-emerald-600 text-emerald-600 dark:border-emerald-400 dark:text-emerald-300` |
| **Secuencia #4 / Pestaña Púrpura** | Púrpura `#8B5CF6` | Púrpura `#8B5CF6` | `border-purple-600 text-purple-600 dark:border-purple-400 dark:text-purple-300` |
| **Secuencia #5 / Pestaña Ámbar** | Ámbar `#F59E0B` | Ámbar `#D97706` | `border-amber-600 text-amber-600 dark:border-amber-400 dark:text-amber-300` |
| **Acciones Resolutivas (Optimizar ✨)** | Azul Empresarial `#0054A6` | Azul Empresarial `#0054A6` | `bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/60` |
| **Copiar / Éxito / Guardar** | Verde Esmeralda `#10B981` | Verde Esmeralda `#10B981` | `bg-white dark:bg-slate-900 border border-emerald-600 text-emerald-600 hover:bg-emerald-50` |
| **Neutro / Cerrar / Descartar** | Gris Neutro `slate-300` | Gris `slate-700` | `bg-white dark:bg-slate-900 border border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300` |
| **Peligro / Destructivo / Eliminar** | Rojo `#EF4444` | Rojo `#EF4444` | `bg-white dark:bg-slate-900 border border-red-500 text-red-600 hover:bg-red-50` |

---

## 4. Ejemplos de Implementación en Código

```tsx
// 1. Botón de Actualizar / Acción Principal
<button
    type="button"
    onClick={handleRefresh}
    className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 border border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-300 transition-all cursor-pointer shadow-xs"
>
    <IconRotateClockwise className="w-3.5 h-3.5" />
    <span>Actualizar</span>
</button>

// 2. Botón de Acción en Tabla ("Optimizar ✨")
<button
    onClick={() => handleAction(row)}
    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/60 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-blue-950/30 text-xs font-bold transition-all shadow-xs cursor-pointer"
>
    <IconSparkles className="w-3.5 h-3.5" />
    <span>Optimizar</span>
</button>
```

---

## 5. Checklist de Verificación para el Agente
- [ ] ¿El botón tiene forma rectangular con bordes redondeados suaves (`rounded-lg` o `rounded-xl`)?
- [ ] ¿El fondo del botón es blanco puro (`bg-white` en modo claro / `dark:bg-slate-900` en modo oscuro)?
- [ ] ¿El color del borde exterior coincide con el color del texto y del icono?
- [ ] ¿En secuencias de botones múltiples, se alternan colores armónicos (`#0054A6`, `#00AEEF`, `#10B981`, `#8B5CF6`) manteniendo siempre fondo blanco y borde coincidente con el texto?
