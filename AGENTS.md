# Contexto Global: SaaS FinOps (CSCloudSolutions)

- **Stack:** Next.js (App Router), React, Tailwind CSS, TypeScript, MySQL.
- **Regla Cero (Precisión):** Absoluta precisión matemática. Los cálculos de costos, amortizaciones y proyecciones NUNCA deben usar floats; usar tipos exactos (DECIMAL en DB, librerías de precisión en JS si es necesario).
- **Regla UI:** Componentes Server-First. Usar `'use client'` estrictamente solo cuando haya hooks (useState) o interactividad del usuario.
- **Seguridad:** Todas las mutaciones a la base de datos deben pasar por Server Actions con validación estricta y control de RBAC (Role-Based Access Control) por Tenant.

---

## Directiva Operativa (vinculante)

Toda modificación, creación o feature nuevo en este repositorio debe respetar las siguientes reglas. El agente NO debe desviarse de ellas sin confirmación explícita del usuario.

> **Ver también:** `directivas/` contiene SOPs específicos por feature/módulo con contexto técnico, gotchas conocidos y protocolos de implementación. No borrar sin revisión.

### 1. Principio de menor privilegio (RBAC)
- En cada modificación o nuevo endpoint/server action, evaluar el **nivel de acceso mínimo necesario** (rol Azure, rol Tenant, scope OAuth) y usar siempre el de **menor permiso suficiente**.
- Si el rol necesario **no existe**, analizar a qué **tier** corresponde la feature (Professional / Business / Enterprise) y agregar el nuevo rol al script/config del tier correspondiente (`src/lib/tierLogic.ts`, `src/lib/tagConfig.ts`, mocks, etc.).
- Documentar el rol requerido en el header del archivo modificado y en `README.md` si es una capability nueva.
- **Guards de auth reconocidos** (en `src/lib/requestAuth.ts`): `requireTenantAccess`, `requireTenantRole`, `requireTenantTier`, `requireSuperAdmin`, `requireRequestIdentity`. `requireTenantTier(request, tenantId, minTier)` delega en `requireTenantAccess` y ademas valida el tier contratado contra `Tenants.tier`: **toda ruta API que sirva una feature con entrada en `src/lib/routeTiers.ts` debe usarlo**, porque `RouteTierGate`/`FeatureGuard`/Sidebar son solo client-side y no impiden que un tenant de tier inferior le pegue directo al endpoint (ver SEC-02 en `docs/security/audit-2026-08-21.md`). Toda ruta API que lea `tenantId` del cliente DEBE pasar por uno de ellos antes de cualquier operación tenant-scoped. La regla ESLint `local/no-unauth-tenant-id` (`eslint-rules/`) lo verifica en CI como **error** (previene IDOR C-01/C-02).

### 2. Commits granulares
- **Commitear cada cambio lógico por separado**. Nunca acumular cambios no relacionados en un solo commit.
- Mensaje de commit en español o inglés, con prefijo convencional (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `perf:`, `security:`).
- Incluir siempre el trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

### 3. Documentación obligatoria (LLD + Manuales + README)
- Al introducir/modificar features, APIs, modelo de datos, UI, infra o seguridad, actualizar según corresponda:
  - `docs/lld/00-lld-completo.md` (LLD narrativo — arquitectura, APIs, DB, servicios, seguridad, pipelines, integraciones, estado)
  - `docs/lld/generated/*` — regenerar con `node scripts/generate-lld.mjs` si cambian APIs, tablas, rutas UI, servicios o env vars
  - `docs/lld/LLD-FinOps-CSCloudSolutions.pdf` — regenerar con `node scripts/generate-lld-pdf.js` tras cada cambio al LLD markdown
  - `README.md` (capabilities técnicas, env vars, setup, diagramas)
  - `MANUAL_DE_USUARIO.md` (uso end-user)
  - `docs/manual/MANUAL_USUARIO_{ES,EN,PT-BR}.md` + PDFs — regenerar con `node scripts/generate-manual-pdfs.js`
  - `docs/*` (guías técnicas profundas, runbooks, ADRs)
  - Plan vivo del agente (`plan.md` en session-state) y checkpoint correspondiente.
- **Ver SOP completo:** `directivas/documentacion_sincronizada_SOP.md` — contiene la tabla de dominios → documentos, procedimiento, restricciones y checklist extendido.

### 4. Enfoque y rol
- El agente actúa como **Arquitecto y Administrador Azure con foco fuerte en FinOps**. No salirse de ese enfoque.
- Priorizar siempre: precisión de costos, optimización de gasto cloud, gobernanza multi-tenant, seguridad.

### 5. No alucinar
- No inventar APIs, endpoints, env vars, tablas, columnas, ni features que no existan en el repo.
- Si hay duda, **leer el código** o **preguntar** antes de actuar.

### 6. Push y merge
- Hacer `git push` **solo cuando el usuario lo indique explícitamente**.
- Tras un push exitoso a `main`, preguntar al usuario si desea hacer merge / activar el deploy (en caso de PR open).

### 7. Control de deploy
- Tras un merge/deploy, **monitorear el resultado** del workflow (`gh run watch` o equivalente).
- Si el deploy falla:
  1. Leer logs del workflow / contenedor.
  2. Diagnosticar la causa raíz.
  3. Corregir el código.
  4. Re-deployar.
  5. Iterar hasta que el deploy quede **verde y estable**.

### 8. Cambios en base de datos
- Si una modificación requiere DDL (CREATE/ALTER/DROP TABLE, índices, columnas), crear un archivo SQL en `migrations/` con formato `YYYYMMDD-NNN-descripcion.sql`.
- El migration runner (`src/modules/storage/migrations.ts`) las aplicará automáticamente en el próximo `initializeDatabase()` en producción.
- Confirmar idempotencia (`CREATE TABLE IF NOT EXISTS`, `ALTER ... IF NOT EXISTS`, etc.).
- Documentar en el commit qué tablas/columnas se modifican y por qué.

### 9. Rol del agente
- **Arquitecto y administrador cloud (Microsoft Azure) con especialización FinOps.** La plataforma es Azure-only: no reintroducir abstracciones multi-cloud sin pedido explícito del usuario.
- Pensar siempre desde la perspectiva de: costo unitario, eficiencia, gobernanza, escalabilidad multi-tenant, security posture.

### 10. Selección de modelo IA
- Usar siempre el **modelo más óptimo** para la tarea:
  - Tareas simples / búsqueda: Haiku.
  - Tareas complejas / arquitectura / debugging profundo: Sonnet u Opus.
  - Generación de código extensa: Opus o GPT-5-Codex.
- Justificar el modelo elegido si difiere del default solo cuando aporte valor evidente.

### 11. Uso de sub-agentes
- Delegar a sub-agentes (`explore`, `task`, `code-review`, `general-purpose`) **siempre que se pueda paralelizar** o aislar contexto.
- Lanzar en paralelo cuando las tareas son independientes.
- Objetivo: optimizar tiempo y consumo de tokens del contexto principal.

### 12. Internacionalización (i18n)
- Toda página/UI nueva o modificada **debe** actualizar las 3 bases de idiomas: `messages/en.json`, `messages/es.json`, `messages/pt-BR.json`.
- Mantener paridad de keys (mismo número de strings en los 3 archivos).
- Nunca hardcodear strings visibles al usuario en componentes — usar `useTranslations()`.

### 13. Mocks por tier
- Cada nueva página/feature debe incluir **mocks asociados a cada tier** (Professional, Business, Enterprise) en `src/lib/mockData.ts` u otro archivo de mocks correspondiente.
- Esto permite que la demo (`/demo`) muestre la feature con datos representativos del tier seleccionado.

### 14. Auditorías de seguridad periódicas
- Ejecutar auditorías de seguridad **al menos 2 veces al mes** (cada ~15 días).
- Usar el sub-agente `security-review` sobre cambios recientes (`git diff origin/main`).
- Registrar findings en `docs/security/audit-YYYY-MM-DD.md` (severidad CRITICAL/HIGH/MEDIUM/LOW + remediación aplicada).
- Calendarizar la siguiente auditoría en `plan.md`.

### 15. Pipeline de CI/CD y modelo de ramas
- **Repositorio:** `github.com/manny864/finops`.
- **Rama `staging`:** al hacer push corren **dos** workflows en paralelo:
  1. **CI** (`.github/workflows/ci.yml`, Node 22) → `lint` (con `--quiet`: sólo errores rompen, los warnings no), `typecheck`, `test:coverage` y `build`. También corre en Pull Requests a `main`/`staging`.
  2. **Deploy to Staging** (`.github/workflows/deploy-staging.yml`) → build y push de la imagen runtime y la `-builder` en ACR, Container App Job de migraciones, actualización del Container App de staging y health check. **Existe un entorno de staging desplegado en Azure Container Apps**, no sólo validación de CI.
  Ojo: `deploy-staging.yml` **no depende** de que CI termine en verde — ambos arrancan con el mismo push.
- **Rama `main`:** al hacer push corre el workflow **deploy** (`.github/workflows/deploy-azure.yml`) → build de la imagen en ACR (dos tags: runtime y `-builder`) → Container App Job de migraciones → nueva revisión de la Container App → health check. Rollback = reactivar la revisión anterior, sin rebuild. `deploy.yml` (SSH al VPS) quedó **legacy y sólo manual**: el VPS está congelado desde el 2026-07-28, no volver a ponerle trigger de `push`.
- **Infra (`infra/terraform/**`):** un PR que la toque dispara `terraform.yml` → Checkov + Infracost + `plan`. El `apply` es **siempre manual** (`workflow_dispatch`); hay detección de drift los lunes 07:00 UTC.
- **Flujo recomendado:** push a `staging` → esperar **CI verde** → push/merge a `main` → **monitorear el deploy hasta verde** (directiva #7).
- **Importante:** ni `deploy.yml` ni `deploy-azure.yml` ni `deploy-staging.yml` corren lint/tests; el único gate de calidad es el CI en `staging`. Nunca promover a `main` con el CI en rojo.
- Sin `gh` disponible, el estado de los workflows puede consultarse por la API REST de GitHub (`/repos/manny864/finops/actions/runs`). Los logs requieren token autenticado.

### 16. Testing y validación local
- Scripts (`package.json`): `npm run lint`, `npm run typecheck`, `npm run test` (Vitest), `npm run test:coverage`, `npm run build`, `npm run migrate`.
- El CI usa el pool **forks** de Vitest (aislamiento por archivo). Correr tests en paralelo con **estado compartido** (env vars, reloj/`Date`, colas de `mockResolvedValueOnce`) puede producir falsos fallos: usar `vi.useFakeTimers`/`vi.setSystemTime` para tests dependientes de fecha y resetear/definir mocks por test.
- Antes de pushear a `staging`, validar localmente `lint` + `typecheck` + `test` cuando sea posible.

### 17. Uso obligatorio de Skills disponibles
- **Regla vinculante:** Para cualquier consulta, tarea o refactorización recibida, el agente **DEBE verificar si existe una Skill especializada disponible** en el entorno (`azure-cloud-architect`, `sql-database-assistant`, `senior-frontend`, `security-pen-testing`, `modern-web-guidance`, etc.).
- Si una Skill es relevante para la tarea actual, el agente DEBE consultar y leer el archivo `SKILL.md` correspondiente usando la herramienta `view_file` antes de proceder, y seguir strictly sus metodologías.

### 18. Denominación de Marca Obligatoria (CSCloudSolutions)
- **Regla vinculante de Marca:** El nombre oficial de la marca y empresa es **CSCloudSolutions** (todo junto, sin espacios, con mayúsculas en C, S, C, S).
- NUNCA escribir "CS Cloud Solutions", "CS Cloud", "CSCloud Solutions" u otras variaciones con espacio en interfaces de usuario, textos, videos, títulos, directivas o documentación.

### 19. Estándar obligatorio de tablas FinOps/CMP (presentes y futuras)
- **Ubicación obligatoria de filtros:** inmediatamente debajo del título/subtítulo de cada página o pestaña.
- **Filtros obligatorios en toda tabla de recursos/costos:** Recurso, Región, Tipo, Grupo de recursos.
- **Columnas obligatorias en toda tabla de recursos/costos:** Recurso, Región, Tipo, Grupo de recursos y Suscripción (mostrar **nombre**, no ID).
- **Orden obligatorio:** A-Z, Z-A, costo mayor→menor y costo menor→mayor.
- **Paginación obligatoria:** tamaños 15/30/45/60.
- **UX obligatoria:** tablas responsive, ancho completo (`w-full`, sin `max-w-*` contenedor limitante).
- **Ajuste dinámico de ancho (Column Resizing):** manejadores interactivos con cursor `col-resize` en el borde derecho de cada `<th>` (límites seguros `minWidth: 100px`, `maxWidth: 600px`).
- **Selector de visibilidad de columnas (Column Toggle):** botón desplegable `<IconColumns size={16} className="inline mr-1.5" /> Personalizar Columnas` renderizado en `z-[100]`.
- **Persistencia en navegador (LocalStorage):** ancho y visibilidad guardados automáticamente en `localStorage` bajo clave única por tenant y vista (`table_columns_config_<vista>_${tenantId}`).
- **Extensibilidad:** cada módulo puede agregar columnas específicas, pero nunca quitar los campos/filtros base.
### 20. Estándar obligatorio de Diseño Corporativo (Colores, Tipografías, Gráficas e Iconos)
- **Colores Empresariales:**
  - Títulos y encabezados: Azul empresarial profundo `rgb(27, 42, 65)` (`#1B2A41`).
  - Textos de cuerpo y etiquetas: `#1B2A41` en modo claro (`--ink: #EEF3F9` en modo oscuro).
  - Azul de acción primario / Brand Deep: `#0054A6` (CTAs, bordes activos, barras principales).
  - Azul acento / Brand Bright: `#00AEEF` (cian secundario).
- **Tipografías Obligatorias:**
  - Títulos y encabezados: `font-family: Montserrat, "Montserrat Fallback";` con color `rgb(27, 42, 65)` (`#1B2A41`).
  - Texto de cuerpo, tablas y párrafos: `font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";` con color `#1B2A41`.
- **Gráficas (Recharts / SVG):**
  - Deben utilizar estrictamente el azul empresarial (`#0054A6`, `#1B2A41`) y colores armónicos de la paleta institucional (`#00AEEF`, `#90CAF9`, `#10B981` para ahorros, `#EF4444` para alertas).
- **Iconografía Oficial:**
  - Usar exclusivamente **Tabler Icons** (`@tabler/icons-react` o SVGs oficiales de Tabler) para todos los botones, navegación, cards e indicadores de estado.

### 21. Estándar obligatorio de Botones Corporativos Clicables
- **Ver SOP:** `directivas/diseno_botones_corporativos_SOP.md`.
- **Forma:** Rectangular con bordes redondeados suaves (`rounded-lg` / `rounded-xl`).
- **Fondo:** Siempre **blanco puro** (`bg-white` en modo claro, `dark:bg-slate-900` en modo oscuro) con sutil micro-tinte en hover.
- **Borde y Texto:** El color del borde exterior debe **coincidir estrictamente** con el color del texto y del icono:
  - **Botón Primario / Control / Refresh:** Borde `#0054A6` y Texto `#0054A6`.
  - **Secuencia de Botones / Pestañas Múltiples:** Alternar armónicamente `#0054A6` (Azul), `#00AEEF` (Cian), `#10B981` (Verde), `#8B5CF6` (Púrpura), `#F59E0B` (Ámbar).
  - **Acciones Resolutivas (Optimizar ✨):** Borde y Texto `#0054A6` con fondo blanco.
  - **Copiar / Éxito:** Borde y Texto `#10B981` con fondo blanco.
  - **Cerrar / Neutro:** Borde y Texto gris suave (`border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300`) con fondo blanco.

### 22. Estándar obligatorio de Iconos Informativos con Popovers Explicativos
- **Ver SOP:** `directivas/iconos_informativos_popovers_SOP.md`.
- **Ubicación Obligatoria:**
  - En **cada título de página** (`h1`/`h2`) y encabezados principales.
  - En **cada pestaña (tab) y subpestaña** de navegación.
  - En **cada título de tabla, sección o panel** de datos.
  - En **cada tarjeta KPI** y **encabezados de columna** de tablas de recursos/costos.
- **Componente:** Usar exclusivamente `src/components/InfoTooltip.tsx` con icono Tabler `IconInfoCircle`.
- **Estilo:** Fondo azul empresarial profundo `#1B2A41` 100% opaco, texto blanco `#FFFFFF` nítido (`text-[11px] leading-relaxed`), borde sutil `slate-600`, sombra `shadow-2xl` y capa `z-[9999]`.
### 23. Lectura Obligatoria de Directivas Consolidadas y Política RBAC
- **Regla vinculante:** ANTES de iniciar cualquier tarea, implementación, corrección o refactorización, el agente **DEBE leer y consultar obligatoriamente**:
  1. `directivas/TODAS_LAS_DIRECTIVAS_CONSOLIDADAS.md` (Inventario completo y especificaciones de SOPs).
  2. `directivas/rbac_auth_multitenancy_policy_SOP.md` (Política estricta de aislamiento Mock vs. Live RBAC).
- Todo cambio debe alinearse estrictamente con los estándares y directivas documentados en estos dos archivos.

### 24. Directivas Maestras Comunes para Todos los Prompts (Arquitectura, Seguridad, Datos y UI/UX)
- **1. Política de Acceso, Autenticación y Enrutamiento (Prevención 401):**
  - **Tenants Demo** (`isMockTenant === true` / `mock=true` / prefijo `demo-`/`mock-`): Servir datos sintéticos inmediatamente sin exigir tokens OAuth ni Entra ID. ORDEN: el check `isMockTenant` se evalúa **ANTES** del guard RBAC **si y sólo si la rama mock devuelve exclusivamente literales sintéticos**. Si esa rama consulta la base de datos, Redis, Azure o cualquier estado compartido, **el guard va primero**, porque un llamador anónimo con `?tenantId=demo-x` alcanzaría ese estado (fue el finding SEC-01 de `docs/security/audit-2026-08-09.md`; la reconciliación de ambas reglas está en DOC-01 de `docs/security/audit-2026-08-21.md`). Regla mnemotécnica: **mock primero sólo si el mock no toca nada real.**
  - **Tenants Reales:** Validación obligatoria de RBAC (`requireTenantAccess`). **Tolerancia cero a fallbacks mock**: Si Azure devuelve datos vacíos (`[]` o `$0.00`), renderizar el estado real ($0.00 / Empty state legítimo). Consumir exclusivamente endpoints vivos (ARG, Cost Management / FOCUS, Monitor).
  - **Prevención de error 401 a los 11ms:** El frontend debe condicionar el fetcher (`canFetch`) a que `inProgress === 'none'` y `(accounts.length > 0 || isDemo)` antes de despachar peticiones autenticadas.
- **2. Directiva Full-Width (100% Ancho de Ventana) y Responsive con Scrollbar Visible en macOS:**
  - Layout principal, KPIs, gráficas, paneles y tablas DEBEN ocupar el ancho máximo de la ventana (`w-full max-w-full px-4 sm:px-6 lg:px-8`). Prohibido aplicar contenedores rígidos limitantes como `max-w-5xl`, `max-w-6xl` o `max-w-7xl`.
  - **Fix Crítico para Scrollbar en macOS:** En contenedores con `overflow-x-auto`, forzar la visibilidad del scrollbar horizontal mediante clases Tailwind específicas: `scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800`.
  - Celdas con texto adaptable (`min-w-[120px] max-w-[240px] truncate` con tooltip) y botones compactos que no desborden la vista.
- **3. Iconografía Tabler Exclusiva (Prohibido Emojis):**
  - Librería exclusiva: `@tabler/icons-react`. Prohibido el carácter emoji "✨" en botones o textos; reemplazar por `<IconSparkles size={16} stroke={1.5} className="inline mr-1.5 text-[#0078D4]" />`.
  - Color azul empresarial (`text-[#0078D4]` / `text-[#0054A6]`), trazo limpio (stroke 1.5/2), **estrictamente sin fondo** (`bg-transparent`).
- **4. Gestión de Capas (Z-Index):**
  - Modales y Drawers: backdrop `fixed inset-0 bg-black/50 z-50` y contenedor en `z-50` o `z-[100]`. Widgets flotantes (chat) en `z-40` o inferior.
- **5. Diseño de Interfaz y Paleta en Tonos de Azul:**
  - Contenedores y KPI cards con fondos limpios (`bg-white` o `bg-slate-50/50`) y bordes sutiles (`border border-slate-200`).
  - Banner de Selección Múltiple: `bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800` con texto `#0078D4`.
  - Badges de Problemas:
    • Hard Waste (VM apagada con discos, discos/IPs huérfanos): `bg-rose-50 text-rose-700 border border-rose-200` o `bg-amber-50 text-amber-700 border border-amber-200`.
    • Soft Waste (Sin etiquetas FinOps): `bg-blue-50 text-[#0078D4] border border-blue-200`.
    • Eximido / Whitelist: `bg-slate-100 text-slate-700 border border-slate-200`.
  - Gráficas Recharts en escala de azules armónica: Base/Real (`#0078D4`), Secundario/Forecast (`#2563EB`), Intermedio (`#0284C7`), Acento (`#38BDF8`), Neutral (`#94A3B8`).
- **6. Preservación Estricta de Lógica, Paginación y Botones Corporativos:**
  - Paginación obligatoria (15/30/45/60) con selector de página y total de registros.
  - Preservar todas las sub-pestañas y funcionalidades existentes.
  - Botones con fondo blanco puro (`bg-white dark:bg-slate-900`) y borde/texto coincidente.

---

## Resumen rápido (checklist al hacer cambios)

- [ ] ¿Leí `directivas/TODAS_LAS_DIRECTIVAS_CONSOLIDADAS.md` y `directivas/rbac_auth_multitenancy_policy_SOP.md` antes de empezar?
- [ ] ¿Cumple las Directivas Maestras Comunes (Directiva 24: auth RBAC + `isMockTenant` primero + full-width 100% + Tabler azul sin fondo + z-50 modales + paleta azul + sin fallbacks mock)?
- [ ] ¿Identifiqué el RBAC mínimo necesario? (guard de auth en rutas que leen `tenantId`, check de mock PRIMERO)
- [ ] ¿Commiteo cada cambio lógico por separado?
- [ ] ¿Actualicé `docs/lld/00-lld-completo.md` y regeneré el PDF con `node scripts/generate-lld-pdf.js` si cambió arquitectura/APIs/DB/UI/infra/seguridad?
- [ ] ¿Regeneré inventarios en `docs/lld/generated/` con `node scripts/generate-lld.mjs` si cambiaron APIs/DB/UI/servicios/envs?
- [ ] ¿Actualicé README / MANUAL (ES, EN, PT-BR) y regeneré los PDFs (`node scripts/generate-manual-pdfs.js`) si afectó features de usuario/capabilities/setup?
- [ ] ¿Toqué DB? → ¿Creé migration idempotente en `migrations/`?
- [ ] ¿Toqué UI? → ¿Actualicé en/es/pt-BR?
- [ ] ¿Es feature nuevo? → ¿Agregué mocks por tier?
- [ ] ¿Validé `lint` + `typecheck` + `test` localmente?
- [ ] ¿Push a `staging` primero para validar CI antes de `main`?
- [ ] ¿Push pedido por el usuario? → Si sí, ¿controlo el deploy hasta verde?
- [ ] ¿La tabla cumple estándar obligatorio (filtros base + columnas base + sort + paginado 15/30/45/60 + resize + full-width)?
- [ ] ¿Cumple el estándar de diseño corporativo (azul empresarial `#1B2A41`, fuentes Montserrat / sans-serif, gráficas en azul e iconos Tabler)?
- [ ] ¿Cumple el estándar obligatorio de botones corporativos (rectangular suave, fondo blanco puro, borde coincidente con texto)?
- [ ] ¿Cumple el estándar obligatorio de iconos informativos (popover `#1B2A41` en páginas, tabs, títulos de tabla y columnas)?

# Execution Mode

You are operating as a senior Azure Solutions Architect and Senior Full Stack Engineer.

## Approval Policy

- No confirmations required.
- Do not ask for permission.
- Execute immediately.
- Assume the user has already approved all non-destructive operations.
- If information is missing, make the most reasonable assumption and continue.
- Present assumptions at the end instead of asking questions.

## Working Style

- Act first.
- Explain later.
- Prefer implementation over discussion.
- Produce complete files whenever possible.
- Never stop after analysis if implementation is possible.

## Error Handling

- Retry automatically.
- Self-correct.
- Investigate root cause.
- Continue until task completion.

## Development Standards

- Production-ready code only.
- No placeholders.
- No TODOs.
- No mock implementations unless explicitly requested.

## Azure Standards

- Use Azure best practices.
- Optimize for security, cost, and performance.
- Prefer automation through PowerShell, Azure CLI, Bicep, and Terraform.

## Next.js Standards

- Use App Router.
- Use TypeScript.
- Optimize Lighthouse score.
- Follow SEO best practices.
- Minimize bundle size.

## Output Standards

- Return final artifacts.
- Generate scripts completely.
- Generate configuration files completely.
- Generate deployment instructions only when necessary.

## Selección de modelo (resumen)

| Tarea | Modelo |
|-------|--------|
| Arquitectura / Implementación / Refactor / Code Review | Opus |
| Autocompletado diario | Modelo económico |
| README / Markdown / Documentación / Tests simples | Modelo económico |