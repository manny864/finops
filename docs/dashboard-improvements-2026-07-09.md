# Dashboard, What-If y superadmin: 6 mejoras (2026-07-09)

Continuación de la sesión `docs/demo-mode-fix-2026-07-08.md`. Ese documento
cubrió el fix del modo demo roto; este cubre seis pedidos nuevos hechos sobre
el dashboard, la página de Simulación (What-If) y el panel de superadmin.
Pensado para poder retomarse desde otro IDE sin el contexto de la conversación
original.

Rama de trabajo: `feature/dashboard-projections-tenant-tags`.

## Índice de pedidos

1. Datos faltantes en el dashboard: Estado de Gobernanza e Histograma de costos.
2. Consultas de gasto con lookback histórico hasta donde lo permite Azure.
3. Tarjeta de proyección de gastos (últimos 12 meses + % de crecimiento).
4. Descarga de simulaciones y comparaciones en la página What-If.
5. Tarjetas bloqueadas por tier sin borde visible.
6. 404 al presionar "Finish Onboarding" en el wizard de bienvenida.
7. Etiquetado de tenants por origen comercial (solo SUPERADMIN).

## 1. Histograma de costos + Estado de Gobernanza vacíos (modo demo)

**Causa raíz:** en `src/lib/mockData.ts`, el caso `dashboard_summary` devolvía
`histogram: [{ name: 'Compute', value: ... }, ...]` (7 categorías) cuando el
frontend (`src/app/[locale]/page.tsx`) espera una serie diaria
`{ date: 'YYYY-MM-DD', cost: number }[]`. El chart quedaba vacío porque
`point.date` era `undefined` en todos los puntos.

El Estado de Gobernanza mostraba 0% porque `page.tsx` calculaba el score
por-recurso a partir de `auditResults` (recursos zombie), y esos recursos
legítimamente no tienen tags — el cálculo daba ~0% aunque las políticas de
tagging del tenant estuvieran bien configuradas.

**Fix:**
- `mockData.ts`: histograma diario determinista (tendencia + estacionalidad
  semanal + ruido acotado) en el formato correcto, y `complianceScore`
  precalculado por tier (Enterprise 86%, Business 78%, Professional 71%,
  Essential 64%).
- `page.tsx`: si `summaryJson.complianceScore` es un número, usarlo
  directamente y saltar el cálculo por-recurso (que sigue existiendo como
  fallback para tenants reales sin ese campo).

## 2. Lookback histórico hasta el límite de Azure (13 meses)

Azure Cost Management Query API permite consultar `ActualCost` hasta **13
meses atrás** desde la fecha actual (documentado por Microsoft; más allá
requiere Cost Management Exports programados de antemano, no recuperables
retroactivamente vía API). Antes, el histograma del dashboard estaba
hardcodeado a 365 días desde `CostSnapshots` (snapshot diario local), sin
relleno cuando ese snapshot no cubría toda la ventana (p.ej. tenants nuevos).

**Cambios:**
- `src/modules/collectors/azure/billingService.ts`:
  - Constante `AZURE_COST_HISTORY_MAX_MONTHS = 13`.
  - Nueva `getHistoricalDailyCosts(tenantId, subscriptionId, monthsBack)`:
    consulta Azure Cost Management (`ActualCost`, `timeframe: 'Custom'`,
    granularidad `Daily`) a nivel Management Group con fallback automático a
    iterar subscripciones si el scope MG falla (mismo patrón que
    `getYesterdaysCost`).
- `src/app/api/dashboard/summary/route.ts`:
  - Nuevo parámetro `months` (query string), acotado a `AZURE_COST_HISTORY_MAX_MONTHS`.
  - `fetchHistogramFromDb()` ahora recibe `days` en vez de tener `INTERVAL 365 DAY`
    hardcodeado.
  - Si la fecha más antigua en `CostSnapshots` es más reciente que la
    requerida, se completa el resto con `getHistoricalDailyCosts()`
    (best-effort, nunca bloquea la respuesta).
  - La cache key de Redis incluye la ventana solicitada
    (`dashboard:summary:v6:{tenantId}:{sub}:{months}m`).
- `src/app/[locale]/page.tsx`: el selector del histograma pasó de 5 opciones
  (1/3/6/9/12 meses) a 6 (agrega 13 — "Máximo, límite de Azure"). El frontend
  siempre pide `months=13` al backend y filtra client-side (evita refetch
  completo del dashboard al cambiar el selector).
- `mockData.ts`: histograma demo extendido de 365 a 400 días para que el
  selector de 13 meses tenga datos también en modo demo.

## 3. Tarjeta de Proyección de Gastos

Nueva card en el dashboard (tier **Professional+**, mismo nivel que "Análisis
de Facturación"), key de grid `projection`, ancho completo.

- `src/lib/costProjection.ts` (Regla Cero — todo con `Decimal.js`, sin floats):
  - `aggregateDailyToMonthly()`: agrupa la serie diaria del histograma en
    totales mensuales.
  - `projectFutureCosts(monthlyHistory, annualGrowthPct, monthsAhead)`:
    - Toma los últimos 12 meses con datos, calcula el promedio mensual.
    - Convierte el % de crecimiento anual a una tasa mensual equivalente
      compuesta: `(1 + anual/100)^(1/12) - 1`.
    - Proyecta mes a mes multiplicando el promedio por `(1 + tasa_mensual)`
      acumulado, hasta `monthsAhead` meses.
    - Devuelve además `baseMonthlyAverage`, `trailing12mTotal`,
      `monthsUsedForBase`, `monthlyGrowthRatePct` y `projectedTotal`.
- `src/components/dashboard/CostProjectionCard.tsx` (`"use client"`):
  - Input numérico de % de crecimiento anual (default 10%, rango -100 a 500).
  - Selector de horizonte: 3/6/12/24 meses.
  - Gráfico `LineChart` (recharts) con dos series: `real` (últimos 12 meses)
    y `proyectado` (línea punteada), empalmadas en el punto de transición.
  - 3 KPIs: promedio mensual (12m), tasa mensual equivalente, total
    proyectado del horizonte elegido.
  - i18n vía `useTranslations('Dashboard')` — 11 keys nuevas en
    `en/es/pt-BR.json` (`cost_projection_*`).
- Alimentada con el mismo `billingHistogram` (prop `dailyHistory`) que ya
  carga el histograma de costos — sin fetch adicional.

## 4. Descarga de simulaciones What-If (CSV)

`src/components/simulator/ScenarioManager.tsx`:
- Botón **"Descargar todo"** (header): CSV con todos los escenarios guardados
  del tenant, una fila por escenario.
- Botón de descarga por fila: CSV de un escenario individual (todos los
  inputs — compute/storage/network scale, AHB — y resultados — base,
  proyectado, delta, breakdown).
- Botón **"Descargar comparación"** (modal de comparación lado-a-lado): CSV
  con escenarios en columnas y métricas en filas, incluyendo el delta % de
  cada escenario vs. la línea base seleccionada.
- Todo client-side (`Blob` + `URL.createObjectURL`), sin endpoint nuevo. Los
  valores se escapan según RFC 4180 (comillas, comas, saltos de línea).

## 5. Tarjetas bloqueadas por tier sin borde

`src/components/FeatureGuard.tsx`: el wrapper de una tarjeta bloqueada tenía
`opacity-40 grayscale blur` en el **hijo**, pero el contenedor externo no
tenía borde ni fondo propios — en tiers bajos (Essential/Professional) la
tarjeta se fundía visualmente con el fondo oscuro del dashboard, pareciendo
"rota" en vez de "bloqueada". Se agrega `rounded-[14px] border
border-[var(--line)] bg-[var(--surface)] overflow-hidden` al contenedor
(no al hijo, que sigue con blur).

## 6. 404 al finalizar el onboarding

**Causa raíz:** el dashboard vive en `/${locale}` (raíz de cada locale), no en
`/${locale}/overview` — esa ruta no existe (solo tiene subrutas como
`/overview/progress`). Tres puntos redirigían ahí:

- `src/app/[locale]/onboarding/page.tsx`: botón "Finish Onboarding" y "Skip
  Wizard" → ahora `router.push('/${locale}?onboarding_success=true')` y
  `router.push('/${locale}')` respectivamente.
- `src/app/api/auth/sso/callback/route.ts`: redirect post-SSO → `/${locale}`.
- `src/lib/emailHelper.ts`: link "Go to Dashboard" del email de bienvenida →
  `${baseUrl}/es`.

## 7. Etiquetado de tenants por origen comercial (solo SUPERADMIN)

Objetivo: identificar qué comercial vendió o refirió a cada cliente, para
tracking de ventas interno — nunca visible para el propio tenant.

- **Migración** `migrations/20260709-001-tenants-sales-referrer.sql`
  (idempotente): columnas `sales_referrer`, `sales_referrer_updated_by`,
  `sales_referrer_updated_at` en `Tenants`.
- **RBAC:** `PATCH /api/admin/tenants` (ya gateado con `requireSuperAdmin` —
  no se creó un endpoint nuevo) acepta `salesReferrer` opcional junto a
  `tier`/`subscriptionStatus`. Sanitiza (trim, máx. 255 caracteres, string
  vacío = borrar etiqueta) y audita quién/cuándo lo editó.
- **Lectura:** `GET /api/tenants` expone `sales_referrer` **únicamente** en el
  branch de SELECT usado cuando `isSuperAdmin === true`. El branch por-usuario
  (JOIN contra `Users` por email) no lo incluye — un usuario normal del
  tenant nunca ve esta columna (least privilege, directiva #1).
- **UI:** `src/app/[locale]/admin/onboarding/page.tsx`, dentro del panel
  expandido de cada tenant en el "Directorio de Entornos" (mismo lugar que el
  bloque de PAL/CPOR), campo de texto + botón "Guardar", visible solo cuando
  `isSuperAdmin`.
- **i18n:** 5 keys nuevas en el namespace `onboarding` (`salesReferrerLabel`,
  `salesReferrerHint`, `salesReferrerPlaceholder`, `salesReferrerSave`,
  `salesReferrerSaving`), paridad en `en/es/pt-BR.json`.

## 8. Seguimiento (2026-07-08, misma tarde): 3 ajustes post-QA

- **Cache Redis para Proyección de Gastos + página propia:** el agregado
  mensual (13 meses) que alimenta la card ahora se sirve desde
  `GET /api/intelligence/cost-projection`, cacheado en Redis (`getWithCache`,
  TTL 6h) por tenant+subscripción. La card dejó de recibir el histograma por
  prop y ahora hace su propio fetch (mismo patrón `useSWR` +
  `isMockTenant`/`getFreshIdToken` que el resto de dashboards de
  Inteligencia). Nueva página dedicada `/intelligence/cost-projection`
  (tier Professional), enlazada desde la card con "Ver detalle completo".
- **Loop del wizard de onboarding en tenants demo:** un SUPERADMIN con sesión
  MSAL real que navegaba a un tenant demo y presionaba "Skip"/"Finalizar"
  volvía siempre al wizard. Causa: el guard de auto-redirect del dashboard
  (`checkOnboarding()` en `page.tsx`) no excluía `isMockTenant()`, así que
  `/api/onboarding/progress` devolvía `is_onboarded=false` para un tenantId
  mock (sin fila real en la DB) y redirigía de vuelta a `/onboarding` justo
  después de que el wizard navegara a `/${locale}`. Fix: excluir
  `isMockTenant()` en ese guard, y en `handleFinishOnboarding` saltar la
  llamada real a `/api/onboarding/finish` para tenants mock.
- **Descarga CSV o PDF en What-If:** `ScenarioManager.tsx` ahora tiene un
  selector de formato (CSV/PDF) que aplica a las 3 descargas (escenario
  individual, todos, comparación). El PDF usa `jsPDF` + `jspdf-autotable`
  (mismo patrón que `PdfExportButton.tsx`), con la comparación en
  orientación landscape (escenarios como columnas).

## Cómo verificar en otro entorno

```bash
npx tsc --noEmit -p tsconfig.json   # debe quedar limpio
npm run test                        # 558 tests deben pasar
npm run build                       # debe compilar sin errores
```

Para probar en modo demo (ver también `docs/demo-mode-fix-2026-07-08.md`):
```js
localStorage.setItem('hasCompletedDemoLead', 'true');
location.href = '/es/demo?tier=business';
// login con demo/demo
```

El tag de origen comercial requiere un usuario real con `system_role =
'SUPERADMIN'` en `Users` (no aplica en modo demo — el modo demo no pasa por
`requireSuperAdmin`).
