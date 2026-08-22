# SOP: Auditoría de Recursos Zombis y Limpieza Cloud (Omni-Scan 25 Tipos)

## Objetivo
Establecer las directivas maestras y procedimientos estándar para el motor de auditoría de recursos zombis, clasificación Hard vs. Soft waste, sistema de excepciones/whitelist persistente en base de datos, etiquetado masivo con autocompletado y consulta a FinOps Copilot, y remediación en lote.

================================================================================
### DIRECTIVAS MAESTRAS OBLIGATORIAS: AUDITORÍA DE RECURSOS ZOMBIS Y LIMPIEZA CLOUD
================================================================================

1. POLÍTICA DE ACCESO, AUTENTICACIÓN Y ENRUTAMIENTO DE TENANTS:
   - Tenant Demo (isMockTenant(tenantId) === true || searchParams.get('mock') === 'true' || tenantId.startsWith('demo-') || tenantId.startsWith('mock-')):
     • Servir datos sintéticos/demo de inmediato sin requerir autenticación OAuth ni tokens de Entra ID.
     • Navegación fluida sin bloqueos 401/403.
     • ORDEN CRÍTICO: El check `isMockTenant` DEBE evaluarse ANTES de `requireTenantAccess`. Nunca al revés.
   - Tenant Real / Conectado (isMockTenant(tenantId) === false):
     • Validación obligatoria de RBAC mediante `requireTenantAccess(req, tenantId)` y tokens OAuth válidos.
     • TOLERANCIA CERO A FALLBACKS MOCK: Si una consulta a Azure devuelve datos vacíos ([] o $0.00), la UI DEBE renderizar el estado real ($0.00 / Empty State legítimo). PROHIBIDO inyectar mocks como rescate visual de datos vacíos en un tenant real.
     • Consumir exclusivamente endpoints vivos (Azure Resource Graph KQL Omni-Scan, Cost Management API / Dataset FOCUS, ARM REST API para operaciones de tags y borrado).

2. DIRECTIVA DE ANCHO MÁXIMO (FULL-WIDTH 100%) Y RESPONSIVE CON SCROLLBAR VISIBLE EN macOS:
   - El layout principal, barra de filtros, banner de acciones masivas y tabla DEBEN ocupar el ANCHO MÁXIMO POSIBLE DE LA VENTANA (`w-full max-w-full px-4 sm:px-6 lg:px-8`).
   - PROHIBIDO aplicar restricciones rígidas de ancho como `max-w-5xl` o `max-w-7xl`.
   - **Fix Crítico para Scrollbar en macOS:** En contenedores con `overflow-x-auto`, aplicar clases Tailwind para forzar la visibilidad del scrollbar horizontal:
     `scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800`.
   - Celdas con texto adaptable (`min-w-[120px] max-w-[240px] truncate` con tooltip) y botones compactos que no desborden la vista.

3. POLÍTICA DE ICONOGRAFÍA CORPORATIVA (TABLER EXCLUSIVO - PROHIBIDO EMOJIS):
   - Librería exclusiva: '@tabler/icons-react' (Tabler Icons).
   - REEMPLAZO OBLIGATORIO: Está estrictamente prohibido usar el carácter emoji "✨" en botones o textos. Debe ser reemplazado por el componente Tabler oficial `<IconSparkles size={16} stroke={1.5} className="inline mr-1.5 text-[#0078D4]" />`.
   - Color del icono: Azul empresarial corporativo (Tailwind: 'text-[#0078D4]' o 'text-blue-600').
   - Estilo: Iconos de trazo limpio (stroke={1.5} o stroke={2}).
   - Fondo: ESTRICTAMENTE SIN FONDO ('bg-transparent' / sin badges circulares ni contenedores cuadrados de color de fondo).

4. GESTIÓN DE CAPAS (Z-INDEX Y POPOVERS INFORMATIVOS):
   - Todos los popovers de ayuda (iconos con `IconInfoCircle`), dropdowns de filtros, modales de etiquetado masivo, modal de confirmación de borrado y drawer de exención DEBEN renderizarse SIEMPRE por delante del contenido:
     • Backdrop: `fixed inset-0 bg-black/50 z-50`.
     • Contenedores de modal/popover: `z-50` o `z-[100]`.
     • Widgets flotantes (como el chat): permanecer estrictamente en `z-40` o inferior.

5. DISEÑO DE INTERFAZ Y PALETA EN TONOS DE AZUL:
   - Contenedores y KPI Cards: Fondos neutros limpios ('bg-white' o 'bg-slate-50/50') con bordes sutiles ('border border-slate-200').
   - Banner de Selección Múltiple: Fondo `bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800` con texto azul corporativo `#0078D4`.
   - Badges de Problemas:
     • Hard Waste (VM Apagada con Discos, Disco Huérfano, IP Huérfana): Badge en rojo suave o ámbar profundo (`bg-rose-50 text-rose-700 border border-rose-200` o `bg-amber-50 text-amber-700 border border-amber-200`).
     • Soft Waste (Sin Etiquetas FinOps): Badge en azul suave (`bg-blue-50 text-[#0078D4] border border-blue-200`).
     • Eximido / Whitelist: Badge en slate neutro (`bg-slate-100 text-slate-700 border border-slate-200`).

6. PRESERVACIÓN ESTRICTA DE LÓGICA Y PAGINACIÓN:
   - Paginación obligatoria (15/30/45/60) con selector de página y total de registros.
