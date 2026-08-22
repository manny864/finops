# SOP — Estándar de Tablas FinOps/CMP

## Objetivo

Definir un estándar único y vinculante para **todas** las tablas actuales y futuras de recursos/costos en el SaaS, evitando divergencias de UX y de contrato visual entre módulos.

## Alcance

Aplica a páginas/pestañas de inteligencia, operaciones y cockpits que muestren inventario/costos por recurso en cualquier dominio (Compute, Storage, Database, Monitoring, Network, Security, etc.).

================================================================================
### DIRECTIVA MAESTRA: TABLAS CON COLUMNAS AJUSTABLES Y PERSISTENTES (UX/CMP)
================================================================================
- AJUSTE DINÁMICO DE ANCHO (COLUMN RESIZING):
  • Las cabeceras de todas las tablas deben incluir manejadores de arrastre interactivos (resize handles con cursor `col-resize` en el borde derecho de cada `<th>`).
  • Soportar redimensionamiento manual por el usuario (mediante estados de TanStack Table / React resizable headers) con límites seguros (`minWidth: 100px`, `maxWidth: 600px`).

- SELECTOR DE VISIBILIDAD DE COLUMNAS (COLUMN TOGGLE):
  • Incluir un botón desplegable en la barra superior de cada tabla: `<IconColumns size={16} className="inline mr-1.5" /> Personalizar Columnas` (renderizado en `z-[100]`).
  • Menú con checkboxes interactivos para activar u ocultar columnas según la necesidad del operador.

- PERSISTENCIA EN NAVEGADOR (LOCAL STORAGE):
  • El ancho configurado y la visibilidad de las columnas deben guardarse automáticamente en `localStorage` bajo una clave única por tenant y vista (ej. `table_columns_config_zombies_${tenantId}`), asegurando que la personalización del cliente se mantenga al recargar o navegar entre módulos.

## Reglas obligatorias

1. Los filtros deben ubicarse **inmediatamente debajo** del título/subtítulo de la página o pestaña.
2. Filtros obligatorios:
   - Recurso
   - Región
   - Tipo
   - Grupo de recursos
3. Columnas obligatorias:
   - Recurso
   - Región
   - Tipo
   - Grupo de recursos
   - Suscripción (**nombre**, nunca ID como valor primario de UI)
4. Orden obligatorio:
   - A-Z
   - Z-A
   - costo mayor a menor
   - costo menor a mayor
5. Paginación obligatoria:
   - 15 / 30 / 45 / 60
6. UX obligatoria:
   - Tabla responsive
   - Ocupa ancho de ventana (`w-full` y sin contenedores `max-w-*` que limiten el board)
   - Columnas redimensionables por usuario con límites seguros (100px - 600px)
   - Selector de visibilidad de columnas en z-[100]
   - Persistencia automática de anchos y visibilidad en `localStorage`
7. Extensión permitida:
   - Cada tabla puede agregar columnas específicas del dominio, pero **no puede** omitir los filtros/columnas base.

## Implementación recomendada

- Reusar:
  - `src/components/dashboard/FinopsTableControls.tsx`
  - `src/components/Pagination.tsx`
  - `src/components/ResizableTh.tsx`
- Mantener paridad i18n (`messages/es.json`, `messages/en.json`, `messages/pt-BR.json`) para labels de filtros, orden y columnas.
- Resolver `subscriptionName` en backend (fallback a ID sólo cuando no exista nombre).

## Checklist de aceptación

- [ ] Filtros base visibles bajo el header.
- [ ] Columnas base presentes en la tabla.
- [ ] Sort A-Z/Z-A/costo asc/desc.
- [ ] Paginado 15/30/45/60.
- [ ] Tabla full-width + responsive.
- [ ] Columnas redimensionables (cursor `col-resize`, min 100px, max 600px).
- [ ] Selector de visibilidad de columnas (`IconColumns`, z-[100]).
- [ ] Persistencia de personalización en `localStorage` por tenant y vista.
- [ ] i18n completo en ES/EN/PT-BR.
- [ ] Mocks por tier cuando aplique tenant demo.
