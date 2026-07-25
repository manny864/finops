# Handoff — Ingesta Multi-Cloud AWS (FOCUS)

> **Estado**: fundación corregida, features pendientes.
> **Última actualización**: 2026-07-25
> **Objetivo del documento**: permitir continuar esta implementación desde cero
> en otra sesión o en otro IDE, sin contexto previo.

---

## 0. TL;DR para quien retoma

El repo YA tenía ~45% de la integración AWS implementada antes de esta sesión
(assume-role, Cost Explorer, descubrimiento de CUR, mapper FOCUS, tabla
`AwsAccounts`, UI de alta). **No la reescribas.** Esta sesión arregló 4 bugs
críticos de esa base. Lo que falta son las Fases 2-6 de la §5.

Decisión de producto ya tomada: **la ingesta multi-cloud AWS es tier
Enterprise**. Ya está aplicada en `routeTiers.ts` y en los gates server-side.

---

## 1. Mapa del código existente

| Archivo | Qué hace |
|---|---|
| `src/lib/aws/sts.ts` | `assumeRole()` con caché de credenciales temporales; `generateExternalId()` / `encrypt`/`decryptExternalId()` (AES-256-GCM vía `mfaCrypto`) |
| `src/lib/aws/costExplorer.ts` | `getCostAndUsage()` — GetCostAndUsage DAILY paginado, agrupado por SERVICE+REGION |
| `src/lib/aws/cur.ts` | Descubrimiento de partición/manifest en S3, `iterateCurParquet()` (generador), `ingestLatestCurPeriod()` |
| `src/modules/collectors/aws/awsFocusMapper.ts` | `mapCeDailyToFocus()`, `mapCurRowToFocus()`, `awsServiceToCategory()` |
| `src/modules/collectors/aws/awsProvider.ts` | Implementación de la interfaz `CloudProvider` (billing, EC2, recommendations) |
| `src/app/api/aws/accounts/route.ts` | GET lista / POST alta (devuelve el `externalId` UNA sola vez) |
| `src/app/api/aws/accounts/[id]/route.ts` | DELETE |
| `src/app/api/aws/accounts/[id]/test/route.ts` | Test de conectividad: AssumeRole + CE 7 días + alcance del bucket CUR |
| `src/app/api/sync/aws/[accountId]/ce/route.ts` | Sync vía Cost Explorer |
| `src/app/api/sync/aws/[accountId]/cur/route.ts` | Sync vía CUR/S3/Parquet |
| `src/app/[locale]/admin/cloud-accounts/page.tsx` | UI de gestión de cuentas AWS |
| `migrations/20260629-007-aws-accounts.sql` | Tabla `AwsAccounts` |
| `__tests__/unit/aws.test.ts` | 24 tests unitarios del mapper, manifest parser y cripto del externalId |

Dependencias ya instaladas: `@aws-sdk/client-{sts,cost-explorer,s3,ec2}`,
`@dsnp/parquetjs`.

---

## 2. Lo que se arregló en esta sesión

### 2.1 La granularidad hourly/resource-level se destruía al persistir ✅

**Era el bug más grave.** `CostSnapshots` tiene
`UNIQUE KEY (tenant_id, subscription_id, date, resource_group, service_name)`
y su columna `date` es `DATE`. El pipeline de CUR agregaba explícitamente en
memoria por `(date, region, service)` para poder entrar en esa clave, tirando
`ResourceId` y la hora. Sin eso no hay rightsizing, ni detección de huérfanos,
ni chargeback por recurso — o sea, el Módulo C entero era imposible.

**Fix**: nueva tabla `FocusLineItems`
(`migrations/20260725-001-focus-line-items.sql`) con grain recurso+hora,
provider-agnóstica (sirve igual para Azure). La ruta de CUR ahora escribe en
**dos niveles**: el granular en `FocusLineItems` y el agregado diario en
`CostSnapshots` (que es de donde leen todos los dashboards existentes — no se
tocó nada de eso).

Detalles de diseño que conviene no revertir sin pensarlo:
- `DECIMAL(18,8)` y no `(12,4)` para los costos: a grain horario por recurso hay
  líneas de fracciones de centavo que a 4 decimales redondean a 0 y desaparecen
  del total al sumar millones de filas.
- **No hay unique key por línea, a propósito.** AWS re-emite (*restates*) el CUR
  del período en curso varias veces al mes. La semántica correcta es reemplazar
  el período completo, no upsertear línea por línea.
- Idempotencia por `assemblyId` del manifest: se insertan las filas nuevas y
  **después** se borran las del mismo (tenant, cuenta, período) con otro
  assemblyId. Insertar-y-después-borrar y no al revés: si el sync muere a mitad
  de camino el tenant conserva los datos viejos completos en vez de quedar con
  un período vacío.
- `?force=1` en la ruta de CUR re-ingiere aunque el assemblyId no haya cambiado
  (para reprocesar tras un fix del mapper).

### 2.2 Faltaban `BillingAccountId` y `AmortizedCost` ✅

El comentario de `20260629-007-aws-accounts.sql` afirmaba que `CostSnapshots`
"ya tiene ProviderName, BillingAccountId, ..." — **es falso**. La lista
`focusColumns` de `src/modules/storage/db.ts` (~línea 461) nunca incluyó
`BillingAccountId` ni `AmortizedCost`, y ninguna ruta de sync los escribía.

Sin `BillingAccountId` no se puede distinguir la cuenta pagadora (AWS payer /
Azure tenant) del `SubAccountId`, que es justamente el eje de agrupación que
pide FOCUS para multi-cloud.

**Fix**: `migrations/20260725-002-costsnapshots-billing-account-amortized.sql` +
ambas rutas de sync ahora los escriben. El mapper calcula `AmortizedCost` a
partir de `reservation/AmortizedUpfrontCostForUsage` y
`savingsPlan/AmortizedUpfrontCommitmentForBillingPeriod`, cayendo a
`EffectiveCost` cuando la línea no es de compromiso. Cubierto por 4 tests
nuevos en `__tests__/unit/aws.test.ts`.

### 2.3 OOM garantizado al leer Parquet ✅

`iterateCurParquet` hacía `ParquetReader.openBuffer(buf)` sobre el objeto S3
entero bufferizado en heap. Un CUR de una cuenta mediana pesa cientos de MB y el
contenedor corre con `mem_limit: 3g` (`docker-compose.yml`).

**Fix**: `downloadToTempFile()` streamea a `os.tmpdir()` con
`stream/promises.pipeline` y se usa `ParquetReader.openFile()`, que hace seeks
sobre el file descriptor. El temporal se borra en un `finally` que también
dispara si el consumidor corta la iteración antes de tiempo.

### 2.4 Tier inconsistente + código muerto ✅

- `src/app/api/onboard/aws/route.ts` era un stub que escribía la config a
  `GlobalSettings`, duplicando el flujo real de `/api/aws/accounts`, sin
  referencias desde ningún lado. **Borrado.**
- Ese stub exigía Enterprise mientras `/api/aws/accounts` no tenía gate de tier
  ninguno y `routeTiers.ts` marcaba `/admin/cloud-accounts` como Professional.
- **Ahora**: `Enterprise` en `routeTiers.ts` + `requireTenantTier(...,
  'Enterprise')` en POST `/api/aws/accounts`, `/api/aws/accounts/[id]/test`,
  `/api/sync/aws/[id]/ce` y `/api/sync/aws/[id]/cur`.
- El gate va en el POST y no en el GET a propósito: un tenant que baja de plan
  tiene que poder seguir viendo y borrando las cuentas que ya cargó, no quedar
  con datos huérfanos e inaccesibles.

### Verificación hecha
- `npx tsc --noEmit` → limpio.
- `npx vitest run __tests__/unit/aws.test.ts` → 24/24 en verde.
- ⚠️ **No verificado contra una cuenta AWS real.** Nada de esto se probó con un
  CUR de verdad ni con un `sts:AssumeRole` real. Ver §5.

---

## 3. Lo que FALTA (en orden sugerido)

### Fase 2 — Onboarding automatizado (spec §A.3) — NO EMPEZADO

Hoy la UI (`cloud-accounts/page.tsx`, ~línea 201) muestra una trust policy JSON
escrita a mano y apunta a las managed policies `job-function/Billing` y
`AmazonEC2ReadOnlyAccess`. Falta:

- Generador de plantilla **CloudFormation** (+ snippet Terraform) parametrizado
  con el `externalId` recién generado y el account ID de la plataforma.
- La IAM policy real necesita, además de lo que ya hay:
  - `ce:GetCostAndUsage`, `ce:GetCostForecast`, `ce:GetReservationUtilization`,
    `ce:GetSavingsPlansUtilization`
  - `costoptimizationhub:ListRecommendations`,
    `costoptimizationhub:GetRecommendation`
  - `s3:GetObject` + `s3:ListBucket` sobre el bucket CUR del cliente
  - `organizations:ListAccounts` (para el mapeo de linked accounts, §2.2 del spec)
- Archivo sugerido: `src/lib/aws/onboardingTemplate.ts`, siguiendo el patrón de
  `src/lib/onboardingScriptTemplate.ts` (el equivalente de Azure).

### Fase 3 — Caché de Cost Explorer + resiliencia (spec §B.1 CRITICAL, §4) — NO EMPEZADO

**Cost Explorer cobra USD 0.01 por request** y hoy no hay ninguna caché: cada
sync dispara N requests paginados.

- Envolver `getCostAndUsage` en `getWithStaleWhileRevalidate(key, fn, ttl,
  staleTtl)` de `src/lib/cache.ts` (ya existe y es lo que usa todo el pipeline
  de Azure). Clave sugerida: `aws:ce:v1:<tenantId>:<accountId>:<start>:<end>`.
- Helper de retry con backoff exponencial para rate limits — hoy no existe
  ninguno; conviene que sea genérico y reutilizable por el lado Azure.
- Manejo explícito de `AccessDeniedException` → mensaje accionable al usuario
  ("revisá el trust policy / el ExternalId"), no un 500 genérico.
- Aviso en la UI de que los **cost allocation tags tardan 24-48h** en reflejarse
  en billing (el usuario carga un tag y no lo ve; es la consulta de soporte
  número uno de este tipo de integración).
- Fallback CUR → CE cuando el CUR está vacío o no promovido.
- `GetCostForecast` para el forecast de corto plazo (no implementado).

### Fase 4 — CUR 2.0 real (spec §B.2) — PARCIAL

El mapper solo entiende nombres de columna **CUR 1.0**
(`lineItem/UnblendedCost`). CUR 2.0 / Data Exports usa snake_case
(`line_item_unblended_cost`) y layout `BILLING_PERIOD=YYYY-MM/` en vez de
`<yyyymmdd>-<yyyymmdd>/`. El código lo declara "best-effort" pero en la práctica
devuelve **0 filas** contra un export CUR 2.0.

- Capa de normalización de nombres de columna (camelCase ↔ snake_case) antes de
  `mapCurRowToFocus`.
- Descubrimiento de partición para el layout nuevo en `findLatestBillingPeriod`.
- Backfill histórico (hoy solo se ingiere el período más reciente).

### Fase 5 — Módulo C: optimización y huérfanos (spec §3 Módulo C) — NO EMPEZADO

`awsProvider.getRecommendations()` devuelve `[]` (línea ~105). No existe nada.

- Dependencia a instalar: `@aws-sdk/client-cost-optimization-hub`.
- Archivo sugerido: `src/modules/collectors/aws/awsOptimizationService.ts`.
- Scanners pedidos por el spec:
  - **Cómputo**: EC2 sobredimensionadas, nodos EKS subutilizados, Lambdas ociosas
  - **Storage**: volúmenes EBS en estado `available` (desasociados), snapshots
    EBS viejos, recomendaciones de lifecycle en S3
  - **Red**: Elastic IPs sin asociar, picos de transferencia cross-AZ, NAT
    Gateways con poco tráfico pero costo horario fijo alto
  - **Compromisos**: cobertura y utilización de Savings Plans y RIs
- Endpoint + página nueva. Recordar el cuádruple wiring obligatorio del proyecto:
  `Sidebar.tsx` + `routeTiers.ts` + `pageRegistry.ts` + `pageRoleTags.ts`.
- Ahora que existe `FocusLineItems` a grain de recurso, varios de estos scanners
  se pueden resolver con SQL sobre esa tabla en vez de llamadas extra a la API.

### Fase 6 — Wiring y operación — NO EMPEZADO

- **No hay cron de sync AWS.** Hoy el sync solo corre apretando un botón en el
  admin. Azure tiene `src/app/api/cron/sync`; falta el equivalente
  `src/app/api/cron/aws-sync-daily` autenticado con `CRON_SECRET`.
- **No hay mock data de AWS** → los tenants demo no ven nada multi-cloud.
  Extender `src/lib/mockData.ts` (`isMockTenant` / `getMockDataForRoute`).
- i18n en los 3 idiomas (`messages/{es,en,pt-BR}.json`) para todo lo nuevo.
- Recordar la directiva del proyecto: **"CSCloudSolutions" nunca se traduce ni
  se reformatea en ningún idioma.**

---

## 4. Convenciones del proyecto a respetar

- **Migraciones**: `migrations/YYYYMMDD-NNN-descripcion.sql`, una por cambio
  lógico, idempotentes. El runner (`src/modules/storage/migrations.ts`) ignora
  `ER_DUP_FIELDNAME`, `ER_DUP_KEYNAME`, `ER_TABLE_EXISTS_ERROR`, `ER_DUP_ENTRY`,
  `ER_CANT_DROP_FIELD_OR_KEY`, así que un `ALTER TABLE ... ADD COLUMN` plano es
  seguro. **Nunca editar una migración ya aplicada en producción** (el runner
  valida por checksum).
- **Auth**: `requireTenantAccess` / `requireTenantRole(req, tid, ['ADMIN',
  'OWNER'])` / `requireTenantTier(req, tid, 'Enterprise')` de
  `src/lib/requestAuth.ts`. Capturar `AuthError` y devolver `error.status`.
- **Caché**: `getWithStaleWhileRevalidate` / `invalidateCache` de
  `src/lib/cache.ts`.
- **Dinero**: `decimalToCents` / `centsToDecimal` de `src/lib/money.ts` para
  cualquier cálculo con plata (Regla Cero: centavos enteros, sin float drift).
- **Git**: por defecto solo commit + push a `staging`. Merge a `main` y deploy
  requieren pedido explícito del usuario.
- **Probar en local antes de cualquier acción de deploy.**

---

## 5. Riesgos abiertos / lo que NO está verificado

1. **Nada de esto se probó contra una cuenta AWS real.** No hay cuenta de prueba
   configurada en el entorno. Los tests son unitarios sobre el mapper con
   fixtures sintéticos. Antes de habilitarlo a un cliente hay que correr al
   menos un `POST /api/aws/accounts/[id]/test` y un sync de CUR completo contra
   una cuenta real.
2. **`FocusLineItems` puede crecer muy rápido.** Un CUR a grain horario por
   recurso son millones de filas por mes por cuenta. No hay política de
   retención ni particionado. Definir una antes del primer cliente grande —
   probablemente `PARTITION BY RANGE` sobre `BillingPeriodStart` + purga de
   períodos viejos.
3. **El bulk insert de la ruta de CUR no está en transacción.** Si falla a mitad
   de un período quedan filas del assemblyId nuevo sin purgar las viejas; el
   siguiente sync exitoso lo corrige (la purga borra todo lo que no sea el
   assemblyId actual), pero entre medio los totales de ese período están
   inflados. Aceptable para el MVP, no para facturación al cliente.
4. **El deploy a producción del VPS está fallando** por timeout de SSH desde
   GitHub Actions (run 30058445645) — ajeno a este trabajo, pero significa que
   nada de esto llega al servidor hasta que se resuelva.

---

## 6. Archivos tocados en esta sesión

```
A  migrations/20260725-001-focus-line-items.sql
A  migrations/20260725-002-costsnapshots-billing-account-amortized.sql
A  migrations/20260725-003-awsaccounts-last-assembly-id.sql
A  docs/aws-multicloud-handoff.md
M  src/lib/aws/cur.ts
M  src/modules/collectors/aws/awsFocusMapper.ts
M  src/app/api/sync/aws/[accountId]/cur/route.ts
M  src/app/api/sync/aws/[accountId]/ce/route.ts
M  src/app/api/aws/accounts/route.ts
M  src/app/api/aws/accounts/[id]/test/route.ts
M  src/lib/routeTiers.ts
M  __tests__/unit/aws.test.ts
D  src/app/api/onboard/aws/route.ts
```
