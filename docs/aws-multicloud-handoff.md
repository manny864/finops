# Handoff — Producto AWS Multi-Cloud (FOCUS)

> **Estado**: ingesta corregida · **Fases 2, 3, 3.5, 4 y 5 ✅ COMPLETAS** · **Fase 7 🟡 en curso** · Fases 6, 8, 9 pendientes.
> **Última actualización**: 2026-07-26
> **Objetivo del documento**: permitir continuar esta implementación desde cero
> en otra sesión o en otro IDE, sin contexto previo.

---

## 0. TL;DR para quien retoma

El repo YA tenía ~45% de la **ingesta** AWS implementada antes de estas sesiones
(assume-role, Cost Explorer, descubrimiento de CUR, mapper FOCUS, tabla
`AwsAccounts`, UI de alta). **No la reescribas.** Se arreglaron 4 bugs críticos
de esa base (§2) y se definió el alcance del producto AWS completo (§3).

**El alcance ya no es solo ingesta.** Es un producto AWS paralelo al de Azure
dentro del mismo codebase: login propio, panel, roles, i18n y onboarding.

**Dónde está parado esto hoy:**

| Fase | Estado |
|---|---|
| 2 — Identidad propia (login sin Entra) | **✅ completa (backend + UI)** |
| 3 — Modelo de proveedor por tenant | **✅ completa (backend + UI)** |
| 3.5 — Credenciales de prueba + fix del rate limiter | **✅ completa** |
| 4 — Onboarding automatizado AWS | **✅ completa (backend + UI)** |
| 5 — Caché de Cost Explorer + resiliencia | **✅ completa** (falta fallback CUR→CE) |
| 6 — CUR 2.0 real | ⚠️ parcial |
| 7 — Panel AWS (páginas genéricas) | 🟡 **en curso** — infra hecha, faltan páginas |
| 7.5 — Mocks y demo AWS | **✅ completa** |
| 7.6 — Terminología por proveedor | **✅ completa** |
| 8 — Módulo C: optimización y huérfanos | ❌ no empezado |
| 9 — Wiring y operación | ❌ no empezado |

**Un cliente AWS ya puede** registrarse, verificar su email, entrar con
email+contraseña, invitar usuarios, dar de alta su cuenta AWS con una plantilla
de mínimo privilegio, sincronizar costos (con caché, así CE no le sale caro) y
ver un menú que no le miente. **Y la demo comercial ya puede mostrarse en AWS**:
`/demo?provider=aws` entra con datos AWS-nativos escalados por tier (§Fase 7.5).

**La pregunta que bloqueaba todo — ¿el panel AWS se parametriza o se forkea? —
está respondida: se parametriza.** `src/lib/tenantProviderContext.ts` permite que
una ruta pregunte qué proveedor usa el tenant y saltee el camino live de Azure,
cayendo a `CostSnapshots` — tabla que el sync de AWS **ya alimenta**.
`dashboard/summary` es el ejemplo a copiar. Ver §Fase 7 y §8.

⚠️ **Antes de facturar a un cliente, leer §6.0**: el parser de Cost Explorer usa
`parseFloat` sobre montos de dinero, en violación de la Regla Cero.

Tres cosas que hay que entender antes de tocar nada:

1. **"Login con AWS" no existe como análogo de Microsoft.** AWS no tiene IdP
   equivalente a Entra. Implica construir auth propia. Ver §3.1.
2. **`tenant_id` en toda la base de datos *era* el GUID de Entra.** Ese supuesto
   ya se rompió en la Fase 2: los tenants locales usan un UUID generado.
3. **La abstracción multi-cloud existe pero está desconectada** — ~50 rutas
   llaman a Azure ARM directo (§3.4). Ya **no** es el mayor riesgo: la Fase 7
   estableció el patrón para resolverlo ruta por ruta sin duplicar páginas.

Decisiones de producto ya tomadas: la ingesta AWS es **tier Enterprise** (ya
aplicada en `routeTiers.ts` y los gates server-side); un solo codebase, UI
separada por proveedor, switch AWS/Azure solo en Enterprise, mismos precios.

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

**Modelo de proveedor y ciclo de vida (Fase 3, agregado después):**

| Archivo | Qué hace |
|---|---|
| `src/lib/providerPolicy.ts` | Lógica **pura** (sin I/O, testeable sin MySQL): exclusividad por tier, elección del proveedor a retener, ventana de gracia, hitos de aviso, permisos de ingesta vs. lectura |
| `src/services/providerLifecycleService.ts` | Efectos: `applyTierChange()` (choke point), archivado/restauración/purga, `assertProviderIngestable()`, `providerPredicate()` |
| `src/app/api/admin/provider-transition/route.ts` | GET estado de la cuenta regresiva / POST invertir la elección |
| `src/app/api/cron/provider-archive-purge/route.ts` | Avisos T-30/T-7 + purga por lotes de la ventana vencida |
| `migrations/20260725-005-provider-archive.sql` | `Tenants.provider_archived`/`provider_purge_at`, tabla `TenantProviderTransitions`, `AwsAccounts.disabled_at`/`disabled_reason` |
| `docs/provider-downgrade-policy.md` | ADR completo de la política de datos al bajar de tier |
| `__tests__/unit/providerPolicy.test.ts` | 26 tests de la política pura |

**Identidad propia (Fase 2, agregado después):** `src/lib/localToken.ts`,
`src/lib/localAuth.ts`, `src/app/api/auth/local/*`,
`migrations/20260725-004-local-auth.sql`, `__tests__/unit/localAuth.test.ts`.

Dependencias ya instaladas: `@aws-sdk/client-{sts,cost-explorer,s3,ec2}`,
`@dsnp/parquetjs`.

---

## 2. Lo que se arregló en la fundación de ingesta

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
  CUR de verdad ni con un `sts:AssumeRole` real. Ver §6.

---

## 3. Decisiones de producto (tomadas, no re-discutir)

Estas decisiones las tomó el usuario después de una auditoría de factibilidad.
Están cerradas; quien retome ejecuta, no vuelve a proponer alternativas.

1. **Un solo codebase.** No hay deploy separado para AWS. Aislamiento por
   `tenant_id`, igual que hoy.
2. **UI separada por proveedor.** Un tenant AWS no ve páginas Azure y viceversa.
3. **Enterprise puede tener los dos** y elige con un **switch AWS/Azure** en el
   header. Hasta Business: un solo proveedor, elegido en el signup, inmutable.
4. **Mismo landing y mismos precios.** No se toca `PricingPage` ni los tiers.
5. **Login con AWS = identidad propia (versión barata).** Ver Fase 2.

### 3.1 Por qué "iniciar sesión con AWS" no es análogo a Microsoft

**AWS no tiene un IdP equivalente a Entra.** No existe un "iniciar sesión con
AWS" que devuelva un tenant global verificable:

- **IAM Identity Center** es la instancia SSO *del cliente*, no un directorio
  global. Cada cliente tendría que darte de alta como app SAML/OIDC, y muchas
  organizaciones AWS usan Okta o el propio Entra como IdP. No hay un claim tipo
  `tid` confiable.
- **"Login with Amazon"** es identidad de consumidor (cuentas de compras
  amazon.com). Nada que ver con cuentas AWS.
- **Cognito** te convierte a vos en el IdP. Es construir auth propia con marca
  AWS encima.

Conclusión: el botón "AWS" del login inevitablemente abre **auth propia**
(email + contraseña). Eso es lo que hay que construir.

### 3.2 Acoplamiento a Entra que había que romper (medido) — ✅ roto en Fase 2

Diagnóstico original (todo esto **ya no aplica tal cual**, ver Fase 2 en §4):

- [`AuthProvider.tsx`](../src/components/AuthProvider.tsx) instancia MSAL contra
  `login.microsoftonline.com/common`. *(Sigue igual: la rama Entra no se tocó.)*
- [`msalToken.ts`](../src/lib/msalToken.ts) valida el JWT contra el JWKS de
  `login.microsoftonline.com/{tid}`. *(Sigue igual; la rama local se discrimina
  por algoritmo — HS256 vs RS256 — en `validateRequestToken`.)*
- **`tenant_id` *era* el GUID del tenant de Entra** (claim `tid`) — PK de
  `Tenants` y FK en ~40 tablas. **Ya no**: los tenants locales usan un UUID
  generado. El esquema nunca lo impidió (`VARCHAR(255)`).
- `Users.entra_oid` era `NOT NULL`. **Ya es NULLable** — un usuario es "local"
  si y solo si `password_hash IS NOT NULL`.
- `src/app/api/onboard/route.ts` deriva todo de `identity.claims.oid`. *(Sigue
  siendo el camino de Entra; el alta local va por `/api/auth/local/signup`.)*

**Lo que NO está acoplado y por lo tanto no se toca:**

- Las **244 rutas de API** dependen de `requireRequestIdentity`, no de MSAL. Si
  esa función acepta un segundo tipo de token, ninguna ruta se entera.
- El **MFA es TOTP propio con `otplib`** (`src/lib/mfa.ts`), no delegado a
  Entra. Funciona igual con login local.
- `bcryptjs`, `jose` y `jsonwebtoken` **ya están en `package.json`**. La auth
  local no necesita dependencias nuevas.

### 3.3 Clasificación de las 117 páginas para el panel AWS

No se duplica el árbol. Cortando por dependencia real a Azure:

- **~30 páginas salen casi gratis** — las que solo leen costos: Consumo Real,
  Presupuestos, Cost Groups, Prorrateo, Anomalías, Proyección, Costos por
  Categoría, Scorecard, Unit Economics, Simulador, COIN, casi todo
  `/overview/*` y `/admin/*`. Alimentadas desde `FocusLineItems` funcionan con
  cambios de filtro, no de lógica. → **Fase 7**.
- **~25 páginas necesitan colectores AWS nuevos** — Rightsizing (Compute
  Optimizer), Reservas/Tarifas (RI/SP), Zombies, TTL, Power Schedules, Análisis
  de Red, Etiquetas, Backups huérfanos. → **Fase 8**.
- **~12 páginas no tienen equivalente** y simplemente no aparecen con proveedor
  AWS: Hybrid Benefit, MACC, Copilot M365, Usuarios y Licencias, Lighthouse,
  Workbooks, AKS, AKS Chargeback, Cosmos DB, Container Apps, Defender, App
  Insights, Log Analytics.

### 3.4 Trampa: la abstracción multi-cloud existe pero está desconectada

`getCloudProvider()` en
[`providerFactory.ts`](../src/modules/collectors/providerFactory.ts) resuelve
Azure/AWS correctamente, pero **cero rutas de API lo usan**. En cambio hay **50
rutas que llaman a Azure ARM directamente**. Si esto no se resuelve en la Fase
7, cada página AWS termina siendo un fork copiado de la de Azure.

### 3.5 Sobre los repos de referencia

`aws-finops-dashboard-go` (Go), `aws-finops-dashboard` y `aws-finops-mcp-server`
(Python), `FinOps-Guardian` (Terraform + Lambda), `AWSCostOptimization`.
**Ninguno es importable** desde un Next.js/TS. Sirven como referencia de lógica
— qué llamadas a Cost Explorer / Compute Optimizer / Trusted Advisor hacer y
con qué umbrales. **Verificar la licencia de cada uno antes de copiar código.**

---

## 4. Lo que FALTA (en orden sugerido)

El orden importa: las Fases 2 y 3 son bloqueantes de todo lo demás (sin
identidad no hay signup AWS; sin modelo de proveedor no hay UI separada).
**Los backends de ambas ya están** — lo que bloquea hoy es su UI. Ver el
checklist consolidado de §8.

### Fase 2 — Identidad propia para tenants AWS — ✅ COMPLETA

La fase más grande y la única que toca código crítico existente. **Versión
barata elegida por el usuario**: no se reemplaza MSAL, se agrega una segunda
rama de autenticación en paralelo.

**Estado: backend implementado, tipado limpio y con tests (10 casos en
`__tests__/unit/localAuth.test.ts`). La UI también está escrita, pero sigue sin
commitear** — ver "Lo que queda" al final de esta sección.

**Diseño (implementado tal cual):**

- Nuevo `src/lib/localToken.ts`: emite y verifica un JWT propio (HS256 con
  `jose`, secreto en env). Payload con la misma forma que `AuthClaims`:
  `{ tid, oid, email, ... }` — así el resto del sistema no distingue.
- Branch en `validateRequestToken` (`src/lib/requestAuth.ts`). **Se discrimina
  por algoritmo, no por issuer**: nuestros tokens son HS256 y los de Entra
  RS256, y cada rama exige el suyo (`algorithms: ["HS256"]` en `jwtVerify` /
  el `header.alg !== "RS256"` existente), así que no hay confusión de
  algoritmo posible. **Es el único punto de cambio** —
  `requireRequestIdentity`, `requireTenantAccess`, `requireTenantRole`,
  `requireTenantTier` y las 244 rutas quedan intactas.
- Para tenants AWS, `tenant_id` es un **UUID generado** en vez del `tid` de
  Entra (el esquema no lo impide: es `VARCHAR(255)`).
- Un usuario es "local" **si y solo si `password_hash IS NOT NULL`**. Es el
  discriminador que usan todas las queries de `/api/auth/local/*`.
- El email de un usuario local es único a nivel **global**, no por tenant: el
  login sólo recibe email+password, así que el mismo email en dos tenants
  locales sería irresoluble. (Los de Entra no tienen esa restricción — ahí el
  tenant viaja en el claim `tid`.)
- `oid` de un usuario local es `local:<id>`. `requireTenantRole` ya resolvía
  por `(entra_oid = ? OR email = ?)`, así que matchea por email sin cambios.
- **MFA: no se tocó.** El TOTP de `src/lib/mfa.ts` ya era agnóstico.

**Endpoints implementados** (todos con rate limit distribuido vía
`rateLimiter.checkByKeyDistributed`, y todos fail-closed si falta
`LOCAL_AUTH_SECRET`):

| Endpoint | Qué hace |
|---|---|
| `POST /api/auth/local/signup` | Crea tenant (UUID) + Owner, manda verificación. 5/h por IP |
| `POST /api/auth/local/login` | Devuelve el JWT. 10/15min por email **y** 30/15min por IP |
| `POST /api/auth/local/verify-email` | Quema el token y setea `email_verified_at` |
| `POST /api/auth/local/password-reset` | Pide el link. Respuesta idéntica exista o no la cuenta |
| `PUT /api/auth/local/password-reset` | Canjea el token por contraseña nueva |
| `POST /api/auth/local/invite` | Admin/Owner invita. Valida cupo del plan |
| `PUT /api/auth/local/invite` | El invitado elige contraseña y entra como Reader |

**Decisiones de seguridad tomadas** (no revertir sin entender por qué):

- **Los tokens de un solo uso se guardan hasheados** (SHA-256) en `AuthTokens`,
  nunca en claro. Un dump de esa tabla no alcanza para tomar cuentas.
- **`consumeAuthToken` es atómico**: el `UPDATE ... WHERE used_at IS NULL`
  condicional hace que de dos requests simultáneas con el mismo token sólo una
  vea `affectedRows = 1`.
- **Emitir un token invalida los anteriores del mismo propósito.** Pedir un
  reset nuevo mata el link viejo.
- **`verifyPasswordConstantTime` gasta un bcrypt aunque el usuario no exista**,
  contra un hash dummy *válido*. Contra un hash inválido `compare()` retorna al
  instante y el timing vuelve a filtrar qué emails están registrados — hay un
  test que falla si eso se rompe.
- **El rol NO es parámetro de la invitación**: todo invitado entra como Reader.
  Aceptarlo dejaría a un Admin autoinvitarse como Owner.
- **El cupo de usuarios del plan se revalida al aceptar**, no sólo al invitar:
  entre las dos cosas pueden pasar días y el tenant pudo bajar de plan.
- **La política de contraseña es sólo longitud (12+)**, sin reglas de
  composición — NIST SP 800-63B las desaconseja explícitamente.
- Enumeración de cuentas: se **oculta** en el reset (respuesta idéntica), se
  **acepta** en el signup (409 "ya tiene cuenta"), porque ahí el usuario
  necesita saberlo para poder recuperar la cuenta. Es el trade-off estándar.

**Lo que QUEDA de esta fase:**

La UI **ya está escrita** pero vive **sin commitear en el working tree** (ver
§8). Lo hecho:

- `/login` con las dos opciones (Microsoft / email) — `LocalLoginForm.tsx`.
- Páginas `/verify-email`, `/reset-password`, `/accept-invite` sobre
  `AuthTokenPageClient.tsx`; los tres links que mandan los emails ya aterrizan
  (ver `buildAppUrl` en `localAuth.ts`).
- El punto delicado, **resuelto**: `src/lib/localSession.ts` guarda el token en
  el cliente y `getFreshIdToken` (`msalToken.ts`) lo devuelve antes de tocar
  MSAL, así que `fetchWithAuthRetry` y `TenantProvider` funcionan sin ramificar.
- i18n de las pantallas en `messages/{en,es,pt-BR}.json`.

Pendiente real:

- **Commitear todo eso.** Hoy sólo existe en el working tree.
- Las **plantillas de email siguen sólo en español**, hardcodeadas en
  `emailHelper.ts` — igual que las preexistentes. Localizarlas cuando haya un
  cliente que lo pida.
- Alta de `LOCAL_AUTH_SECRET` (32+ chars) en el `.env` de cada entorno y en el
  deploy. Sin eso los 7 endpoints devuelven 503 a propósito.

### Fase 3 — Modelo de proveedor por tenant + switch de UI — ✅ COMPLETA

Bloqueante de todo el panel AWS: sin esto no se sabe qué proveedor está mirando
el usuario. **El backend está completo y verificado; falta toda la UI.**

#### Lo que YA está implementado

- **Columna `Tenants.provider`** (`azure` | `aws` | `both`) — migración
  `20260725-004-local-auth.sql`, adelantada porque el signup local necesita
  escribir `'aws'` al crear el tenant. Default `azure` ⇒ todos los tenants
  actuales quedan correctos sin backfill.
- **Exclusividad por tier con enforcement server-side**. `assertProviderIngestable()`
  (`src/services/providerLifecycleService.ts`) corta la ingesta del proveedor
  que el tenant no tiene habilitado, en los cuatro puntos de entrada:
  - `POST /api/aws/accounts` (alta de cuentas AWS)
  - `POST /api/sync/aws/[id]/ce` y `/cur` (sync AWS)
  - `PUT /api/tenants` (contraparte Azure: escribe las credenciales del Service
    Principal; solo se valida cuando realmente vienen credenciales, renombrar el
    tenant no es ingesta)
  - `GET /api/cron/sync` excluye los tenants con Azure archivado
- **Qué pasa al bajar de tier con `provider = 'both'`** — era el riesgo abierto
  #7, ahora resuelto. Política completa en
  [`docs/provider-downgrade-policy.md`](./provider-downgrade-policy.md):
  **archivado reversible con ventana de gracia de 90 días**. El downgrade nunca
  borra en el acto; corta la ingesta (que es donde está el costo: CE cobra USD
  0.01 por request), conserva la serie histórica, **deja el export FOCUS abierto
  aunque el tier ya no lo habilite** (portabilidad, GDPR art. 20), avisa en T-30
  y T-7, y recién entonces purga con auditoría en `ActionLogs`. Volver a
  Enterprise antes del plazo restaura todo sin pérdida.
- **`applyTierChange()` como choke point único**, wireado en los 4 lugares que
  escriben `Tenants.tier` (Paddle created/updated, Azure Marketplace
  `ChangePlan`, AWS Marketplace `subscribe-success`, PATCH de superadmin). Antes
  de esto **bajar de tier no tenía ningún side-effect**. Es idempotente:
  reprocesar un webhook no abre una segunda transición.
- **Endpoint de estado y elección**: `GET/POST /api/admin/provider-transition`
  (estado de la cuenta regresiva; invertir qué proveedor se retiene).
- **Cron**: `GET /api/cron/provider-archive-purge` (avisos T-30/T-7 + purga por
  lotes). Falta agregarlo al crontab del VPS — ver §9 y el README.

**Gotchas de esta parte que conviene no re-descubrir a los golpes:**

- **`CostSnapshots.ProviderName` no es confiable para Azure.** Se agregó tarde
  con `DEFAULT 'Azure'` y las filas históricas quedaron con `NULL` o con
  `'Azure'` indistintamente; el mapper de AWS, en cambio, siempre escribe
  exactamente `'AWS'`. Filtrar Azure por `ProviderName = 'Azure'` **deja filas
  sin purgar** (verificado contra MySQL 8: perdía 1 de 2). El único filtro
  seguro en ambas direcciones ancla en `'AWS'`, y está centralizado en
  `providerPredicate()`. No reimplementarlo a mano.
- La elección automática del proveedor a retener compara gasto con `Decimal`,
  nunca float (Regla Cero): el resultado de esa comparación define qué dataset
  se borra.
- Invertir la elección **no reinicia el reloj** de la purga. Si lo reiniciara,
  un tenant podría alternar indefinidamente y retener gratis para siempre.
- Las credenciales AWS **no** se borran al archivar, solo al purgar: sin sync no
  generan gasto, y forzar un re-onboarding completo (crear de nuevo el rol IAM
  en la cuenta del cliente) a alguien que volvió a Enterprise en tres días es
  fricción gratuita.

#### UI — implementada

- **`src/lib/routeProviders.ts`** — mapa ruta → proveedores, con match por
  prefijo más largo (mismo mecanismo que `routeTiers.ts`). La decisión de diseño
  importante: **el default es azure-only, no "ambos"**. El panel nació 100% Azure
  y la mayoría de las páginas terminan llamando a ARM, así que si el default
  fuera permisivo cada página nueva que alguien olvide clasificar aparecería
  **rota** para un tenant AWS; con el default restrictivo, en el peor caso queda
  **oculta**. `AGNOSTIC_ROUTES` (administración, academy, soporte, superadmin,
  legal, upgrade…) es literalmente el marcador de avance de la Fase 7: habilitar
  el panel AWS = mover rutas a esa lista. `AWS_ROUTES` hoy tiene sólo
  `/admin/cloud-accounts`. `EXPLICIT_AZURE_ROUTES` existe para que el prefijo más
  largo resuelva bien casos como `/admin/onboarding/lighthouse`. La raíz `/` se
  matchea exacta (si no, sería prefijo de todo). 7 tests en
  `__tests__/unit/routeProviders.test.ts`.
- **`src/context/ProviderContext.tsx`** — `useCloudProvider()` expone
  `activeProvider`, `availableProviders`, `canSwitch`, `archivedProvider`,
  `isActiveArchived`. Persiste la elección en `localStorage` por tenant, igual
  que `TenantProvider`. Dos detalles: (a) lee storage en un `useEffect`, no en el
  inicializador de `useState`, porque el tenant se resuelve asincrónicamente y
  leer storage en render rompería la hidratación SSR; (b) **el proveedor
  archivado sigue siendo seleccionable** aunque el tier ya no lo habilite — si no,
  el cliente no tendría por dónde entrar a exportar sus datos antes de la purga.
- **`src/components/Sidebar.tsx`** — el filtro por proveedor se aplica **antes**
  que el de rol y el de tier: es una restricción del producto, no del usuario.
  De paso se reincorporó `/admin/cloud-accounts`, que estaba oculta a mano desde
  2026-07-05 ("no hacemos referencia a AWS por ahora"); ahora la oculta el filtro,
  así que un tenant Azure la sigue sin ver.
- **`src/components/ProviderSwitcher.tsx`** (header, sólo si `canSwitch`) y
  **`ProviderGraceBanner.tsx`** (cuenta regresiva, color escalando a rojo a ≤7
  días, botón de invertir sólo para Admin/Owner), montados en `ClientShell.tsx`.
- **`src/components/SignupPageClient.tsx`** — selector Azure/AWS; el camino AWS
  usa `LocalSignupForm.tsx` (email+contraseña) dentro de la misma tarjeta de plan.
- **`src/app/api/tenants/route.ts`** y `TenantProvider.tsx` — los 3 SELECTs
  devuelven `provider`/`provider_archived`/`provider_purge_at` y la interfaz
  `Tenant` los expone.
- **i18n** namespace `provider` (23 keys) en `es`/`en`/`pt-BR`, paridad
  verificada (4090 keys exactas).
- **Mocks por tier** (directiva #13): Enterprise = `both` (muestra el switch);
  **Business es el caso didáctico** — ex-Enterprise con AWS archivado y 23 días
  para la purga, así `/demo` muestra el banner; Professional/Essential = `azure`.
  El mock va en el interceptor de `window.fetch` de
  `TenantProvider.applyDemoFetchInterception()`, que es el patrón del repo, no un
  branch en el componente.

Lo único que quedó fuera a propósito: **los emails y notificaciones del ciclo de
vida siguen en español hardcodeado**, igual que el resto de las plantillas de
`emailHelper.ts`. Internacionalizarlas es un trabajo transversal a todas, no
específico de esta fase.

### Fase 3.5 — Credenciales de prueba y disponibilidad del login — ✅ COMPLETA

> Esta fase no estaba planificada. Surgió de la pregunta **"¿qué usuario y
> contraseña se va a usar?"** y terminó destapando un bug que hacía imposible
> iniciar sesión.

#### El hueco real

La Fase 2 dejó el signup local funcionando, pero el usuario queda **sin
verificar** y recibe un link por email. **En local no hay SMTP**, así que se
podía crear la cuenta y nunca entrar. No faltaba una contraseña: faltaba un
camino para obtener un usuario utilizable.

**Solución:** `scripts/seed-aws-tenant.ts` (`npm run seed:aws-tenant`), que crea
el tenant y un Owner **ya verificado**.

```bash
set -a && source .env.development && set +a
npm run seed:aws-tenant -- --email=demo@acme.test --password='pruebalocal-2026' \
  --tier=Enterprise --provider=both
```

- `assertNotProduction()` **se niega a correr con `NODE_ENV=production`**: es un
  script que crea un usuario con contraseña conocida y verificación saltada.
- Idempotente por email: re-ejecutarlo actualiza en vez de duplicar.
- Política de contraseñas vigente: **mínimo 12 caracteres**, sin reglas de
  composición (NIST SP 800-63B las desaconseja), bcrypt con 12 rounds.

**Credenciales creadas para pruebas locales:** `demo@acme.test` /
`pruebalocal-2026`, tenant `57e6b49a-7700-4fa3-b16b-682e6f44c45a`, Enterprise,
`provider='both'`.

#### 🔴 Bug crítico encontrado: el rate limiter devolvía 429 a todo el mundo

Al probar el login, `curl` devolvía `HTTP=000`. Aislando el handler en un test de
integración, el síntoma real resultó ser **429**, no un cuelgue.

**Causa raíz:** `pipeline.exec()` de ioredis **no lanza** cuando fallan los
comandos individuales. Devuelve `[[Error, undefined], [Error, undefined]]`. El
código hacía `Number(undefined)` → `NaN`, y `NaN <= limite` es `false` →
`allowed: false` → **429**. El `catch` que debía degradar a memoria nunca se
activaba, porque `exec()` no lanzaba nada.

**Lo peor:** no hacía falta que Redis estuviera caído. ioredis conecta de forma
*lazy* y con `enableOfflineQueue: false`, así que **el primer request tras
arrancar el proceso** fallaba con `"Stream isn't writeable"`. Es decir: el primer
intento de login después de cada arranque o hot-reload devolvía 429.

**Alcance:** 25 rutas, incluidas toda la API pública `/api/v1/*`, checkout,
leads, SSO y los 7 endpoints de auth local.

**Fix** (`src/lib/rateLimiter.ts`, `a7a6c54`): se inspeccionan los errores por
comando del pipeline y se valida `Number.isFinite(count)`, lanzando para caer al
fallback en memoria — que es lo que el docstring siempre prometió.

5 tests de regresión en `__tests__/unit/rateLimiterFallback.test.ts`, verificados
por mutación: revirtiendo el fix, 2 fallan.

#### Nota operativa: el dev server de Next se cuelga tras hot-reload

Síntoma: **todos** los endpoints devuelven `HTTP=000` indefinidamente y el
request ni aparece en los logs. Con el server recién arrancado, el mismo request
responde en 436 ms. **No es un bug del código.**

Procedimiento: matar por PID (`lsof -ti:3000` → `kill -9 <PID>`; `pkill` está
prohibido por las directivas) y relanzar. **Los tests de integración son
evidencia más confiable que `curl` contra el dev server.**

### Fase 4 — Onboarding automatizado AWS (spec §A.3) — ✅ COMPLETA

Antes, la pantalla de alta mostraba una trust policy escrita a mano y apuntaba a
tres **managed policies de AWS**: `job-function/Billing`,
`AmazonEC2ReadOnlyAccess` y `AmazonS3ReadOnlyAccess`. Esa última da lectura de
**todos** los buckets de la cuenta del cliente, no sólo del que contiene el CUR.
Pedir eso para leer un reporte de costos es desproporcionado y un cliente con un
área de seguridad exigente no lo aprueba.

**Implementado:**

- `src/lib/awsOnboardingTemplate.ts` — genera **CloudFormation**, **Terraform** y
  un snippet de **AWS CLI**, parametrizados con el account ID de la plataforma,
  el `externalId` y (si está configurado) el bucket/prefijo del CUR.
- `src/app/api/admin/onboarding/aws/route.ts` — `POST`, guard
  `requireTenantRole(['ADMIN','OWNER'])`, filtro por `tenant_id` en el `WHERE`
  además del guard, y **fail-closed 503** si falta `AWS_PLATFORM_ACCOUNT_ID`.
- UI: `admin/cloud-accounts` consume ese endpoint tras el alta y muestra la
  plantilla con selector de formato y copiado. i18n en los 3 idiomas.

**Permisos que la plantilla concede — y por qué son exactamente estos.** Se
extrajeron leyendo qué comandos del SDK ejecuta el código, no de la
documentación de AWS:

| Acción | Comando en el código |
|---|---|
| `sts:AssumeRole` | `AssumeRoleCommand` (`src/lib/aws/sts.ts`) |
| `ce:GetCostAndUsage` | `GetCostAndUsageCommand` (`src/lib/aws/costExplorer.ts`) |
| `ec2:DescribeInstances` | `DescribeInstancesCommand` (`awsProvider.ts`) |
| `s3:GetObject`, `s3:ListBucket` | `GetObjectCommand` / `ListObjectsV2Command` (`src/lib/aws/cur.ts`) — acotados al bucket del CUR |

> **Corrección a la versión anterior de este documento.** Se listaban como
> necesarios `ce:GetCostForecast`, `ce:GetReservationUtilization`,
> `ce:GetSavingsPlansUtilization`, `costoptimizationhub:*` y
> `organizations:ListAccounts`. **Ningún comando del código los usa hoy.**
> Incluirlos habría violado el principio de mínimo privilegio pidiendo permisos
> para features que no existen. Cuando la Fase 8 implemente esas llamadas, se
> agregan a la plantilla **en ese momento**.

**Decisiones de diseño no obvias:**

- **El endpoint descifra el `externalId`** (`decryptExternalId`). El alta lo
  devuelve una sola vez y queda cifrado; sin esto, un cliente que cerró la
  pestaña tenía que borrar y recrear la cuenta.
- **Es POST y no GET** para que el `externalId` no quede en la query string de
  los logs del servidor ni en el historial del navegador.
- **Los parámetros se validan antes de interpolar** (`assertParams()`). El
  artefacto resultante se ejecuta con permisos de IAM: un `externalId` con
  comillas y saltos de línea podría inyectar sentencias propias en la policy.
  Hay un test explícito de eso.

**Gotcha que costó encontrar:** el bloque condicional del CUR se generaba con 10
espacios de indentación cuando las sentencias base están a 14 → **YAML
inválido**, que sólo se habría descubierto al subirlo a CloudFormation. Por eso
el test **parsea el YAML generado con `js-yaml`** en vez de sólo buscar
substrings. Si tocás `curStatements`, respetá la indentación.

18 tests en `__tests__/unit/awsOnboardingTemplate.test.ts`.

### Fase 5 — Caché de Cost Explorer + resiliencia (spec §B.1 CRITICAL, §4) — ✅ COMPLETA (parcial: ver pendientes)

**Cost Explorer cobra USD 0.01 por request y cada página de la paginación cuenta
aparte.** Un tenant con varias cuentas y un dashboard que refresca solo podía
generar una factura de CE mayor que el ahorro que la herramienta le encuentra.

**Implementado en `src/lib/aws/costExplorer.ts`:**

- **Caché en Redis** con clave `aws:ce:v1:<accountId>:<start>:<end>`. La firma de
  `getCostAndUsage` ahora acepta un cuarto parámetro opcional
  `{ accountId?, bypassCache? }`; **sin `accountId` no se cachea**, porque la
  clave sería ambigua entre cuentas.
- **TTL diferenciado según si el rango cerró**: 24 h si `end` es hoy o anterior,
  1 h si incluye el día en curso, que AWS sigue actualizando varias veces al día.
  Cachear 24 h el día actual mostraría datos viejos como si fueran definitivos.
- **Redis caído o entrada corrupta degradan a lectura fresca.** La caché no puede
  ser un punto de falla para leer costos.
- **Retry con backoff exponencial + jitter** ante throttling y 5xx. El jitter
  importa: varias cuentas del mismo tenant sincronizan juntas y sin él
  reintentarían en el mismo instante, volviéndose a throttlear entre sí.
  Los errores de validación **no** se reintentan: sólo gastarían más dinero.
- **`AwsCostExplorerAccessError`**: traduce `AccessDeniedException` en un mensaje
  que nombra el permiso faltante (`ce:GetCostAndUsage`) y remite a la plantilla
  de onboarding, en vez de propagar el error crudo de AWS.
- **`invalidateCostExplorerCache(accountId)`**, llamada al borrar una cuenta. Usa
  **SCAN, no KEYS** — `KEYS` bloquea el servidor Redis entero mientras recorre el
  keyspace, y esto corre en el request path. El `account_id` se lee **antes** del
  `DELETE`: después ya no habría forma de saber qué claves invalidar.

**Llamadores actualizados:** `sync/aws/[accountId]/ce` y `awsProvider` pasan
`accountId` (cachean). El endpoint de **test de conexión usa `bypassCache: true`**
a propósito: su función es verificar que el rol funciona *ahora*, no devolver lo
que se leyó hace horas.

17 tests en `__tests__/unit/costExplorerCache.test.ts`, **verificados por
mutación**: desactivar la caché hace fallar 3.

**Pendiente de esta fase (no bloqueante):**
- Aviso en la UI de que los cost allocation tags tardan 24-48 h en reflejarse.
- Fallback CUR → CE cuando el CUR está vacío o no promovido.
- `GetCostForecast` para forecast de corto plazo (requiere sumar el permiso).

### Fase 6 — CUR 2.0 real (spec §B.2) — PARCIAL

El mapper solo entiende nombres de columna **CUR 1.0**
(`lineItem/UnblendedCost`). CUR 2.0 / Data Exports usa snake_case
(`line_item_unblended_cost`) y layout `BILLING_PERIOD=YYYY-MM/` en vez de
`<yyyymmdd>-<yyyymmdd>/`. El código lo declara "best-effort" pero en la práctica
devuelve **0 filas** contra un export CUR 2.0.

- Capa de normalización de nombres de columna (camelCase ↔ snake_case) antes de
  `mapCurRowToFocus`.
- Descubrimiento de partición para el layout nuevo en `findLatestBillingPeriod`.
- Backfill histórico (hoy solo se ingiere el período más reciente).

### Fase 7 — Panel AWS: las páginas genéricas — 🟡 EN CURSO

**Estado: la infraestructura de parametrización está hecha; falta migrar el
grueso de las páginas.**

#### Lo que se implementó

- **`src/lib/tenantProviderContext.ts`** (nuevo) — resuelve los proveedores
  activos de un tenant (`getTenantProviders`, `tenantUsesAzure`,
  `tenantUsesAws`), con caché en memoria de 60 s.
  - Ante base caída **degrada a Azure**, el comportamiento histórico: clasificar
    mal a un tenant Azure como AWS le escondería sus propios datos, que es peor
    que una query de más.
  - Los casos "sin fila" y "error de base" **no se cachean**, para no fijar un
    valor incorrecto durante un minuto.
  - `providerLifecycleService` llama a `invalidateTenantProviders()` tras cada
    commit que cambia `provider` (downgrade, elección, restauración, purga).
- **`/api/dashboard/summary`** saltea sus **tres** llamadas live a Azure cuando el
  tenant no usa Azure, y cae directo a `CostSnapshots`. Antes, un tenant AWS
  pagaba el timeout completo de cada llamada antes de ver el mismo fallback, y
  los logs se llenaban de `Azure unavailable` — que para un tenant AWS no es un
  incidente sino la configuración esperada.
- **Páginas habilitadas para AWS** en `routeProviders.ts`:
  `/intelligence/cost-by-category`, `/intelligence/cost-groups`,
  `/intelligence/simulator`.

#### El hallazgo que hace viable esta fase

**El sync de AWS escribe en `CostSnapshots`**, no sólo en `FocusLineItems` —
tanto el camino CE (`/api/sync/aws/[accountId]/ce`) como el CUR. Es decir: las
páginas que leen esa tabla ya muestran datos AWS reales sin escribir código
nuevo. Lo único que hay que hacer es (a) verificar que la ruta no llame a Azure
y (b) agregarla a `AGNOSTIC_ROUTES`.

#### Método de verificación (y por qué el automático no alcanza)

Se intentó clasificar automáticamente mapeando cada página a las APIs que llama
y resolviendo imports transitivamente. **No funciona**: el crawler sigue los
componentes globales del shell (chatbot, selector de tenant), que llaman a ~95
endpoints, así que **todas** las páginas salen "sucias". El resultado fue
inservible.

Dos correcciones necesarias al clasificar acoplamiento, ambas aprendidas por
falsos positivos:

1. **Separar "Azure como proveedor de datos de nube" de "servicios Microsoft
   para funciones de plataforma".** `emailHelper.ts` usa `graph.microsoft.com`
   **para mandar mails**. Contarlo como acoplamiento a Azure ensuciaba media
   base de código, incluida la propia `provider-transition`.
2. **`@azure/identity` tampoco cuenta**: se usa para autenticar contra servicios
   de la plataforma (Key Vault), no para leer datos del cliente.

**El método que sí funciona** es verificar la API principal de cada página, una
por una, resolviendo imports transitivos sobre ese archivo. Resultado real sobre
14 rutas FinOps candidatas:

| Ruta | Estado | Acoplamiento |
|---|---|---|
| `/intelligence/cost-by-category` | ✅ limpia | — |
| `/cost-groups` | ✅ limpia | — |
| `/intelligence/simulator` | ✅ limpia | — |
| `/budgets` | ❌ | vía `@/services/budgetService` |
| `/intelligence/anomalies` | ❌ | vía `@/services/anomalyDetectionService` |
| `/intelligence/top-expenses` | ❌ | vía `@/lib/azure` |
| `/intelligence/cost-projection`, `/forecast`, `/dashboard/summary`, `/chargeback`, `/history`, `/unit-economics`, `/scorecard` | ❌ | import directo |

#### Cómo seguir

El trabajo restante es **parametrización, no allow-list**. Para cada ruta sucia:
preguntar `await tenantUsesAzure(tenantId)` y saltear el camino live cayendo a
`CostSnapshots`, como ya se hizo en `dashboard/summary`. Orden sugerido por
valor: `forecast` → `top-expenses` → `budgets` → `anomalies`.

`forecast` es el caso más benigno: ya envuelve `getCurrentMonthAmortizedCosts` en
try/catch y `getCostForecast` devuelve `[]` en vez de lanzar. Para un tenant AWS
no rompe, sólo muestra datos pobres.

**Reglas que siguen vigentes:**
- **No crear componentes `*Aws.tsx` paralelos.** Si un componente necesita
  variar, que reciba el proveedor por prop. Duplicar el árbol garantiza que las
  dos mitades diverjan.
- Etiquetas: "Suscripción" → "Cuenta", "Resource Group" → "Cost Category / tag".
  Es i18n, en los 3 idiomas.
- Hay un test que verifica que habilitar `cost-groups` **no** arrastre por
  prefijo a las ~30 páginas Azure de `/intelligence`.

### Fase 7.5 — Mocks y demo AWS — ✅ COMPLETA

**Por qué existía el problema.** La directiva #13 exige mocks por tier para cada
feature, pero `src/lib/mockData.ts` (2330 líneas) era **100% Azure**: IDs
`/subscriptions/...`, proveedores `Microsoft.Compute`, SKUs `Standard_D8s_v3`.
Un tenant de demo no tenía forma de mostrar AWS, así que toda la venta del
producto AWS dependía de conectar una cuenta real.

**Decisión de diseño: tenants de demo separados, no un flag.** Se agregaron
**cuatro tenants AWS** (uno por tier) en lugar de un booleano sobre los de
Azure. El motivo es concreto: en una demo comercial se abren las dos nubes en
paralelo (dos pestañas), y con un flag sobre el mismo tenant eso es imposible.

| Tier | Tenant Azure | Tenant AWS |
|---|---|---|
| Essential | `1111...` Cliente ACME | `aaaa1111-...` Northwind Cloud |
| Pro | `2222...` Startup Tech | `aaaa2222-...` Cumulus Labs |
| Business | `4444...` Midmarket Corp | `aaaa4444-...` Vertex Retail |
| Enterprise | `3333...` Corporation XTZ | `aaaa3333-...` Helios Group |

**Los multiplicadores son deliberadamente los mismos que los de Azure**
(essential=1, pro=3, business=10, enterprise=50). Así, un tenant AWS y uno Azure
del mismo tier arrojan cifras del mismo orden de magnitud y la comparación
lado a lado es honesta. Hay un test que lo verifica (ratio entre 0.2 y 5).

**Qué contiene `src/lib/awsMockData.ts`** — datos AWS-nativos, no Azure
renombrado:
- Cuentas de 12 dígitos con `arn:aws:iam::<id>:role/CSCloudFinOpsReadOnly`, CUR
  configurado sólo en las primeras (así se habilita en la vida real, de a poco)
  y **una cuenta en estado `ERROR`**: la demo tiene que mostrar cómo se ve un
  problema, no sólo el camino feliz.
- Servicios con los códigos que devuelve Cost Explorer en la dimensión
  `SERVICE` (`AmazonEC2`, `AWSELB`, `AWSDataTransfer`), no los nombres
  comerciales.
- Regiones reales (`us-east-1`, `sa-east-1`) y su reparto de gasto.
- Rightsizing con familias reales, incluida la migración a **Graviton**
  (`m5`→`m6g`, `c5`→`c6g`), que es la palanca de ahorro más citada en AWS.
- Los cuatro huérfanos clásicos: Elastic IP sin asociar, EBS `available`,
  snapshots de volúmenes borrados, NAT Gateway ocioso.
- Compromisos: **Savings Plans vs Reserved Instances** (no "Reservas" a secas).
  El veredicto está armado como lo diría un FinOps: SP gana a 1 año por
  flexibilidad, RI a 3 por profundidad de descuento si la flota es estable.

**El bug de integración que costó encontrar.** El interceptor de `fetch` de
`TenantProvider.tsx` pasaba **siempre el tier** a `getMockDataForRoute(route,
arg2)`. Pero esa función distingue tenantId de tier **por la longitud de
`arg2`** (`> 20` ⇒ tenantId), y el dataset AWS sólo se puede elegir desde el
tenantId. Con el tier no había forma de saber la nube: se veían datos de Azure
dentro de la demo AWS. Se introdujo `mockKey`, que pasa el id cuando el tenant
es AWS (63 llamadas actualizadas).

**Degradación elegida:** si una ruta no tiene equivalente AWS,
`getAwsMockDataForRoute` devuelve `null` y se **cae al mock genérico** en vez de
mostrar una pantalla vacía. El Sidebar ya oculta esas páginas para AWS, así que
llegar ahí significa entrada por URL directa — mejor datos imperfectos que un
error.

**Seguridad del parámetro de proveedor:** la cookie de demo lleva ahora
`provider`, pero se **normaliza server-side** en `setDemoSession` (`aws` o
`azure`, nada más). Si se confiara en el valor del cliente, un valor arbitrario
seleccionaría un tenant de demo inexistente.

**Cómo se usa:** `/demo?tier=business&provider=aws`, o el selector de proveedor
que ahora tiene el formulario. Credenciales de la demo: `demo` / `demo`
(sin cambios).

**Verificación:** 26 tests (`__tests__/unit/awsMockData.test.ts`) cubriendo
escala por tier, determinismo, que los totales por servicio y por región sumen
el total del mes, ausencia de nomenclatura Azure, y el ruteo por tenant.
Comprobados **por mutación**: desactivando el ruteo AWS en `mockData.ts` falla
el test correspondiente.

**Pendiente menor:** `getAwsMockDataForRoute` cubre 8 rutas. A medida que la
Fase 7 habilite más páginas hay que ir agregando sus `case`.

### Fase 7.6 — Terminología por proveedor — ✅ COMPLETA

**Cómo se detectó.** Probando la demo AWS, el simulador What-If ofrecía
*"Crecimiento de Cómputo (VMs/AKS)"* y *"Aplicar Licencias (AHB)"*. **AKS y el
Azure Hybrid Benefit no existen en AWS.** Al revisar el resto de las páginas ya
habilitadas aparecieron más: Cost Groups hablaba de "Suscripción" y
"Resource Group", y Cost by Category atribuía sus categorías al *Microsoft
FinOps Toolkit*.

**Por qué importa más de lo que parece.** No es cosmético. Una herramienta de
FinOps vive de que el usuario crea sus números; leer el vocabulario de otra nube
es la señal más barata de que la herramienta no entiende su entorno. Y el costo
de arreglarlo crece con cada página que se habilite.

**Solución: variantes de clave, no diccionarios paralelos.**
`src/lib/useProviderTranslations.ts` busca `<clave>_aws` cuando el proveedor
activo es AWS y cae a la clave base si no existe. Así sólo se traduce lo que
difiere de verdad. La alternativa —un diccionario AWS completo— garantiza que
las dos mitades diverjan, que es el mismo error que ya se descartó al decidir
parametrizar el panel en vez de forkearlo.

Está implementado con un **Proxy** y no envolviendo la función a mano: `t` de
next-intl trae `rich`, `markup`, `raw` y `has`, y un wrapper parcial rompería
cualquier página que los use (de hecho el primer intento falló el typecheck por
esto).

**Hallazgo importante para Cost Groups.** El sync AWS escribe la **región** en
la columna `resource_group` de `CostSnapshots` —verificado en los dos caminos,
`sync/aws/[id]/ce` (`focus.Region || '*'`) y `sync/aws/[id]/cur` (`v.region`)—
y el `account_id` en `subscription_id`. Por lo tanto el equivalente correcto en
AWS de "Resource Group" es **"Región"**, no "tag" ni "Cost Category", y el de
"Suscripción" es **"Cuenta"**. Traducirlo como "tag" habría sido plausible y
**falso**: los Cost Groups de un tenant AWS agrupan por región.

| Concepto Azure | Equivalente AWS aplicado |
|---|---|
| VMs / AKS | EC2 / EKS |
| AHB (Azure Hybrid Benefit) | BYOL |
| Suscripción | Cuenta |
| Resource Group | Región (por cómo lo llena el sync) |
| Microsoft FinOps Toolkit (categorías) | Dimensión `SERVICE` de Cost Explorer |

**Red de contención.** `__tests__/unit/i18nProviderTerms.test.ts` recorre los
namespaces de las páginas habilitadas para AWS y **falla si alguna cadena usa un
término exclusivo de Azure sin variante `_aws`**, en cualquiera de los 3
idiomas. También verifica que ninguna variante `_aws` reintroduzca terminología
de Azure, y que las rutas que cubre sigan habilitadas para AWS. Verificado por
mutación: al quitar `computeLabel_aws` el test vuelve a señalar el AKS.

⚠️ **Al habilitar una página nueva para AWS en `routeProviders.ts` hay que
sumar su namespace a `AWS_FACING_NAMESPACES` en ese test.** Es el paso que
convierte la regla en automática; sin él la página entra sin revisar.

**Los dos pendientes de esta fase quedaron resueltos** en la Fase 7.7.

### Fase 7.7 — Correcciones del simulador y revisión automática — ✅ COMPLETA

Cierra los dos pendientes que había dejado abiertos la Fase 7.6.

**1. El motor del What-If (`6a3deb4`).** Tenía dos errores acumulados:

- El descuento por licencias se aplicaba al **costo total** del escenario
  (cómputo + storage + red). AHB cubre licencias de Windows/SQL, que se
  facturan junto con la VM: no abarata ni el almacenamiento ni el egress.
  Ahora se aplica solo al cómputo. Con el caso base de los tests, el proyectado
  pasa de 820 a 892 y el delta de –18 % a –10,8 %: **los escenarios guardados
  van a mostrar menos ahorro al recalcularse, y ese es el valor correcto.**
- El –18 % estaba calibrado para AHB y se aplicaba también a los tenants AWS.
  El default para AWS es 0 y el porcentaje pasa a ser un input declarado por el
  usuario (`licenseSavingsPct`, validado 0..100). No se inventó un número: BYOL
  en AWS exige Dedicated Hosts y depende del mix Windows/SQL, así que no hay un
  valor plano defendible.

**2. La revisión de terminología es automática (`428cc96`).** Dependía de una
lista de namespaces escrita a mano, que se desactualiza en silencio — justo el
mecanismo por el que se coló el “VMs/AKS”. Ahora el test parte de
`awsEnabledRoutes()`, resuelve el `page.tsx` de cada ruta y sigue sus imports
dentro de `src/` para juntar los namespaces del árbol. Solo mira de la página
hacia abajo: el shell global vive en el layout, así que **no** reproduce la
contaminación del crawler de rutas que se intentó antes.

Dos decisiones de diseño del test, para que no se revierta por error:

- El análisis estricto se limita a las páginas de **datos de nube**
  (`/intelligence`, `/governance`, `/overview`, `/cleanup`, `/advisor`). Las de
  admin y pricing quedan afuera porque su palabra “Subscription” es la
  suscripción comercial al SaaS, no una Azure Subscription; mezclarlas producía
  45 falsos positivos y volvía el test inservible.
- Los nombres de producto de la plataforma (Azure OpenAI, Microsoft Teams, Azure
  Marketplace, Entra) se descartan antes de buscar terminología: a un cliente
  AWS se le nombra “Azure OpenAI” con toda propiedad, porque es el motor de IA
  del SaaS y no un recurso suyo.

El test, ya automatizado, encontró un bug real: el banner de datos simulados le
decía **“Conecta tu suscripción Azure” a un tenant AWS** (`0918267`).

**Pendiente conocido de esta fase:** hay ~10 strings de `pricing.*` que dicen
“suscripciones de Azure” al describir el límite de scopes por tier. Un
prospecto de AWS los ve en la página de planes. Están fuera del alcance
estricto del test por la ambigüedad de “Subscription” descrita arriba, pero son
un error real de cara al cliente.

### Fase 7.8 — Ahorro Capturado y cobertura del framework — ✅ COMPLETA

**Auditoría de acoplamiento rehecha (`2b93786`).** Se resolvieron
transitivamente los imports de las 152 rutas de API. Resultado relevante: de las
páginas candidatas a habilitarse, **solo `/overview/captured-savings` sirve
datos reales a un tenant AWS**, porque lee `DailySnapshots` del dominio
`dashboard_summary`, que `/api/dashboard/summary` ya escribe para las dos nubes.

Las demás candidatas se descartaron con evidencia, no por prudencia:

| Ruta | Por qué no |
|---|---|
| `/intelligence/storage-efficiency` | Lee `CostMeterSnapshots`, que solo llena `collectors/azure/billingService`. |
| `/intelligence/optimization-index` (COIN) | Lee `RecommendationActions`, que solo llena `/api/advisor` (Azure Advisor). Daría cero, y un cero se lee como “no hay desperdicio”. |
| `/intelligence/cost-centers`, `/intelligence/allocation` | Agrupan por `CostSnapshots.Tags`, que el sync de AWS no llena: todo caería en “Sin asignar”. |
| `/intelligence/macc` | MACC es un compromiso de consumo de Microsoft. El equivalente AWS es el EDP; no es la misma página. |
| `/intelligence/tenant-health` | Mezcla `CostSnapshots` (ok) con `ExpiringCredentials` y `RecommendationActions` (ambos vacíos en AWS): mostraría una salud degradada artificialmente. |
| `/governance/credentials` | Consulta Microsoft Graph para listar App Registrations de Entra ID. No tiene equivalente: el onboarding AWS usa rol asumido, sin secreto que expire. |

**Cobertura del FinOps Framework** documentada en
`docs/finops-framework-coverage.md` (`fd73847`): matriz capability × proveedor
con la evidencia de qué acopla cada una a Azure.

La conclusión de fondo, que reencuadra el trabajo restante: **la sección
Gobernanza no está vacía para AWS por una allow-list incompleta, sino porque el
sync de AWS solo persiste costo agregado por (cuenta, región, servicio)**. No
hay inventario de recursos ni recomendaciones. Lo que falta es ingesta, no
habilitar páginas.

El gap de mayor impacto es **Allocation**: bloquea además Chargeback, Unit
Economics y Showback. Los tags de AWS ya se ingestan en `FocusLineItems.Tags`
(camino CUR), pero el agregado diario a `CostSnapshots` los descarta porque su
clave única es `(tenant, subscription, date, resource_group, service_name)` y no
tiene dimensión de tag. Las dos opciones y la recomendación están en el
documento de cobertura. **Ojo:** el camino de Cost Explorer sin CUR no trae tags
de recurso, así que un tenant que solo conecte CE seguirá sin allocation
cualquiera sea la opción elegida.

### Fase 7.9 — Expectativas del cliente: onboarding y precios — ✅ COMPLETA

Dos correcciones de lo que le prometemos a un cliente AWS.

**1. El onboarding avisa qué se pierde sin CUR (`cee1cf2`).** La sección de CUR
decía “opcional” y “alta fidelidad”, que no alcanza para dimensionarlo:
**Cost Explorer no devuelve las etiquetas de los recursos**. Un tenant que
conecte solo CE ve sus costos abiertos por cuenta, región y servicio, y se queda
sin asignación por equipo o proyecto, sin chargeback y sin unit economics — lo
descubría recién cuando todo aparecía en “Sin asignar”. La columna CUR de la
tabla pasó de gris a ámbar con el mismo texto como tooltip: no tener CUR es una
limitación funcional, no un estado neutro.

**2. La tabla de precios tiene selector de nube (`9ff4f40`).** Ofrecía
“1 suscripción de Azure” y features como “Asesor de Azure” o “Azure Lighthouse
Onboarding” a cualquier visitante, incluido el que viene por AWS.

Lo importante para quien retome esto: **no se pudo usar
`useProviderTranslations`**. Ese hook lee el proveedor del tenant activo, y
`PricingPage` se renderiza desde `ClientShell` bajo `!isAuthenticated` — es
pre-login, no hay tenant ni proveedor. Una variante `_aws` ahí no se elegiría
nunca. Por eso el proveedor lo elige el visitante con un selector, igual que el
ciclo mensual/anual.

Y el problema de fondo no era el vocabulario sino **ofrecer capabilities que no
existen para AWS**. `src/lib/pricingFeatureAvailability.ts` declara, por tier,
qué features tiene hoy un tenant AWS; la clasificación sale de
`docs/finops-framework-coverage.md`. Es fail-closed: un tier sin clasificar no
ofrece nada en AWS. Al elegir AWS, el límite de scope se cuenta en **cuentas** y
lo no disponible se muestra **tachado** — no oculto, para que el valor del
producto siga a la vista sin prometer lo que no hay.

La lista es posicional sobre `pricing.<tier>.features`, así que un
reordenamiento la desalinearía. Lo cubre
`__tests__/unit/pricingFeatureAvailability.test.ts`, que además falla si una
feature ofrecida en AWS nombra un producto exclusivo de Azure (verificado por
mutación: agregar “Asesor de Azure” a la lista de Essential lo hace fallar).

**Al habilitar una capability nueva para AWS hay que agregar su índice a
`AWS_AVAILABLE_FEATURES`**, o la tabla de precios va a seguir mostrándola
tachada.

### Fase 8 — Módulo C: optimización y huérfanos (spec §3 Módulo C) — NO EMPEZADO

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

### Fase 9 — Wiring y operación — NO EMPEZADO

- **No hay cron de sync AWS.** Hoy el sync solo corre apretando un botón en el
  admin. Azure tiene `src/app/api/cron/sync`; falta el equivalente
  `src/app/api/cron/aws-sync-daily` autenticado con `CRON_SECRET`.
- **No hay mock data de AWS** → los tenants demo no ven nada multi-cloud.
  Extender `src/lib/mockData.ts` (`isMockTenant` / `getMockDataForRoute`).
- i18n en los 3 idiomas (`messages/{es,en,pt-BR}.json`) para todo lo nuevo.
- Recordar la directiva del proyecto: **"CSCloudSolutions" nunca se traduce ni
  se reformatea en ningún idioma.**

---

## 5. Convenciones del proyecto a respetar

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

## 6. Riesgos abiertos / lo que NO está verificado

0. 🔴 **Violación de la Regla Cero en el parser de Cost Explorer — SIN RESOLVER.**
   `src/lib/aws/costExplorer.ts` (~líneas 72-74) usa **`parseFloat()`** sobre los
   montos que devuelve AWS (`unblendedCost`, `amortizedCost`, `usageQuantity`).
   La API de Cost Explorer los entrega como **string** precisamente para no
   perder precisión, y `CeDailyRow` los tipa como `number`. `AGENTS.md` prohíbe
   floats para cálculos de costo.

   **Impacto:** errores de redondeo de centavos que se acumulan al agregar miles
   de filas diarias. Sobre una factura de seis cifras el desvío es visible, y
   este dato alimenta chargeback — o sea, lo que un cliente le factura a sus
   propias áreas internas.

   **Por qué no se arregló acá:** el fix correcto es conservar el string y
   convertir con `decimal.js` (ya es dependencia, vía `src/lib/money.ts`), pero
   toca el tipo `CeDailyRow`, el mapper FOCUS (`mapCeDailyToFocus`) y los tres
   consumidores. **Sin datos AWS reales para validar el resultado, refactorizar
   a ciegas la ruta del dinero es más riesgoso que documentarlo.** Hacerlo junto
   con la primera prueba contra una cuenta real.

   > Nota: el mismo patrón conviene auditarlo en el parser de CUR antes de
   > facturar a un cliente.

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
5. **Fase 2 — la unicidad de email NO tiene constraint en la base.** Se evitó
   el `ADD UNIQUE (email, tenant_id)` a propósito: sobre datos vivos puede
   fallar por duplicados heredados, y el runner de migraciones ignora
   `ER_DUP_ENTRY` ⇒ el constraint quedaría silenciosamente sin crear, que es
   peor que no tenerlo. Hoy la garantiza el código (`localEmailTaken`, dentro
   de la transacción de signup/invite). Para promoverla a constraint real,
   correr primero en producción:
   ```sql
   SELECT tenant_id, email, COUNT(*) c FROM Users
    GROUP BY tenant_id, email HAVING c > 1;
   ```
   y recién con 0 filas, escribir una migración nueva con el `ADD UNIQUE`.
   **Mientras tanto hay una ventana de carrera teórica**: dos signups
   simultáneos con el mismo email pueden pasar los dos el chequeo. Improbable
   y de bajo impacto (el segundo login queda ambiguo), pero real.
6. **Fase 2 — superficie de ataque nueva.** Auth local es lo más sensible que
   se agrega al producto. Rate limiting, expiración de tokens de reset y
   hashing no son opcionales ni recortables.
7. **Fase 3 — downgrade de Enterprise con `provider = 'both'`.** ✅ **RESUELTO**
   — ver [`docs/provider-downgrade-policy.md`](./provider-downgrade-policy.md).
   Política: **archivado reversible con ventana de gracia de 90 días**. El
   downgrade no borra nada: corta la ingesta del proveedor que se pierde
   (que es donde está el costo — CE cobra USD 0.01 por request), conserva los
   datos y **deja el export FOCUS abierto aunque el tier ya no lo habilite**
   (portabilidad). Volver a Enterprise antes del plazo restaura todo sin
   pérdida; vencido el plazo, el cron `/api/cron/provider-archive-purge` purga
   con auditoría en `ActionLogs`. Implementado en `src/lib/providerPolicy.ts` +
   `src/services/providerLifecycleService.ts` +
   `migrations/20260725-005-provider-archive.sql`, con `applyTierChange()` como
   choke point único wireado en los 4 lugares que escriben `Tenants.tier`.
   **Queda un pendiente operativo**: el cron `provider-archive-purge` está
   documentado en el README pero **NO instalado en el crontab del VPS**. Sin él
   nadie recibe los avisos T-30/T-7 y nada se purga nunca — falla del lado
   seguro (se retiene de más), pero hay que instalarlo.
8. **Fase 3 — la política de archivado no se probó end-to-end contra datos
   reales.** El DDL sí se aplicó contra un MySQL 8 real (idempotencia
   confirmada) y el predicado de purga se verificó con filas de los tres tipos
   (`NULL` / `'Azure'` / `'AWS'`), pero **el ciclo completo
   downgrade → archivado → aviso → purga nunca corrió de punta a punta**. Los 26
   tests cubren la política pura, no las transiciones con base de datos.
   Probarlo en staging con un tenant de prueba antes del primer downgrade real.
9. **Fase 3 — la purga es irreversible y la dispara un cron.** Si alguien
   configura mal `PROVIDER_ARCHIVE_RETENTION_DAYS` o cambia a mano
   `TenantProviderTransitions.purge_at`, se borran datos de un cliente sin vuelta
   atrás. El valor de la env está clampeado entre 7 y 730 días y todo queda
   auditado en `ActionLogs`, pero **no hay backup selectivo por proveedor**: la
   única red de contención es el backup completo de MySQL
   (`scripts/backup-db.sh`). Antes del primer cliente grande, considerar volcar
   los datos a exportar a S3/Blob antes de purgar.
10. **Fase 7 — riesgo de fork.** Si se crean componentes `*Aws.tsx` paralelos en
   vez de parametrizar los existentes, las dos mitades del producto divergen y
   el mantenimiento se duplica de forma permanente. Es el riesgo más caro del
   plan entero y no da síntomas hasta que ya es tarde.

---

## 7. Archivos tocados

### Fase 2 — identidad propia (backend)

```
A  migrations/20260725-004-local-auth.sql
A  src/lib/localToken.ts
A  src/lib/localAuth.ts
A  src/app/api/auth/local/signup/route.ts
A  src/app/api/auth/local/login/route.ts
A  src/app/api/auth/local/verify-email/route.ts
A  src/app/api/auth/local/password-reset/route.ts
A  src/app/api/auth/local/invite/route.ts
A  __tests__/unit/localAuth.test.ts
M  src/lib/requestAuth.ts          (branch HS256 en validateRequestToken)
M  src/lib/emailHelper.ts          (3 plantillas: verify / reset / invite)
M  docs/aws-multicloud-handoff.md
```

Verificación: `npx tsc --noEmit` limpio; `npx vitest run` 576/576 en verde
(50 archivos, 3 skipped) — incluidos los 10 casos nuevos de `localAuth`.
**No probado end-to-end**: falta la UI y no se corrió la migración contra una
base real.

### Fase 3 — modelo de proveedor + ciclo de vida del archivado (backend)

```
A  migrations/20260725-005-provider-archive.sql
A  src/lib/providerPolicy.ts
A  src/services/providerLifecycleService.ts
A  src/app/api/admin/provider-transition/route.ts
A  src/app/api/cron/provider-archive-purge/route.ts
A  __tests__/unit/providerPolicy.test.ts
A  docs/provider-downgrade-policy.md
M  src/app/api/webhooks/paddle/route.ts                (applyTierChange x2)
M  src/app/api/webhooks/marketplace/azure/route.ts     (applyTierChange en ChangePlan)
M  src/app/api/webhooks/marketplace/aws/route.ts       (applyTierChange en subscribe-success)
M  src/app/api/admin/tenants/route.ts                  (applyTierChange en PATCH)
M  src/app/api/aws/accounts/route.ts                   (assertProviderIngestable)
M  src/app/api/sync/aws/[accountId]/ce/route.ts        (assertProviderIngestable)
M  src/app/api/sync/aws/[accountId]/cur/route.ts       (assertProviderIngestable)
M  src/app/api/tenants/route.ts                        (gate Azure + fix AuthError→500)
M  src/app/api/cron/sync/route.ts                      (excluye Azure archivado)
M  src/app/api/exports/focus/route.ts                  (excepción de portabilidad)
M  README.md                                           (cron + crontab)
M  .env.example                                        (PROVIDER_ARCHIVE_RETENTION_DAYS)
```

Verificación: `npx tsc --noEmit` limpio; `npm run lint` 0 errores; 26 tests
nuevos + suites de paddle/marketplace/aws/security en verde. DDL aplicado contra
**MySQL 8 real** en una base scratch: esquema correcto e idempotencia confirmada
(reaplicar devuelve `ER_DUP_FIELDNAME`, que el runner tolera). Predicado de
purga verificado con filas `NULL` / `'Azure'` / `'AWS'`.
**No probado end-to-end**: el ciclo downgrade → archivado → aviso → purga nunca
corrió completo (ver §6.8).

### Fase 3 — UI de proveedor (`8b8ad67`, `b6d5a42`, `a77e129`, `93894e8`, `854a7ae`)

```
A  src/lib/routeProviders.ts
A  src/context/ProviderContext.tsx
A  src/components/ProviderSwitcher.tsx
A  src/components/ProviderGraceBanner.tsx
A  src/components/LocalSignupForm.tsx
A  __tests__/unit/routeProviders.test.ts
M  src/components/Sidebar.tsx
M  src/components/ClientShell.tsx
M  src/components/SignupPageClient.tsx
M  src/components/TenantProvider.tsx
M  src/app/api/tenants/route.ts
M  src/lib/tenants.ts
M  src/lib/mockData.ts
M  messages/{en,es,pt-BR}.json
```

### Documentación

```
M  README.md                          (sección "Modelo multi-cloud" + changelog + auth)
M  MANUAL_DE_USUARIO.md               (sección 7)
M  docs/manual/MANUAL_USUARIO_{ES,EN,PT-BR}.md      (sección 13 + 1.1)
M  docs/manual/MANUAL_SUPERADMIN_{ES,EN,PT-BR}.md   (sección 13 + 1.1)
M  docs/manual/*.pdf, public/manual/*.pdf           (regenerados con scripts/generate-manual-pdfs.js)
A  docs/provider-downgrade-policy.md   (ADR de la política de 90 días)
```

### Sesión anterior — fundación de ingesta AWS

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

---

### Fase 7.5 — mocks y demo AWS (`033f940`, `4fa56a3`)

| Archivo | Qué |
|---|---|
| `src/lib/awsMockData.ts` | **nuevo** — dataset AWS por tier + `getAwsMockDataForRoute` |
| `__tests__/unit/awsMockData.test.ts` | **nuevo** — 26 tests |
| `src/lib/mockData.ts` | `MOCK_AWS_TENANTS`, `isAwsMockTenant`, ruteo al dataset AWS |
| `src/components/TenantProvider.tsx` | tenants demo AWS + `mockKey` (63 llamadas) + intercepción de `/api/aws/accounts` |
| `src/app/_actions/demoAuth.ts` | `provider` en la cookie, normalizado server-side |
| `src/app/[locale]/demo/page.tsx` | selector de proveedor y soporte de `?provider=aws` |

### Fase 7.6 — terminología por proveedor (`1f24af7`)

| Archivo | Qué |
|---|---|
| `src/lib/useProviderTranslations.ts` | **nuevo** — resolución de `<clave>_aws` vía Proxy |
| `messages/{en,es,pt-BR}.json` | 21 variantes `_aws` ×3 idiomas (4115 claves, paridad exacta) |
| `src/app/[locale]/intelligence/simulator/page.tsx`, `src/components/simulator/ScenarioManager.tsx` | What-If |
| `src/components/dashboard/CostGroupsBoard.tsx`, `CostGroupDetailModal.tsx` | Cost Groups |
| `src/components/dashboard/CostByCategoryDashboard.tsx` | Cost by Category |
| `__tests__/unit/i18nProviderTerms.test.ts` | **nuevo** — 5 tests, red de contención |
| `__tests__/components/useProviderTranslations.test.tsx` | **nuevo** — 5 tests del hook |

## 8. Checklist consolidado: qué falta para tener producto AWS

Ordenado por lo que desbloquea a lo demás. Los ítems marcados ⛔ son bloqueantes
de todo lo que viene después.

### ✅ Hecho — UI de Fases 2 y 3 (commiteada)

Ya no hay nada de UI transversal pendiente: login con las dos opciones,
`/verify-email`, `/reset-password`, `/accept-invite`, selector de proveedor en el
signup, switch AWS/Azure en el header, filtrado del Sidebar por proveedor, banner
de la ventana de gracia, i18n ×3 y mocks por tier. Validado con `lint` (0
errores), `typecheck` limpio, **609 tests** y `build` verde.

### ⏸️ Operación — diferido a propósito hasta después de las pruebas integrales

Decisión explícita del usuario (2026-07-25): nada de esto se ejecuta hasta
terminar las pruebas integrales en local. Queda documentado, no aplicado. Nótese
además que **no se hizo push** de ninguno de los commits de este trabajo.

- [ ] `LOCAL_AUTH_SECRET` (32+ chars) en el `.env` de cada entorno. Sin él los 7
      endpoints de auth local devuelven 503 a propósito.
- [ ] `PROVIDER_ARCHIVE_RETENTION_DAYS` (opcional, default 90).
- [ ] Instalar `provider-archive-purge` en el crontab del VPS (§6.7).
- [ ] Correr las migraciones `20260725-004` y `20260725-005` contra la base real.
- [ ] Destrabar el deploy del VPS (§6.4) — nada de esto llega al servidor hasta
      entonces.

### Verificación pendiente

- [ ] Probar la ingesta contra una **cuenta AWS real**: `POST /api/aws/accounts/[id]/test`
      + un sync de CUR completo. Nada se probó contra AWS de verdad (§6.1).
- [ ] Probar el ciclo downgrade → archivado → aviso → purga end-to-end en
      staging (§6.8).
- [ ] Definir retención/particionado de `FocusLineItems` antes del primer
      cliente grande (§6.2).

### ✅ Hecho — Fases 3.5, 4 y 5 (commiteadas, sin push)

- **Fase 3.5** — `npm run seed:aws-tenant` da credenciales usables en local (el
  signup dejaba al usuario sin verificar y sin SMTP no había forma de entrar), y
  se arregló el bug del rate limiter que devolvía **429 en el primer request tras
  cada arranque** en 25 rutas.
- **Fase 4** — Onboarding AWS con plantillas CloudFormation / Terraform / CLI de
  mínimo privilegio, expuestas en la UI de alta de cuentas. Reemplazan las
  managed policies sobre-permisivas (`AmazonS3ReadOnlyAccess` daba lectura de
  todos los buckets del cliente).
- **Fase 5** — Caché de Cost Explorer en Redis con TTL según si el rango cerró,
  retry con backoff + jitter y `AccessDeniedException` accionable.
- **Fase 7 (parcial)** — `tenantProviderContext` + `dashboard/summary`
  parametrizado + 3 páginas de costo habilitadas para AWS.
- **Fase 7.5** — Mocks y demo AWS: `src/lib/awsMockData.ts` + 4 tenants de demo
  AWS (uno por tier) + selector de proveedor en `/demo`. Cubre la directiva #13,
  que hasta ahora AWS incumplía por completo.

- **Fase 7.6** — Terminología por proveedor: el What-If le ofrecía "VMs/AKS" y
  "AHB" a tenants AWS. `useProviderTranslations` resuelve variantes `_aws` y un
  test impide que vuelva a pasar.

Validado: `typecheck` limpio, `lint` 0 errores, **705 tests** en verde y `build`
de producción exitoso.

### Producto — el resto de las fases

- [x] ~~**Fase 4** — Onboarding automatizado~~ ✅ completa. La lista de permisos
      que figuraba acá (`ce:*`, `costoptimizationhub:*`,
      `organizations:ListAccounts`) era **incorrecta**: ningún comando del código
      los usa. Se concedieron sólo los 4 que el código realmente llama.
- [x] ~~**Fase 5** — Caché de Cost Explorer~~ ✅ completa (caché, retry,
      `AccessDeniedException`). Quedan pendientes de la fase: fallback CUR → CE,
      `GetCostForecast` y el aviso de los 24-48 h de los cost allocation tags.
- [ ] **Fase 6** — CUR 2.0: el mapper solo entiende nombres CUR 1.0, así que
      contra un export CUR 2.0 devuelve **0 filas**. Falta normalización
      camelCase ↔ snake_case, el layout `BILLING_PERIOD=YYYY-MM/` y backfill
      histórico.
- [ ] **Fase 7** — Panel AWS. 🟡 En curso: la infraestructura de parametrización
      está hecha (`tenantProviderContext`) y `dashboard/summary` ya la usa.
      Falta migrar `forecast`, `top-expenses`, `budgets` y `anomalies` con el
      mismo patrón. **El riesgo de forkear el árbol de páginas (§6.10) quedó
      conjurado**: se parametriza, no se duplica.
- [ ] **Fase 8** — Módulo C: `awsProvider.getRecommendations()` devuelve `[]`.
      Instalar `@aws-sdk/client-cost-optimization-hub` y escribir los scanners
      (EC2 sobredimensionadas, EBS `available`, Elastic IPs sueltas, NAT
      Gateways, cobertura de SP/RI). Varios se resuelven con SQL sobre
      `FocusLineItems` en vez de llamadas extra a la API. **Al implementarlos hay
      que sumar los permisos correspondientes a la plantilla de la Fase 4.**
- [x] ~~**Fase 7.5** — Mocks y demo AWS por tier~~ ✅ completa. `/demo?provider=aws`
      entra con datos AWS-nativos; mismos multiplicadores que Azure para que la
      comparación entre nubes sea honesta.
- [ ] **Fase 9** — Cron de sync AWS (`aws-sync-daily`, no existe: hoy el sync
      solo corre apretando un botón) e i18n de las etiquetas del panel
      ("Suscripción" → "Cuenta"). El mock data por tier que figuraba acá ya se
      hizo en la Fase 7.5.
- [ ] 🔴 **Regla Cero** — reemplazar `parseFloat` por `decimal.js` en el parser de
      Cost Explorer (§6.0), junto con la primera prueba contra AWS real.
