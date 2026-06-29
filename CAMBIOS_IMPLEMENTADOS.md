# Cambios Implementados (Bitácora Operativa)

Este archivo centraliza **todos los cambios realizados y futuros** del proyecto.
## 2026-06-29 — Credenciales por Expirar (live Graph) + hook order bug

### 🐛 Bug 1: `AlertRulesManager` — Rendered more hooks than during the previous render
- `usePagination(...)` se llamaba en línea 170, **después** de tres `return` early (`!selectedTenant`, `isLoading`, `error`). En el primer render, esos returns disparaban y el hook nunca se llamaba; en el segundo render se llamaba → React aborta.
- **Fix**: movido `usePagination(rules, 10)` al tope del componente, inmediatamente después de calcular `rules`, antes de cualquier return condicional. Cumple Rules of Hooks.

### 🐛 Bug 2: Credenciales por Expirar (Entra ID) vacío en mock y en producción
- **Causa real**: el endpoint `/api/governance/expiring-credentials` sólo leía la tabla `ExpiringCredentials` (snapshot estático). En producción nadie llenaba la tabla → siempre vacía. En mock las fechas estaban hardcodeadas a julio/agosto/septiembre 2026.
- **Fix `src/app/api/governance/expiring-credentials/route.ts`** (reescrito completo):
  - **Live Microsoft Graph query**: token client_credentials con `client_id/client_secret` del tenant, GET paginado `/applications?$select=appId,displayName,passwordCredentials,keyCredentials`. Extrae secretos y certificados con `endDateTime <= now + daysAhead`. Devuelve datos AUTORITATIVOS en tiempo real.
  - **Mock con fechas relativas**: 2/12/28/65 días desde hoy (no más fechas hardcoded que envejecen). Severity calculada automáticamente (≤7 crítico, ≤30 alto, ≤60 medio, resto bajo).
  - **Snapshot DB best-effort**: cada llamada live persiste resultados en `ExpiringCredentials` para fallback offline. Si Graph falla, devuelve último snapshot con warning.
  - **Auth fix**: reemplazado `jwt.decode` por `requireTenantAccess(request, tenantId, { allowSuperAdmin: true })` (valida firma RS256 contra JWKS de Entra). Cierra brecha de cross-tenant con token forjado.
  - **Mensaje sin SP**: si el tenant no tiene `client_id/client_secret`, devuelve `code: NO_SP_CREDS` con instrucción de completar onboarding (en vez de 500 silencioso).

### Verificación
- `npx tsc --noEmit` → 0 errors.
- Para validar live: crear un nuevo secret en cualquier App Registration del tenant con expiración ≤ daysAhead (default 90), recargar `/governance` y debe aparecer en máximo 1 request (sin cache intermedio).

---

## 2026-06-29 — Dashboard lento / cards inconsistentes (root-cause + fix)

### 🐢 Síntoma
- En tenants reales, las tarjetas superiores del dashboard (costo actual, proyectado, ahorros, anomalías) cargaban a veces sí y a veces vacías.
- Lentitud generalizada al recargar.

### 🔍 Causa raíz
1. **`/api/dashboard/summary` lanzaba 500 si `/api/intelligence/forecast` fallaba** (el fix previo de anti cache-poisoning era demasiado estricto): cualquier flaqueza transitoria de Azure SDK tiraba abajo TODO el dashboard.
2. **Sub-fetches sin timeout**: si `audit/full` tardaba 30s, el endpoint completo se quedaba colgado.
3. **TTL corto** (300s hard / 150s soft): expiraba antes que SWR pudiera servir versión válida.
4. **Forecast era la única fuente de `actualCost`**: si la API de forecast no respondía, las cards quedaban en `$0`.

### 🛠 Fix (`src/app/api/dashboard/summary/route.ts`)
- **Cache versionada `v4`** con TTL más generoso: **hard 900s (15m)** / **soft 300s (5m)**. SWR ahora puede servir stale durante 10 minutos mientras revalida en background.
- **`timedFetch(url, ms)`** con `AbortController`: audit (18s), forecast (12s). Ninguna sub-llamada bloquea más allá de su límite.
- **`Promise.all` con `.catch`** sobre cada sub-fetch: una falla NO mata al dashboard. Se retorna `degraded: true` + `degradedReason` y la UI puede pintar lo que tiene.
- **`fetchActualCostMTD(tenantId, subscriptionId)`**: nueva fuente primaria para `actualCost`, leyendo directo de `CostSnapshots` (mismo mes). DB local, <50 ms.
- **Proyección lineal de fallback**: si forecast no responde pero hay MTD, `projectedCost = MTD * (diasMes / diaActual)`. El usuario siempre ve un número razonable.
- **Sin más throws en el fetcher de SWR**: el cache se escribe SIEMPRE que el handler termine, evitando el ciclo "500 → cache vacío → 500 otra vez".

### 📊 Efecto esperado
- Primera carga fría: ≤18s (timeout duro de audit).
- Cargas calientes (los 5-15 min siguientes): <50 ms (servido desde Redis).
- Cards superiores: siempre con valores (MTD directo de DB).
- Anomalías transitorias de Azure: dashboard sigue funcional con banner `degraded`.

---

## 2026-06-29 — Partner Billing CSP, Alertas con budget, selectores legibles

### 💲 Partner Billing Engine (CSP) — mensaje informativo cuando no hay CSP
- **Síntoma**: la página mostraba `Error: Fallo al obtener margen (markup)` en tenants reales sin Partner Center conectado, incluso en tenants con CSP activo (mensaje genérico ocultaba la causa).
- **Causa**: el GET retornaba 500 ante cualquier excepción y el frontend pintaba un panel rojo.
- **Fix backend** (`src/app/api/admin/billing-markup/route.ts`):
  - Nueva heurística `detectCspConnection(tenantId)` que verifica `CostSnapshots.billing_profile_id IS NOT NULL` (campo poblado por sync FOCUS de Partner Center).
  - Respuesta siempre **200** si el tenant existe y es Enterprise, con `cspDetected: boolean` y `message` informativo cuando es `false`.
  - Errores reales devuelven 500 con `details` (mensaje real, antes oculto).
- **Fix frontend** (`src/components/dashboard/PartnerMarkup.tsx`):
  - Panel ambar informativo cuando `cspDetected === false` (en lugar de error rojo).
  - Mantiene panel rojo solo para errores reales.

### 🔔 Alertas Self-Service — definir Budget destino
- **Síntoma**: las reglas tipo `budget` no decían a qué presupuesto se vinculaban.
- **Schema** (`src/modules/storage/db.ts`):
  - Nueva columna `AlertRules.budget_id INT NULL` con migration `ALTER TABLE` idempotente.
- **API** (`src/app/api/budgets/alerts/route.ts`):
  - GET ahora hace `LEFT JOIN Budgets` y devuelve `budgetId` + `budgetName` en cada regla.
  - POST valida que `ruleType === "budget"` requiera `budgetId` (400 si falta).
- **UI** (`src/components/dashboard/AlertRulesManager.tsx`):
  - Carga paralela de `/api/budgets` vía SWR.
  - Selector "Budget asociado *" aparece sólo cuando `ruleType === "budget"`.
  - Si no hay budgets configurados: aviso con CTA a Inteligencia → Budgets.
  - Cada fila de la tabla muestra `Budget: <name>` bajo el nombre de la regla cuando aplica.

### 🎨 Workbooks/Artefactos — selectores blanco sobre blanco
- **Síntoma**: en macOS Chrome/Safari, los `<select>` de suscripción y RG en `/admin/workbooks` mostraban texto blanco sobre fondo blanco (ilegible) cuando el `<select>` se rendereaba con widget nativo del OS.
- **Causa**: utilidades Tailwind `dark:text-white` ganaban especificidad sobre el rule global, y `color-scheme: light dark` dejaba al browser elegir contra el OS, no contra el theme de la app.
- **Fix global** (`src/app/globals.css`):
  - `select` ahora fuerza `color-scheme: light` con `background-color: #ffffff !important` y `color: #0f172a !important`.
  - `.dark select` fuerza `color-scheme: dark` con `#1e293b / #f1f5f9 !important`.
  - Aplica a TODAS las páginas con `<select>` (no solo Workbooks).

---

## 2026-06-29 — Auditoría: mock leaks en tenants reales, JWT signature, RBAC

Auditoría de cierre tras la sesión previa. Tres ejes: (1) datos mock filtrándose a tenants reales, (2) brechas de seguridad, (3) actualizaciones/warnings.

### 🧪 Mock/hardcoded → tenants REALES (TODOS corregidos)
- **Síntoma**: rutas `/api/intelligence/*` y `/api/copilot-m365/*` retornaban números fabricados también a tenants reales (no sólo DEMO).
- **Causa**: defaults inventados (`Math.random()`, `300 + (i%7)*12`, `baseCost ?? 10000`), placeholders `"demo-aks-cluster"`, `delta` aleatorio en reindex.
- **Fixes**:
  - `unit-economics`: DAU se lee de tabla `BusinessMetrics`; si no hay fuente, devuelve `dau:null`/`costPerUser:null` (sin Math.random).
  - `copilot-m365/config` reindex: ya no incrementa `indexed_records` con random; sólo actualiza `last_index_at` y deja que el conector real lo refleje en el próximo poll.
  - `intelligence/forecast` POST: histórico real desde `CostSnapshots` (mes actual); si <2 días con costo retorna `empty:true`. Sin budget explícito, no se inventa `8000`.
  - `intelligence/aks-chargeback`: defaults `"mock-sub"/"demo-aks-cluster"/"MC_demo"` → cadenas vacías (ya hay fallback `empty:true`).
  - `intelligence/simulator`: `baseCost` se deriva del gasto real (CostSnapshots últimos 30d); si no hay, exige `scenario.baseCost`. Se elimina el default `10000`.

### 🔐 Seguridad — vulnerabilidades CRITICAL/HIGH corregidas
- **CRITICAL — `/api/admin/payments` sin auth**: GET filtraba `PADDLE_API_KEY`/`PADDLE_WEBHOOK_SECRET` y POST permitía sobrescribir los secretos de forma anónima → robo de webhook signing key. Fix: `requireSuperAdmin`, redact en GET, allowlist de campos en POST.
- **HIGH — `/api/admin/config/webhook` sin auth real**: aceptaba cualquier `Authorization` y permitía sobrescribir `webhook_url` de cualquier tenant (SSRF / exfiltración). Fix: `requireTenantAccess` + validador `isSafeWebhookUrl` (sólo HTTPS pública; bloquea RFC1918, loopback, link-local, metadata Azure 169.254.169.254).
- **HIGH — `/api/remediation/workflow` GET cross-tenant**: query `?tenantId=` ignoraba el tenant del token. Fix: `requireTenantAccess(...,{allowSuperAdmin:true})` en GET/POST/PATCH. Quitado `authenticateRequest` con `jwt.decode`.
- **CRITICAL (parcial) — `jwt.decode` sin verificar firma**: ~60 rutas usaban `jwt.decode` y derivaban SuperAdmin sólo del email (forjable). Reemplazado en las rutas más explotables:
  - `/api/superadmin/tenants/create`, `/api/superadmin/users/promote`
  - `/api/admin/tenants` (POST/PATCH tier escalation)
  - `/api/admin/config/users` (GET/POST/PUT/DELETE — gestión de usuarios y elevación de roles)
  - `/api/admin/payments`, `/api/admin/config/webhook`, `/api/remediation/workflow`
  - Todas ahora pasan por `requireRequestIdentity` / `requireTenantAccess` / `requireSuperAdmin` (`src/lib/requestAuth.ts`) que valida RS256 contra JWKS de Entra, `iss`, `aud`, `exp`, `nbf`.
  - **Pendiente**: ~55 rutas restantes siguen con `jwt.decode` (rutas de lectura: billing, advisor, budgets, intelligence/*, governance/*, cleanup/*, etc.). Riesgo residual: lectura cross-tenant si token está forjado. Mitigado parcialmente porque las queries SQL filtran por `tenantId` y la mayoría requiere que coincida con `decoded.tid`. Acción en sprint siguiente: sweep automatizado.
- **HIGH — `/api/power` POST sin RBAC**: cualquier miembro autenticado del tenant podía apagar VMs. Fix: nuevo helper `requireTenantRole(request, tenantId, ['Admin','Operator'])` en `requestAuth.ts`. SuperAdmin corp pasa sin chequear role.

### 📦 Actualizaciones & warnings
- **npm audit**: `0 vulnerabilities` ✅
- **tsc --noEmit**: `0 errors` ✅
- **Pendientes accionables** (no bloqueantes):
  - Major bumps disponibles: `@ai-sdk/*` 3→4, `ai` 6→7, `@azure/arm-appservice` 18→19, `@types/node` 20→26, `typescript` 5→6, `eslint` 9→10. Requieren revisión de breaking changes.
  - ESLint sin archivo de config (`.eslintrc*` o `eslint.config.js`). Recomendación: `eslint.config.js` con preset Next 16.
  - 308 `console.error/warn` en `src/` (logger estructurado en próxima iteración).
  - 2 `@ts-ignore` (FocusCostPieChart, CostPieChart) y 1 `eslint-disable react-hooks/exhaustive-deps` (admin/report).
  - 2 TODOs de integración real con Paddle Checkout (`/api/tenants`, `/api/checkout`).

### 🆕 Helper nuevo
- `src/lib/requestAuth.ts`: añadido `requireTenantRole(request, tenantId, allowedRoles)` que combina tenant gate + lookup en tabla `Users.role`.

---

## 2026-06-29 — Estabilidad del dashboard, Reporte Ejecutivo IA, Copilot M365 datos reales

Sesión amplia de bugfixes y features sobre dashboard, copilot, reportes y horario de apagado.

### 🔧 Estabilidad dashboard — anti cache-poisoning
- **Síntoma**: tarjetas (costos, proyección, ahorro) y panel HA mostraban datos distintos en cada refresh; histograma vacío en tenants reales.
- **Causa raíz**: `getWithStaleWhileRevalidate` cacheaba resultados parciales/vacíos cuando alguna fuente Azure fallaba transitoriamente → próximos refreshes veían valores inconsistentes hasta expiración.
- **Fixes**:
  - `src/app/api/dashboard/summary/route.ts`: **throw** si audit falla (no cachear); forecast tolerante pero también throw → cache nunca queda envenenada. Cache key bumpeada a `v3`.
  - `src/services/haService.ts`: 11 queries ARG ahora corren en **paralelo en chunks de 4** (más rápido + menos throttling). Si >30% queries fallan → throw → no se cachea resultado parcial → siguiente refresh reintenta fresh.
  - SWR sirve la última versión válida si hay; o falla limpio. Nunca más fluctuación.

### 📊 Histograma de costos
- **Síntoma**: en tenants reales no mostraba datos; en mock funcionaba.
- **Causa raíz**: `/api/intelligence/billing` solo devuelve MTD (mes actual) → inútil para histograma de 6/12 meses; además leía credenciales desde **headers** y el summary los pasaba como query params (400 silencioso).
- **Fix**: `src/app/api/dashboard/summary/route.ts` ahora lee directo de `CostSnapshots` (FOCUS) últimos 365 días agregado por fecha. Fallback a `getCurrentMonthAmortizedCosts` (live Azure CM) si la DB está vacía. Bypass completo del intermediario `/api/intelligence/billing`.

### 💾 Redis SWR cache nuevo
- `/api/governance/ha` → key `ha:summary:v1:<tenantId>` SWR 15min/5min sobre `evaluateHALive`
- `/api/intelligence/aks-chargeback` → key `aks:chargeback:v1:<tenant>:<sub>:<cluster>` SWR 30min/10min
- Reduce llamadas a Azure ARG y Cost Management; mejora latencia perceived.

### 🎨 FinOps Copilot (global widget)
- **Ícono +2px**: `w-14 h-14` → `w-16 h-16`; ícono interior `w-6` → `w-7`.
- **Animación periódica** cuando está minimizado: halo `copilot-ping` cada 4s (1.6× scale, fade out) + anillo `copilot-pulse` 2.4s permanente. Se desactivan cuando está abierto.
- **Tooltip on hover**: caja oscura con texto descriptivo i18n (es/en/pt-BR clave `Copilot.tooltip`), `aria-label` para accesibilidad.
- **One-shot per sesión**: eliminado timer 7s. Ahora usa `sessionStorage.copilot_shown_session` → abre solo la primera vez. Si el user lo cierra → permanece cerrado el resto de la sesión. Si lo abre manualmente → normal.
- **Ventana inicial**: 384×500 → 460×620 (mejor lectura del reporte streaming).
- **Tablas Markdown**: instalado `remark-gfm` + estilos para tablas GFM en el chat.

### 📑 `/admin/report` — Reporte Ejecutivo Integral IA-driven
Reescritura completa de la página de reporte ejecutivo siguiendo el framework de la FinOps Foundation (5 secciones canónicas).

**Datos en vivo (12 fuentes, fetch paralelo tolerante a fallo):**
audit + dashboard summary + HA + forecast + tags/compliance + commitments + anomalies + rightsizing + budgets + hybrid-benefit + chargeback + history.

**KPI strip x10** (2 filas):
- Fila 1: MTD (con % MoM) · Proyección · Ahorro mensual+anual · HA Críticos+Altos · CO₂
- Fila 2: Tagging % · Commitments % · Right-sizing · Anomalías · Budget burn

**Análisis IA streaming** (auto al cargar; botón "Regenerar IA"):
- Llama a `/api/intelligence/copilot` con payload estructurado completo
- Prompt en 5 secciones FinOps Foundation: 1️⃣ Resumen Alto Nivel · 2️⃣ Visibilidad y Asignación · 3️⃣ Oportunidades · 4️⃣ Gobernanza y Anomalías · 5️⃣ Recomendaciones Estratégicas (plan 30/60/90)
- Render Markdown con `remark-gfm` (tablas), texto justificado y contenido dentro de la caja sombreada (`break-words`, `overflowWrap`, `max-w-full` en tablas).

**Secciones visuales adicionales en el PDF export:**
- Top Centros de Costo (chargeback)
- Anomalías de costo con impacto
- Top recomendaciones Right-sizing (SKU actual→recomendado, ahorro)
- Barra visual de ejecución presupuestaria (verde/ámbar/rojo según burn)
- Tabla HA Top 20 con severidad colorizada

**Backend Copilot:**
- `src/app/api/intelligence/copilot/route.ts`: payload truncation 2KB→8KB, `maxOutputTokens` 800→2500, system prompt permite reportes extensos (~900-1200 palabras) cuando se piden.
- `src/lib/copilotPayload.ts`: Top-N 5→10, strings 120→160 chars, total 2000→8000 chars.

### 🤖 Copilot M365 — defensive backend + datos reales
- **Errores i18n MISSING_MESSAGE `statuses.undefined`**: `config.status` llegaba undefined cuando la API devolvía `{config: {}}`. Fix:
  - Backend `src/app/api/copilot-m365/config/route.ts`: try/catch interno en query DB → fallback `not_configured` en lugar de 500; el catch externo nunca devuelve 500 (siempre `not_configured` + warning).
  - Frontend `src/components/dashboard/M365CopilotConfigPanel.tsx`: `safeStatus` valida `config.status` contra enum válido; reemplazadas las 6 referencias.
- **Mock DEMO con 0 registros**: el interceptor en `TenantProvider` devolvía `{config: {}}`. Ahora devuelve config completa con `status: 'ready'`, `indexedRecords` escalado por tier (×1/2/5), connectorId, agentId, lastIndexAt.
- **Fix crítico — valores hardcoded en tenants reales**: `/api/copilot-m365/ask` devolvía respuesta hardcoded "Virtual Machines $18,200" para TODOS los tenants. Reescritura:
  - Tenants reales → `buildRealAnswer()` consulta `CostSnapshots` últimos 30 días → total + top 5 servicios + anomalías reales. Si no hay datos → mensaje claro "verifique sincronización billing/permisos Cost Management".
  - Tenants DEMO → respuesta sintética prefijada `[DEMO]` con nota explicativa.
  - Adaptive Card dinámica desde datos reales, no valores estáticos.

### ⚡ Horario de Apagado (Power)
- **Síntoma**: comando "Apagar" reportaba OK pero no apagaba VMs (en DEMO siempre, en real a veces).
- **Causa raíz DEMO**: interceptor catch-all devolvía data de `schedules` con 200 OK → UI mostraba "exitosamente" engañoso.
- **Causa raíz real**: si el SP no tenía rol `Microsoft.Compute/virtualMachines/deallocate/action`, `beginDeallocateAndWait` lanzaba pero se enmascaraba como 403 genérico; además sin refetch de estado, el user no veía cambio.
- **Fixes**:
  - `src/components/TenantProvider.tsx`: handler dedicado para POST `/api/power` → devuelve `{simulated: true, message: '[DEMO]...'}` en DEMO.
  - `src/components/dashboard/PowerSchedules.tsx`: toast distintivo "🧪 [SIMULACIÓN DEMO]" para mock; toast.success para real. Refetch automático a los 5s post-acción (ARG cache eventual consistency). Errores per-VM detallados en el toast.
  - `src/app/api/power/route.ts`: distingue `AuthorizationFailed` (403 con mensaje claro sobre rol `Virtual Machine Contributor`) de skips por CPU threshold (200 partial). Invalida `vmCache` post-acción para refrescar powerState.

### 🏢 Onboarding directorio de entornos (super-admin)
- Reemplazado dropdown por **lista responsive colapsable** (acordeón single-active).
- Vista colapsada: solo Nombre + Tenant ID + chevron.
- Expandida: grid 2-col (1-col móvil) con Client ID, Secret, Save.
- **Filtro de búsqueda** texto contains case-insensitive en id/nombre/client_id; contador `N/Total`; botón Limpiar.
- **Paginación 5 entradas/página** con selector `[5,10,25]`; reset auto al cambiar query.

### 📋 Policies as Code
- **Dedup pestañas**: cambio de dedup por `targetMg` (id) a **dedup por label normalizada** (`label.toLowerCase()`) → no más pestañas visualmente duplicadas con mismo nombre pero diferente id.
- **Estilo navegador**: pestañas con `border-b-0`, `rounded-t-lg`, línea base con span blanco que "rompe" bajo la activa.
- **Resolución de nombres**: helper `resolveScopeName(scope)` con cascada (MG.id/name → Sub.id → path `/managementGroups/...` → path `/subscriptions/<uuid>` → UUID suelto → "TenantRootGroup" → raw). Aplicado en pestañas + badge de scope.
- **Backend KQL fix**: `/api/admin/governance-policies` ahora hace `join leftouter` con policy/policySet definitions por `policyDefinitionId` → trae `defDisplayName` real en lugar del GUID del assignment cuando falta `properties.displayName`. Cascada de fallback con normalización. Cache key bumpeada a `v2`.

### 🛡️ Página HA (Alta Disponibilidad)
- **Nueva columna "Tipo de Recurso"** con badge pill (shortType formateado).
- **Eliminado el subtítulo mono** debajo del nombre que mostraba `Microsoft./tipo_recurso`.
- Fix **rules-of-hooks**: `usePagination` movido antes de returns condicionales (loading/error/null tenant).
- Mock enrichment: MOCK_ITEMS de 5 → 20 items cubriendo VMs/SQL/AKS/Cosmos/Postgres/MySQL/Storage/Redis/PIP/ASP. Cuando es tenant DEMO, multiplier por tier (×1/×2/×5).
- Servicio refactorizado a **11 queries ARG independientes por tipo de recurso** (`vm_no_zone`, `vm_in_avset_no_zone`, `pip_basic`, `storage_lrs`, `sql_no_failover`, `aks_no_zone`, `asp_single_instance`, `pg_flex_no_ha`, `mysql_flex_no_ha`, `redis_non_premium`, `cosmos_single_region`). Fix clave: `coalesce(zones, dynamic([]))` para que `array_length()` no devuelva null.
- Diagnostics expuestos por query en el response (`perQuery: {count, error?}`).

### 📈 Dashboard widgets nuevos (tier-gated)
- `src/components/dashboard/HABreakdownCard.tsx`: pie chart Recharts agrupado por tipo de recurso (Business+).
- `src/components/dashboard/AksChargebackCard.tsx`: pie top 8 namespaces (Enterprise+).
- Integración no-breaking: si el layout guardado en localStorage no tiene `ha`/`aks` keys, se agregan automáticamente sin romper la disposición del usuario.

### 🌐 i18n nuevas claves
- `HA.issueTypes.basic_sku`, `HA.issueTypes.low_capacity` (es/en/pt-BR)
- `Copilot.tooltip` (es/en/pt-BR)

### ✅ Validación
- `tsc --noEmit`: ✅ sin errores
- `remark-gfm` agregado como dependencia (tablas Markdown)

---


## 2026-06-28 (later 3) — Banner DEMO unificado + mocks faltantes

### Banner reutilizable
- Nuevo componente `src/components/MockBanner.tsx`: auto-detecta entorno DEMO leyendo `isMockTenant(selectedTenant.id)` desde `TenantProvider`, o acepta prop `show` para forzar visibilidad cuando la API responde `data.mock === true`.
- Texto centralizado en i18n (`Mock.badge`, `Mock.description`) — visible en es/en/pt-BR.
- Mensaje estándar: **"DATOS DE EJEMPLO: Estás viendo datos simulados. Conecta tu suscripción Azure para ver datos reales."**

### Páginas con banner agregado (10)
- `/advisor`, `/overview/sustainability` (Green FinOps), `/intelligence/budgets`, `/intelligence/rightsizing`, `/intelligence/licenses`, `/cleanup/ttl`, `/governance/tags`, `/governance/policies`, `/remediation/approvals`, `/admin/payments`.

### Mocks de endpoints añadidos al interceptor (`TenantProvider`)
- `/api/intelligence/sustainability` → `sustainability` (ya existía).
- `/api/governance/policies` → `governance-policies` (ya existía).
- `/api/remediation/workflow` → **nuevo case `approvals`** con 5 solicitudes (Pending / Approved / Rejected).
- `/api/billing/portal` → **nuevo case `payments`** con plan Enterprise, método de pago Visa •4242, 3 facturas pagadas y URL al portal de Stripe.

### Validación
- `tsc --noEmit`: ✅
- Smoke HTTP 200 en las 11 rutas listadas.

---

## 2026-06-28 (later 2) — Fix AADSTS700016 por comilla parásita en client_id

### Síntoma
Verificación de SP fallaba con:
> AADSTS700016: Application with identifier '7f62342f-…-9877ee0d99cd"' was not found

Nótese el `"` final dentro del ID.

### Causa raíz
La columna `Tenants.client_id` se persistía sin sanitizar. Al pegar el JSON de salida del script PowerShell de onboarding desde el formulario, una comilla doble se incluía como parte del valor (37 chars en vez de 36). Confirmado con `SELECT LENGTH(client_id)`.

### Fix
1. **DB limpiada**: `UPDATE Tenants SET client_id = TRIM(BOTH '"' FROM TRIM(client_id))`. Aplicado también a `client_secret` y `tenant_id`.
2. **Sanitización al escribir** (`src/app/api/tenants/route.ts` PUT): helper `clean()` strip whitespace y `^["']+|["']+$`, además valida formato UUID antes de insertar; devuelve 400 con mensaje claro si el `clientId` no es UUID.
3. **Sanitización al leer** (`src/lib/azure.ts#getAzureCredential`): aplica `clean()` a `client_id`, `client_secret` y `tenantId` antes de construir `ClientSecretCredential`. Defensa para tenants legacy.
4. **Mismo patrón** aplicado en `src/services/tenantHealthService.ts#verifyTenantCredentials`.

### Validación
- `tsc --noEmit`: ✅
- Row corregida en DB: `LENGTH(client_id)` = 36.

---

## 2026-06-28 (later) — Artefactos & Workbooks: UI + permisos

### Bug visual: `<select>` con texto invisible (white-on-white)
- Causa raíz: navegadores (Chrome/Safari en macOS) renderizan `<option>` con colores del sistema operativo e **ignoran** las clases Tailwind aplicadas. El dropdown abierto mostraba texto blanco sobre fondo blanco cuando el theme de la página y el del OS no coincidían.
- Fix global en `src/app/globals.css`: regla CSS para `select` con `color-scheme: light dark` y colores explícitos para `select option` (light: `#fff` / `#0f172a`; dark: `#1e293b` / `#f1f5f9`). Esto corrige **todas** las páginas con selects nativos (no solo Workbooks).

### Permisos del Service Principal (Workbooks - Tier Enterprise)
Detectados gaps en el script de onboarding Enterprise (`src/lib/onboardingScriptTemplate.ts`):
- ❌ `Microsoft.Insights/workbooks/write` → necesario para desplegar workbooks.
- ❌ `Microsoft.Resources/subscriptions/resourceGroups/write` → necesario para el botón "+ Crear Nuevo RG" del modal.

**Cambios aplicados al tier Enterprise:**
- ➕ Añadido rol built-in `Monitoring Contributor` (incluye `Microsoft.Insights/workbooks/write` y métricas avanzadas).
- ➕ Añadida action `Microsoft.Resources/subscriptions/resourceGroups/write` al custom role.

### UX de errores
- `/api/admin/workbooks/route.ts`: el catch genérico ahora parsea `code`/`body.error.code`/`body.error.message` de Azure. Detecta `AuthorizationFailed` y devuelve 403 con mensaje accionable indicando exactamente qué rol falta y cómo remediar (re-ejecutar onboarding Enterprise).
- Tooltip de la página `/admin/workbooks` actualizado con la lista correcta de roles requeridos.

### Validación
- `tsc --noEmit`: ✅
- Smoke `/es/admin/workbooks`: HTTP 200.

---

## 2026-06-28 — FinOps Toolkit Gap Closure (P2 + P3 + P4)

Implementación masiva de 15 features inspirados en `microsoft/finops-toolkit` con datos mock, i18n triple (es/en/pt-BR), protección por tier y banners de modo demo.

### Schema (`src/modules/storage/db.ts`)
- **+11 tablas nuevas**: `AICostSnapshots`, `MACCCommitments`, `AppServiceRecommendations`, `SqlDbRecommendations`, `StorageRecommendations`, `VmssRecommendations`, `HARecommendations`, `AlertRules`, `ExpiringCredentials`, `TenantDelegations`, `M365CopilotConfig`.
- **+3 columnas** en `CostSnapshots`: `billing_profile_id`, `invoice_section_id`, `customer_id` (soporte EA/MCA/CSP para Invoicing Report).

### Sidebar / Routing / i18n
- `Sidebar.tsx`: 8 entries nuevos (5 en Inteligencia, 2 en Gobernanza, 1 en Admin) + iconos `HardDrive`, `BellRing`, `Sparkles`, `Briefcase`, `KeyRound`, `Bot`, `Layers`, `ShieldCheck`.
- `routeTiers.ts`: 9 rutas registradas (auto-protegidas por `RouteTierGate`).
- `messages/{es,en,pt-BR}.json`: 10 namespaces nuevos + keys en `Navigation` + features por tier en `pricing`.

### P2 Quick Wins (Pro / Business)
- **IT-10 Storage Efficiency**: `/intelligence/storage-efficiency` + `/api/intelligence/storage-efficiency`. Simula ahorros por movimiento Hot→Cool→Archive y deduplicación.
- **IT-11 Compute $/Core**: `/intelligence/compute-efficiency` + `/api/intelligence/compute-cost-per-core`. Usa `vmSizeToCores()` del módulo AKS.
- **IT-14 Alertas self-service**: `/intelligence/alerts` + `/api/budgets/alerts` (CRUD) + `/api/budgets/alerts/[id]`.
- **IT-15 Networking Zombies**: `/cleanup/zombies/networking` + `/api/cleanup/zombies/networking` (LBs vacíos, NSGs sin asociación, Public IPs sin attach).

### P2 Enterprise
- **IT-01 AI Analytics**: panel de consumo Azure OpenAI (tokens, $/1k, modelos), `/intelligence/ai-analytics`.
- **IT-04 MACC Tracker**: trazabilidad de compromiso EA/MCA, `/intelligence/macc`.
- **IT-02 Invoicing Report**: `/admin/report` con export JSON / CSV / PBIT stub vía `/api/admin/report/invoicing`.

### P3 Rightsizing & Governance
- **IT-07 Rightsizing VMSS**: `/intelligence/rightsizing/vmss` + `/api/rightsizing/vmss`.
- **IT-03 Rightsizing extendido**: 3 nuevas verticales `/intelligence/rightsizing/{appservice,sqldb,storage}` con APIs dedicadas.
- **IT-12 HA Recommendations**: `/governance/ha` + `/api/governance/ha` (VMs sin zona/availability set).
- **IT-16 Credenciales AAD por expirar**: `/governance/credentials` + `/api/governance/expiring-credentials` (umbral configurable 30/60/90 días).
- **IT-18 Lighthouse onboarding**: `/admin/onboarding/lighthouse` + `/api/onboard/lighthouse` (POST descarga `armTemplate.json`).

### P4 M365
- **IT-17 M365 Copilot**: `/admin/copilot-m365` + `/api/copilot-m365/config` + `/api/copilot-m365/ask`. Config de tenant + chat RAG sobre datos FinOps locales.

### Patrón mock-first universal
- Cada endpoint nuevo verifica `isMockTenant(tenantId)` desde `src/lib/mockData.ts` y retorna respuesta sintética rica.
- Si el path real falla, fallback con flag `mock: true`.
- Cada componente cliente muestra `MockBanner` (ámbar) usando namespace `Mock` cuando `data.mock === true`.

### Validación
- `npx tsc --noEmit`: ✅ verde tras toda la implementación.
- Smoke test HTTP 200 en: `/es/governance/credentials`, `/es/governance/ha`, `/es/intelligence/rightsizing/{vmss,storage}`, `/es/admin/onboarding/lighthouse`.

### Archivos creados (resumen, 39 nuevos)
- 15 endpoints en `src/app/api/**`.
- 13 componentes en `src/components/dashboard/**` (Dashboards, Panels, RightsizingTabs).
- 11 page wrappers en `src/app/[locale]/**`.

---

## 2026-06-27

### Seguridad y control de acceso
- Se incorporó validación robusta de identidad JWT/JWKS con guardas reutilizables en backend.
- Se migraron rutas críticas a autorización por tenant (`requireTenantAccess`) y rol.
- Se reforzó validación de webhook de pagos con controles de firma y ventana temporal.
- **Token MSAL fresco automático**: nuevo helper `getFreshIdToken()` + `fetchWithAuthRetry()` en `src/lib/msalToken.ts`. Decodifica el `exp` del JWT y fuerza refresh si quedan <5 min; retry automático en 401. Aplicado a 18 páginas (eliminados todos los `acquireTokenSilent` directos).

### Onboarding y RBAC (script PowerShell)
- **Roles por tier** redefinidos en `src/lib/onboardingScriptTemplate.ts`:
  - **Essential**: `Reader`, `Cost Management Reader`, `Monitoring Reader`, `Billing Reader` (antes faltaban los últimos dos → causa silenciosa de "0 consumos en Cost Management").
  - **Professional**: Essential + `Tag Contributor`.
  - **Business**: Pro + custom role mínimo (VM start/stop/restart/deallocate, tags/write).
  - **Enterprise**: Business + custom role expandido (disks/snapshots/NICs/PublicIPs/NSGs delete).
- **Eliminado** `Virtual Machine Contributor` y `Desktop Virtualization Power On Off Contributor` (otorgaban permiso de borrar VMs).
- **Nueva función `Try-AssignRole`** registra éxito/fallo de cada asignación (antes `-ErrorAction SilentlyContinue` ocultaba 100% de los errores).
- **Resumen final** en el script con conteo OK/Failed y tabla detallada de fallos.
- Idempotente: detecta asignaciones existentes y las marca como `AlreadyExists`.
- Output JSON incluye `Tier`, `AssignmentsOk`, `AssignmentsFailed`.

### Diagnóstico automático de permisos SP
- Nuevo endpoint `GET /api/admin/check-sp-roles?tenantId=...` que verifica automáticamente, sub por sub, qué roles tiene el SP y cuáles faltan según el tier contratado. Devuelve recomendaciones específicas de remediación.
- Backend `/api/intelligence/billing` ahora distingue 5 escenarios cuando devuelve 0 filas (antes era genérico): `NO_SUBSCRIPTIONS`, `NO_SUBSCRIPTION_ACCESS`, `NO_COST_PERMISSION`, `NO_CONSUMPTION`, `SUBSCRIPTION_INACTIVE`, `NO_CONSUMPTION_THIS_MONTH`.
- Nueva función `getCurrentMonthAmortizedCostsWithDiagnostics` captura errores per-sub (antes se tragaban con `.catch(() => null)`).
- Fallback automático a "últimos 30 días" cuando MTD vino vacío, para distinguir suscripción inactiva vs período sin consumo.
- Frontend muestra toast accionable con el escenario detectado y la sugerencia de fix.

### Cache SWR estabilizado
- `src/lib/cache.ts`: `getWithStaleWhileRevalidate` ahora usa **soft TTL + hard TTL** (envelope con timestamp). Dentro del soft TTL (50% por defecto) NO revalida — refreshes consecutivos devuelven el MISMO valor.
- Deduplicación in-flight: si N requests llegan simultáneos a misma key, solo se dispara 1 fetch al origen.
- Fix de "valores diferentes en cada refresh" en Progreso Histórico.

### Internacionalización y UI
- Se ajustó Azure Advisor para respetar el idioma activo del usuario (ES/EN/PT-BR) con normalización de locale.
- Nuevo `src/lib/advisorI18n.ts` con dictionary regex para traducir recomendaciones (~20 patrones de Cost/Security/HA/Performance).
- Faltantes corregidos en `messages/{es,en,pt-BR}.json` namespace `Billing`: `cost_optimization`, `inactive_resources_cat`, `leak`.
- FinOps Copilot: contraste arreglado (`bg-brand-deep` en lugar de `bg-brand` inexistente).

### FinOps Copilot — Rendimiento
- Switch a `streamText` + `toTextStreamResponse()` (SSE) en `/api/intelligence/copilot`. Latencia percibida ~10x menor.
- Cache in-memory (TTL 5min) de AI config en `aiProvider.ts` (`getCachedAIConfig`).
- Nuevo `src/lib/copilotPayload.ts`: `compactPayloadString()` reduce payload a <2KB (top-N por dimensión, prune recursivo).
- Auto-report al abrir el Copilot con template estructurado (Resumen / Oportunidades / Próximos pasos).
- Modelo Gemini actualizado a alias `gemini-flash-latest` / `gemini-pro-latest` (siempre última versión gratis).
- Dropdown de AI config en `/admin/ai-config` muestra correctamente qué versión de Gemini se usa.

### Tenants DEMO con datos reales
- `isMockTenant()` bypass en backend `/api/intelligence/copilot` (sin chequeo de `tid` mismatch).
- DEMO Maturity page: short-circuit a mock con shape `{overallScore, pillars}` correcta.
- DEMO Progress page: short-circuit con historia + advisor mocks; badge dinámico "Datos reales de Azure" / "Datos de demostración".
- `mockData.ts`: `'history'` ahora 12 puntos semanales determinísticos ending today; `'advisor'` con 6 recs realistas (3 Cost, 1 Security, 1 HA, 1 Performance).

### Archivos principales tocados en esta línea de trabajo
- `src/lib/msalToken.ts` (nuevo)
- `src/lib/copilotPayload.ts` (nuevo)
- `src/lib/advisorI18n.ts` (nuevo)
- `src/lib/onboardingScriptTemplate.ts`
- `src/lib/cache.ts`
- `src/lib/mockData.ts`
- `src/app/api/admin/check-sp-roles/route.ts` (nuevo)
- `src/app/api/intelligence/billing/route.ts`
- `src/app/api/intelligence/copilot/route.ts`
- `src/modules/collectors/azure/billingService.ts`
- `src/modules/core/aiProvider.ts`
- `src/services/aiService.ts`
- `src/components/GlobalCopilot.tsx`
- `src/components/AdvisorPanel.tsx`
- `src/app/[locale]/intelligence/billing/page.tsx`
- `src/app/[locale]/overview/progress/page.tsx`
- `src/app/[locale]/overview/maturity/page.tsx`
- `src/app/[locale]/admin/ai-config/page.tsx`
- `messages/{es,en,pt-BR}.json`
- 18 páginas migradas a `getFreshIdToken` / `fetchWithAuthRetry`

## 2026-06-27 (sesión previa)

### Dashboard y rendimiento
- Se implementó endpoint agregador cacheado en Redis para KPIs e histograma:
  - `GET /api/dashboard/summary`
- Se mejoró el layout responsive de KPIs para ocupar el ancho disponible.
- Se agregó histograma de costos debajo de KPIs con filtro por período (1 a 12 meses).
- Se separó la carga de control de VMs en endpoint liviano:
  - `GET /api/power`

### Estabilidad y degradación controlada
- Se corrigieron errores de carga en selector de tenant con fallback por `tid`.
- Se evitó hard-fail en dashboard para escenarios recuperables de permisos/onboarding en rutas de auditoría/anomalías.
- Se ajustó `/api/audit/ttl` para:
  - usar auth robusta por tenant,
  - degradar a respuesta válida (`expiredResources: []`) ante errores recuperables,
  - evitar 500 disruptivos en UI.

### Gráficos y experiencia visual
- Se corrigieron warnings de Recharts por dimensiones inválidas (`width/height -1`) en componentes de dashboard:
  - render condicional tras mount,
  - contenedores con `min-w-0`,
  - alturas explícitas donde corresponde.

### Internacionalización de Azure Advisor
- Se ajustó la obtención de recomendaciones para respetar el idioma activo del usuario (ES/EN/PT-BR).
- Se normalizó locale hacia formato compatible con Azure Advisor (`es-ES`, `en-US`, `pt-BR`).
- Se propagó locale explícitamente desde frontend a `/api/advisor` para evitar desalineación con el idioma del navegador.

### Archivos principales tocados en esta línea de trabajo
- `src/lib/requestAuth.ts`
- `src/lib/money.ts`
- `src/app/api/dashboard/summary/route.ts`
- `src/app/api/power/route.ts`
- `src/app/api/audit/ttl/route.ts`
- `src/app/[locale]/page.tsx`
- `src/components/dashboard/PowerSchedules.tsx`
- `src/components/dashboard/BudgetBurnChart.tsx`
- `src/components/CostPieChart.tsx`
- `src/app/api/intelligence/anomalies/route.ts`
- `src/app/api/audit/full/route.ts`
- `src/app/api/advisor/route.ts`
- `src/modules/collectors/azure/advisorCollector.ts`
- `src/components/AdvisorPanel.tsx`
- `src/app/[locale]/overview/progress/page.tsx`
- `src/app/[locale]/intelligence/billing/page.tsx`

---

## Regla de actualización permanente

Cada cambio nuevo debe registrar:

1. Fecha
2. Qué se cambió
3. Impacto funcional/técnico
4. Archivos modificados
