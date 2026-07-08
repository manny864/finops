# Fix: modo demo roto en toda la app (2026-07-08)

Este documento describe una sesión de trabajo completa: qué estaba roto, la causa
raíz, el patrón de fix aplicado ~35 veces, y tres cambios adicionales sin
relación con el bug principal. Pensado para poder retomarse desde otro IDE sin
el contexto de la conversación original.

Commit: `7675b09` en `main` (mergeado desde `staging` vía fast-forward).
Deploy verificado exitoso: run [28980234342](https://github.com/manny864/finops/actions/runs/28980234342).

## 1. Causa raíz del modo demo roto

`src/components/TenantProvider.tsx` intercepta `window.fetch` y
`instance.acquireTokenSilent` cuando el tenant activo es uno de los IDs mock
(`isMockTenant()` en `src/lib/mockData.ts`) o hay una `demoSession` activa
(`/es/demo?tier=...`). El interceptor de `fetch` matchea por URL y devuelve
JSON canned de `getMockDataForRoute()` sin tocar la red real.

El problema: el interceptor de `acquireTokenSilent` **deja pasar los pedidos
con scope `User.Read` al MSAL real** (para no romper `/api/tenants`, que sí
necesita un token real incluso en demo). Casi todas las páginas obtienen su
token así:

```ts
const tokenResponse = await instance.acquireTokenSilent({
    scopes: ["User.Read"],
    account: accounts[0]   // undefined en demo — no hay cuenta MSAL real
});
```

Con `account: undefined`, MSAL real revienta con `no_account_error` **antes**
de que el código llegue a hacer el `fetch()` que el interceptor necesita para
devolver el mock. Resultado: página vacía, "sin datos", "token inválido",
"sesión no iniciada", etc. — el mock data ya existía para casi todas las
rutas, pero nunca se llegaba a pedirlo.

### El fix central

`src/lib/msalToken.ts` — `getFreshIdToken()`:

```ts
export async function getFreshIdToken(instance, account, scopes = ['User.Read']) {
  if (!account) return 'demo';   // <-- guard nuevo
  ...
}
```

Mismo guard en `fetchWithAuthRetry()` para el retry-on-401. Con esto, cualquier
componente que use `getFreshIdToken`/`fetchWithAuthRetry` en vez de
`instance.acquireTokenSilent` directo queda automáticamente a salvo en demo: el
`fetch()` se dispara con `Authorization: Bearer demo`, y el interceptor de URL
lo captura igual.

## 2. El patrón de fix repetido (~35 archivos)

Dos variantes del mismo bug, encontradas y corregidas en cada archivo:

**Variante A — guard de carga bloquea el fetch entero:**
```ts
// ANTES
if (accounts.length === 0 || selectedTenant.id === 'default') { ... return; }
// DESPUÉS
if ((accounts.length === 0 && !isMockTenant(selectedTenant.id)) || selectedTenant.id === 'default') { ... return; }
```
Aplica a guards de `useEffect`, keys de `useSWR`, y returns tempranos de render
("Acceso Restringido", "Inicia sesión...", etc.).

**Variante B — token crudo con throw temprano:**
```ts
// ANTES
const account = accounts[0];
if (!account) throw new Error("No hay cuenta autenticada");
const tokenResponse = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
...`Bearer ${tokenResponse.idToken}`...

// DESPUÉS
const idToken = await getFreshIdToken(instance, accounts[0]);
...`Bearer ${idToken}`...
```

Si tocás una página nueva y ves "sin datos"/"token inválido"/"no hay cuenta
autenticada" en modo demo, buscá estos dos patrones primero.

### Checklist para diagnosticar un caso nuevo

1. ¿El componente usa `instance.acquireTokenSilent` directo, o
   `getFreshIdToken`/`fetchWithAuthRetry`? Si es directo, migrarlo.
2. ¿El guard de cbtarga (`useEffect`, `useSWR` key, o `if` de render) excluye
   `isMockTenant(selectedTenant.id)` cuando `accounts.length === 0`?
3. ¿La URL que pega el componente está en el switch de `window.fetch` en
   `TenantProvider.tsx` (buscar `url.includes('/api/...')`)? Si no está, el
   fetch va a la red real con `Bearer demo` y el servidor lo rechaza
   (`requireTenantAccess`/`requireTenantRole` validan el JWT real,
   independientemente de si el tenantId es mock).
4. ¿Existe un caso en `getMockDataForRoute()` (`src/lib/mockData.ts`) con la
   forma de datos que el componente espera? Si no, agregarlo.

## 3. Archivos tocados (por qué)

### Fix central
- `src/lib/msalToken.ts` — guard `!account → 'demo'` en `getFreshIdToken` y
  `fetchWithAuthRetry`.

### Interceptores/mocks nuevos en `TenantProvider.tsx`
Rutas que no tenían entrada en el switch de `window.fetch` y ahora sí:
`/api/academy/content`, `/api/intelligence/simulator` (+ `/scenarios`,
matemática pura replicada de `src/lib/simulator/engine.ts`),
`/api/intelligence/cost-by-category`, `/api/intelligence/commitment-simulator`,
`/api/intelligence/compute-efficiency`, `/api/governance/reporting`,
`/api/billing/plan`, `/api/billing/invoices`,
`/api/admin/config/users/entra-sync` (necesitaba ir *antes* que
`/api/admin/config/users` porque este último matchea por substring y devolvía
la forma equivocada — usuarios locales en vez de usuarios "Graph"),
`/api/intelligence/applied-savings` (ver sección 4).

### Componentes migrados de Variante A/B a `getFreshIdToken` + `isMockTenant`
`AllocationManager.tsx`, `FinOpsScorecard.tsx`, `AnomalyDashboard.tsx`,
`StorageEfficiencyDashboard.tsx`, `CostByCategoryDashboard.tsx`,
`CommitmentSimulatorDashboard.tsx`, `ComputeEfficiencyDashboard.tsx`,
`AIAnalyticsDashboard.tsx`, `MACCTracker.tsx`, `GovernanceReportingDashboard.tsx`,
`HARecommendationsPanel.tsx`, `RemediationApprovals.tsx`, `PoliciesAsCode.tsx`,
`AlertRulesManager.tsx`, `ZombieResourcesTable.tsx`, `PowerSchedules.tsx`,
`TagManager.tsx`, `TagInheritancePanel.tsx`, `ExpiringCredentialsPanel.tsx`,
`AdvisorPanel.tsx`, `FinOpsAcademy.tsx`, `CreateBudgetModal.tsx`,
`budgets/BudgetCard.tsx`, `AksChargebackCard.tsx` (componente no usado por la
ruta real — ver abajo), `AksIntelligence.tsx`, `HybridBenefitCard.tsx`,
`Commitments.tsx`, `UnitEconomics.tsx`, `ZeroCostInventory.tsx`.

Páginas (no componentes) con el mismo fix:
`app/[locale]/cleanup/ttl/page.tsx`,
`app/[locale]/intelligence/aks-chargeback/page.tsx` (⚠️ la ruta real usa su
propia implementación inline, **no** `AksChargebackCard.tsx` — arreglar ambos
si se toca este feature),
`app/[locale]/admin/users/page.tsx` (ya estaba bien, solo se agregó el
interceptor de `entra-sync`),
`app/[locale]/admin/pricing-units/page.tsx` (quitados 3 guards `if (!account)`
redundantes — la página es global/superadmin, no depende de tenant),
`app/[locale]/intelligence/billing/page.tsx` (wiring de `appliedSavingsData`,
ver sección 4).

### `src/lib/mockData.ts`
- Nuevo caso `'academy'` (contenido + progreso de Academia FinOps).
- `'billing'`: agregado campo `UsageDate` (el generador solo tenía `date`
  minúscula; el chart de "Evolución del gasto mensual" en
  `InteractiveDashboard.tsx` lee `e.UsageDate`, así que quedaba vacío).
- `'aks_chargeback'`: agregados `cpuCores`, `computeCost`, `storageCost` por
  namespace (faltaban, el render mostraba `$NaN`).
- `'budgets_burn'`: agregado `subscriptionId: 'mock-sub'` a cada item (el
  agrupador de `BudgetCard.tsx` los indexaba por `undefined`).

## 4. "Ahorro Aplicado" (antes hardcodeado a 0)

`InteractiveDashboard.tsx` tenía `const computedAppliedSavings = 0; //
Placeholder`. A diferencia del resto de esta sesión, esto **no era un bug de
demo** — afectaba a tenants reales también, porque nunca se calculaba nada.

Implementación real (no fake):
- `ActionLogs` ya registra `action_type='DELETE_RESOURCE'` con `status`
  cuando el usuario borra un recurso zombie desde
  `src/services/remediationService.ts` — pero no tiene columna de costo.
- Nuevo endpoint `GET /api/intelligence/applied-savings?tenantId=&days=30`
  (`src/app/api/intelligence/applied-savings/route.ts`): suma un estimado de
  ahorro mensual por eliminación exitosa, infiriendo el tipo de recurso desde
  el `resource_id` (ARM type) contra una tabla de estimados — los mismos
  números que ya se usaban para "ahorro potencial" en
  `InteractiveDashboard.tsx`, solo que aplicados a acciones **ya ejecutadas**
  en vez de recomendaciones pendientes.
- No requirió migración de schema.
- `intelligence/billing/page.tsx` ahora pide este endpoint en paralelo con
  los otros 4 (`billing`, `advisor`, `audit/full`, `tags/compliance`) y lo
  pasa como prop `appliedSavingsData` a `InteractiveDashboard`.
- Mock correspondiente agregado en `TenantProvider.tsx` y en el branch
  `isMockTenant` de `intelligence/billing/page.tsx`.

Si en el futuro se quiere mayor precisión, el camino natural es agregar una
columna `estimated_savings` a `ActionLogs` y poblarla en el momento del
borrado real (hoy se infiere post-hoc por el nombre del recurso).

## 5. Bug real encontrado de paso (no relacionado a demo)

`src/app/[locale]/admin/billing/page.tsx`: `invoice.amount?.toFixed(2)`
crasheaba con `TypeError: invoice.amount?.toFixed is not a function`. Causa:
la columna `BillingTransactions.amount` es `DECIMAL(12,2)` y el pool de mysql2
(`src/modules/storage/db.ts`) no tiene `decimalNumbers: true`, así que
**siempre** vuelve como string — afecta a tenants reales con facturas, no solo
al mock. Fix: `Number(invoice.amount ?? 0).toFixed(2)`.

Si se quiere una solución más de fondo, evaluar agregar
`decimalNumbers: true` al pool global — pero eso cambia el tipo de *todas*
las columnas DECIMAL del proyecto, así que se prefirió el fix puntual acá.

## 6. Cambios sin relación al bug de demo (pedidos aparte en la misma sesión)

### 6.1 PAL/CPOR (Partner Admin Link / CPOR) portado desde `M365Proyect/saas`
Mismo patrón que en `saas`, adaptado a que FinOps no tiene tabla de
"conexiones" (1 tenant = 1 credencial Azure directa en `Tenants`):
- `migrations/20260708-001-tenants-partner-link.sql` — columnas
  `partner_link_status/approved_by/approved_at/detail` en `Tenants`.
- `src/lib/partner/pal.ts` — link PAL contra ARM, usa `getAzureCredential()`
  en vez del app-token de Graph que usa `saas`.
- `src/app/api/tenants/partner-link/route.ts` — `POST { tenantId, approve }`.
- `src/app/api/tenants/route.ts` — el `GET` expone los campos nuevos.
- `src/app/[locale]/admin/onboarding/page.tsx` — bloque de disclaimer dentro
  del panel expandido de cada tenant en "Directorio de Entornos".
- `.env.example` — `PARTNER_MPN_ID`.

### 6.2 Limpieza de imágenes Docker
`.github/workflows/deploy.yml` — agregado `docker builder prune -af --filter
until=48h || true` a los 3 intentos de deploy (mismo patrón que
`M365Proyect/saas`).

### 6.3 Bypass de reCAPTCHA en desarrollo
`src/app/api/leads/demo/route.ts` — el gate de leads del sitio de marketing
(`DemoLeadModal.tsx`) usa un site key de reCAPTCHA hardcodeado para el dominio
de producción, que no resuelve en `localhost`. Se agregó un bypass **solo si
`NODE_ENV !== 'production'` y no hay `RECAPTCHA_SECRET`**: no verifica el
token y, más importante, **no llega a llamar a Microsoft Graph** con las
credenciales reales de `.env.development` (evita mandar un email real a
`sales@` en cada prueba local). En producción el comportamiento fail-closed
original queda intacto.

## 7. Cómo verificar en otro entorno

```bash
npx tsc --noEmit -p tsconfig.json   # debe quedar limpio
```

Para probar el modo demo manualmente sin pasar por el gate de reCAPTCHA de
marketing:
```js
// en la consola del browser, en localhost:
localStorage.setItem('hasCompletedDemoLead', 'true');
location.href = '/es/demo?tier=business';  // o essential | pro | enterprise
// login con demo/demo
```

Tenants mock disponibles (`src/lib/mockData.ts` → `isMockTenant`):
- `11111111-2222-3333-4444-555555555555` — Essential
- `22222222-3333-4444-5555-666666666666` — Professional
- `44444444-5555-6666-7777-888888888888` — Business
- `33333333-4444-5555-6666-777777777777` — Enterprise
