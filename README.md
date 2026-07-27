# CSCloudSolutions FinOps Platform 🚀

La Plataforma FinOps de CSCloudSolutions es una solución SaaS B2B automatizada construida sobre Next.js App Router (React) orientada a la gobernanza cloud, auditoría (Omni-Scan), y optimización financiera para entornos empresariales en Microsoft Azure.

---

## 🏗️ Architecture

El sistema opera bajo una arquitectura de 3 capas fuertemente tipada y asegurada con autenticación basada en identidades de Azure:

1. **Frontend (App Router)**: Interfaz de usuario dinámica construida con React, Tailwind CSS, y Zustand (manejo de estado). Adaptada con internacionalización (`next-intl`) y soporte de temas (Dark Mode).
2. **API Layer (Next.js Edge/Node)**: Rutas backend que orquestan de manera segura la validación de acceso (`@azure/msal-react` / `@azure/msal-node`) y exponen lógica de negocio estructurada.
3. **Services & Azure SDK**: Capa de servicios inyectados (`src/services/`) que interactúan directamente con Microsoft Azure (Resource Graph, Cost Management, Compute) y una base de datos MySQL para persistencia de datos multitenant (Logs, Historial de Ahorro, Tenants).

### Infrastructure Diagram (Mermaid)

```mermaid
graph TD
    %% Entidades Externas
    User[FinOps User / Admin]
    Entra[Azure Entra ID]
    
    %% Frontend
    subgraph Frontend [Next.js App Router]
        UI[UI Components & Pages]
        i18n[next-intl Middleware]
        Zustand[Zustand State]
    end
    
    %% Backend
    subgraph Backend [Next.js API Routes]
        API_Auth[Auth Validation]
        API_Audit[Audit / Tags API]
        API_Power[Power Schedules API]
        API_Intel[Intelligence / Cost API]
    end
    
    %% Services & Data
    subgraph Core_Services [FinOps Services]
        GraphService[Resource Graph Service]
        CostService[Cost Management Service]
        ComputeService[Compute / Remediation Service]
    end
    
    MySQL[(MySQL Database\n- Tenants\n- Action Logs\n- Savings)]
    
    %% Azure Cloud
    subgraph Azure_Cloud [Microsoft Azure Cloud]
        ARG[Azure Resource Graph]
        ACM[Azure Cost Management]
        ARM[Azure Resource Manager]
    end
    
    %% Relaciones
    User -->|Access| i18n
    i18n --> UI
    UI -->|MSAL Token| Entra
    Entra -->|JWT| UI
    
    UI -->|REST API Calls| API_Auth
    API_Auth --> API_Audit
    API_Auth --> API_Power
    API_Auth --> API_Intel
    
    API_Audit --> GraphService
    API_Power --> ComputeService
    API_Intel --> CostService
    
    GraphService --> ARG
    CostService --> ACM
    ComputeService --> ARM
    
    API_Auth --> MySQL
    API_Power --> MySQL
```

---

## 📂 Project Directory Structure

```text
src/
├── app/
│   ├── [locale]/                 # Rutas de UI Internacionalizadas (App Router)
│       ├── admin/                # Configuración, Onboarding, Workbooks
│       ├── advisor/              # Integración de Azure Advisor
│       ├── cleanup/              # TTL Enforcement & Zombies
│       ├── governance/           # Power Schedules (VMs) y Gestión de Etiquetas
│       ├── intelligence/         # Facturación (Billing), Redes, Rightsizing, Licencias, Upload
│       ├── overview/             # Maturity Scoring, Progreso Histórico
│       ├── superadmin/           # Configuración de AI, Salud, Gestión de Tenants, Gestión de Staff (God Mode)
│       ├── layout.tsx            # Root Layout (Inyecta Providers y next-intl)
│       └── page.tsx              # Dashboard Principal
│   └── api/                      # Backend API Routes
│       ├── admin/
│       ├── advisor/
│       ├── audit/
│       ├── budgets/
│       ├── cleanup/
│       ├── consumption/
│       ├── intelligence/
│       ├── onboard/
│       ├── power/
│       ├── recommendations/
│       ├── remediation/
│       ├── subscriptions/
│       ├── superadmin/
│       ├── tags/
│       └── tenants/
├── components/                   # Componentes React Reusables
│   ├── dashboard/                # Widgets de métricas, PowerSchedules
│   ├── layout/                   # Sidebar, Navbar, etc.
│   └── remediation/              # Modales de confirmación de acciones
├── context/                      # React Context Providers (ViewMode, etc.)
├── db/                           # Conexiones y utilidades de Base de Datos
├── lib/                          # Utilidades Generales (Ej. Script Generator)
├── modules/                      # Lógica modular Core, Storage, y Collectors (Azure/Graph)
├── services/                     # Lógica de Negocio y Consumo de Azure SDKs
└── store/                        # Estado global de Zustand (ActionLogs, etc.)
```

---

## 🔒 Authentication & Least Privilege

El sistema opera un modelo de seguridad multi-nivel estricto:

1. **User Identity — dos caminos**:
   - **Azure (Entra ID)**: manejado vía MSAL (`@azure/msal-react`). Los tokens JWT (RS256) se validan contra el JWKS de `login.microsoftonline.com/{tid}` en todos los llamados a la API en `src/app/api`.
   - **Identidad propia (email + contraseña)**: para tenants sin un tenant Entra corporativo. `src/lib/localToken.ts` emite un JWT **HS256** con la misma forma que `AuthClaims`, y `validateRequestToken` (`src/lib/requestAuth.ts`) discrimina **por algoritmo** — cada rama exige el suyo, así que no hay confusión de algoritmo posible. Es el único punto de cambio: los guards y las ~250 rutas quedan intactos.
   - Requiere `LOCAL_AUTH_SECRET` (32+ chars). Sin él, los 7 endpoints de `/api/auth/local/*` devuelven **503 fail-closed**.
2. **Service Principal (Platform Agent)**: Los Tenants hacen Onboarding ejecutando un script de PowerShell que crea un **Service Principal Least-Privilege**.
3. **Role-Based Access Control (RBAC)** — Roles asignados por tier:

   **Todos los tiers (Essential):**
   - `Reader` — Resource Graph, Advisor, listado de recursos.
   - `Cost Management Reader` — API de Consumo Real (`/api/intelligence/billing`).
   - `Monitoring Reader` — Métricas para rightsizing.
   - `Billing Reader` — Visibilidad de facturación a nivel suscripción.

   **Professional (Essential +):**
   - `Tag Contributor` — Auto-tagging.

   **Business (Pro +):**
   - **Custom Remediation Role** con permisos **mínimos** de power management:
     - `Microsoft.Compute/virtualMachines/start/action`
     - `Microsoft.Compute/virtualMachines/deallocate/action`
     - `Microsoft.Compute/virtualMachines/restart/action`
     - `Microsoft.Resources/tags/write`

   **Enterprise (Business +):**
   - **Custom Remediation Role** **expandido** para limpieza de huérfanos:
     - Todas las de Business +
     - `Microsoft.Compute/disks/delete`
     - `Microsoft.Compute/snapshots/delete`
     - `Microsoft.Network/networkInterfaces/delete`
     - `Microsoft.Network/publicIPAddresses/delete`
     - `Microsoft.Network/networkSecurityGroups/delete`

   > ⚠️ **NOTA importante**: El script de onboarding **NO** asigna `Virtual Machine Contributor` ni `Desktop Virtualization Power On Off Contributor` porque otorgan permisos excesivos (incluyendo borrar VMs). Se usa exclusivamente el Custom Role con acciones explícitas.

   > ⚠️ **Suscripciones EA/MCA**: Para suscripciones bajo Enterprise Agreement o Microsoft Customer Agreement, el `Billing Admin` debe asignar adicionalmente `Enrollment Reader` o `Billing Account Reader` al SP en el scope de billing account (no es posible desde el script).

   > 🔖 **Reservas (RIs / Savings Plans)**: El detalle del blade *Reservations* (`/intelligence/commitments`) usa `Microsoft.Capacity/reservations`. Lectura requiere el rol **Reservations Reader** sobre el/los *reservation order(s)*; la acción de **renovación** (activar/deshabilitar auto-renew) requiere **Reservations Contributor** u **Owner** del order (menor privilegio suficiente). En la app, la mutación de renovación está protegida por `requireTenantRole(['Admin','Owner'])`.

   **Diagnóstico:** El endpoint `GET /api/admin/check-sp-roles` verifica automáticamente que el SP tenga todos los roles requeridos en cada suscripción y reporta los faltantes con instrucciones de remediación.

### 🔍 Diagnostic Endpoints

| Endpoint | Método | Para qué |
|---|---|---|
| `/api/admin/check-sp-roles?tenantId=...` | GET | Verifica que el Service Principal del tenant tenga **todos los roles requeridos** según su tier, en **cada suscripción** que ve. Devuelve estado por sub (`OK`/`PARTIAL`/`NO_ROLES`/`ERROR`), lista de roles asignados, lista de roles faltantes, y un `globalHint` accionable. Acepta opcionalmente `&subscriptionIds=id1,id2` para filtrar. |

**Ejemplo de respuesta exitosa:**
```json
{
  "success": true,
  "summary": {
    "tenantId": "8b41364f-...",
    "tier": "Essential",
    "spObjectId": "abc-...",
    "requiredRoles": ["Reader", "Cost Management Reader", "Monitoring Reader", "Billing Reader"],
    "totalSubscriptions": 3,
    "okCount": 1,
    "partialCount": 2,
    "noRolesCount": 0,
    "errorCount": 0
  },
  "subscriptions": [
    {
      "subscriptionId": "...",
      "assignedRoles": ["Reader", "Cost Management Reader", "Monitoring Reader", "Billing Reader"],
      "missingRoles": [],
      "status": "OK"
    },
    {
      "subscriptionId": "...",
      "assignedRoles": ["Reader"],
      "missingRoles": ["Cost Management Reader", "Monitoring Reader", "Billing Reader"],
      "status": "PARTIAL"
    }
  ],
  "globalHint": "⚠️ 2 suscripción(es) con roles incompletos. Roles faltantes: Cost Management Reader, Monitoring Reader, Billing Reader. ..."
}
```

---

## ☁️ Proveedor de nube

La plataforma es **Azure-only**. (El soporte AWS que existió durante una fase
de evaluación multi-cloud fue removido; ver el changelog más abajo para el
historial.)

---

## 📈 Recent Major Updates

### 2026-07-28 — Paridad de catálogo AWS: inventario EC2 y limpieza de recursos ociosos

- **De 38 a 63 de las 119 páginas del panel habilitadas para AWS.** El salto más grande no vino de escribir código nuevo: **19 páginas eran de plataforma** (alta, verificación de email, cobro del SaaS, cumplimiento, marketplace, app móvil) que el código ya servía sin depender de la nube del tenant, y estaban ocultas sólo porque el default de la allow-list de `routeProviders.ts` es azure-only. Un cliente AWS no podía ver ni su propia pantalla de facturación.
- **Bug de configuración que anulaba trabajo previo:** `routeProviders.ts` aplica `EXPLICIT_AZURE_ROUTES` *después* de `AGNOSTIC_ROUTES`, así que la pisa. `/admin/markup`, `/admin/report` y `/admin/copilot-m365` estaban en las dos listas: agregarlas a la agnóstica no tenía ningún efecto. Se verificaron y quedaron como agnósticas; en la lista Azure sólo siguen el alta por Service Principal y Azure Workbooks.
- **Nuevo inventario de recursos AWS (`awsInventoryService.ts`), que destraba la limpieza.** Azure resuelve el inventario con una consulta KQL a Resource Graph, global y gratuita; AWS no tiene equivalente (Config Advanced Query obliga a habilitar Config por región y se factura por ítem). El colector llama a las APIs de EC2 cuenta por cuenta y región por región, y detecta volúmenes EBS `available`, IPs elásticas sin asociar, snapshots propios de más de 90 días e instancias detenidas. En esas últimas se reporta **el costo de sus discos EBS, no el de cómputo**: una instancia apagada no factura cómputo, pero sus volúmenes se cobran enteros.
- **Las regiones a barrer salen de `CostSnapshots`,** que en AWS guarda la región: sin eso habría que consultar las ~30 regiones de AWS en cada request. Los precios EBS son una tabla estática operada con `Decimal` (Regla Cero) porque la Pricing API cobra por request y sólo se usan para estimar el ahorro de un recurso huérfano, que por definición aún no tiene línea propia en el CUR; el costo real sigue saliendo del CUR/Cost Explorer.
- **RBAC de menor privilegio:** el inventario sólo pide lectura sobre EC2 (`DescribeInstances`, `DescribeVolumes`, `DescribeAddresses`, `DescribeSnapshots`). Ninguna acción de escritura: la remediación mantiene su flujo con aprobación. Si al rol del cliente le falta un permiso, se pierde esa familia de recursos y no la respuesta entera; si un rol está revocado en una cuenta, las demás se siguen auditando.
- **La convención `@azure-only` ahora cubre también hallazgos,** no sólo componentes: `Zombies.issues.emptyRgs` ("grupo de recursos vacío") no tiene equivalente en AWS. La exención está verificada por un test que lee el motor de inventario, comprueba que nunca emita ese motivo y que todos los que sí emite estén traducidos en los tres idiomas.

### 2026-07-27 — Paridad del panel AWS: WhiteBoard, TOP Gastos, Anomalías y Proyección

- **El WhiteBoard ya funciona para AWS** — y era urgente: es el destino del redirect post-login, así que un tenant AWS aterrizaba en una página que su propio menú no listaba y cuya API fallaba entera (`getAzureCredential` estaba fuera de los `.catch()` por fuente). No era una página Azure: **5 de sus 10 fuentes salen de `CostSnapshots`**. Ahora el cliente de Resource Graph sólo se crea si el tenant usa Azure, y el Top 5 de regiones y servicios se resuelve por SQL. En AWS se rankea **por costo, no por cantidad de recursos**: no hay inventario, y el costo es además el dato que le importa a FinOps. Container Apps y Log Analytics se ocultan del board por ser servicios sin equivalente en AWS.
- **TOP Gastos, Detección de Anomalías y Proyección de costos** habilitados con el mismo criterio. En TOP Gastos el account ID de 12 dígitos se reemplaza por el alias cargado en el onboarding. La detección por Z-Score ya corría sobre `CostSnapshots`: lo único atado a Azure era un backfill del historial que en AWS no hace falta —y que además fallaba en cada request, bajando el TTL del caché de 6 h a 10 min—. La proyección reconstruye la serie desde `CostSnapshots` y usa `linearForecast`, el motor que ya vive en el repo, en vez de `ce:GetCostForecast`: AWS lo factura por request y sobre una serie ya ingestada el resultado es equivalente.
- **Bug preexistente corregido: el reporte ejecutivo salía siempre sin serie de proyección.** El endpoint de forecast sólo devolvía `data` cuando `withConfidence=false`, pero el default es `true` y ningún consumidor lo pasa: la rama era inalcanzable desde la UI, y `admin/report` arma `forecastSeries` con `forecast?.data`. Afectaba a Azure tanto como a AWS.
- **Bloqueo por proveedor al entrar por URL directa.** `isRouteAvailableForProvider` sólo filtraba el Sidebar: una página Azure-only seguía renderizando si se llegaba por URL o por un redirect, y mostraba un error crudo de credenciales. Ahora `RouteTierGate` la bloquea con el mismo criterio con que ya bloquea tier y permisos de dominio, y el aviso apunta al selector de proveedor si el tenant tiene las dos nubes.
- **Convención `@azure-only`**: un componente que cubre un servicio inexistente en AWS se marca en su cabecera. El test de terminología deja de exigirle variantes `_aws` —traducirlas sería inventar un producto— y a cambio **verifica que esté efectivamente oculto** para AWS en quien lo renderiza.

### 2026-07-26 — Multi-cloud AWS: onboarding de mínimo privilegio, caché de Cost Explorer y panel parametrizado

- **Onboarding AWS automatizado** (Fase 4). `POST /api/admin/onboarding/aws` (guard `requireTenantRole(['ADMIN','OWNER'])`, fail-closed 503 sin cuenta AWS de plataforma configurada) genera plantillas **CloudFormation, Terraform y AWS CLI** parametrizadas con el account ID de la plataforma y el `externalId` de la cuenta, y la pantalla de alta las muestra con selector de formato. El account ID se resuelve KV-first desde `infra-aws-platform-account-id` (fallback `AWS_PLATFORM_ACCOUNT_ID`). Reemplazan las tres managed policies que se sugerían antes: `AmazonS3ReadOnlyAccess` daba lectura de **todos** los buckets del cliente para leer un solo reporte de costos. La plantilla concede exactamente las acciones que el código invoca, extraídas leyendo los comandos del SDK y no la documentación de AWS: `sts:AssumeRole`, `ce:GetCostAndUsage`, el inventario EC2 de sólo lectura (`ec2:DescribeInstances`, `DescribeVolumes`, `DescribeAddresses`, `DescribeSnapshots`), los presupuestos nativos (`budgets:DescribeBudgets`, `budgets:ViewBudget`, acotados al ARN de presupuestos de la propia cuenta), las recomendaciones de compra de Cost Explorer (`ce:GetReservationPurchaseRecommendation`, `ce:GetSavingsPlansPurchaseRecommendation`), el inventario transversal por etiquetas (`tag:GetResources`, `tag:GetTagKeys`) y `s3:GetObject`+`s3:ListBucket` acotadas al bucket del CUR. **Los tenants onboardeados antes de esta versión deben re-ejecutar la plantilla**: sin los permisos nuevos el síntoma es un inventario vacío, no un error. No hay ni una acción de escritura, y un test afirma la **lista cerrada** para que no se amplíe sin una llamada real que lo justifique.

  > ⚠️ **Los clientes onboardeados antes de julio 2026 tienen que re-ejecutar la plantilla.** La versión anterior sólo otorgaba `ec2:DescribeInstances`, así que la limpieza de recursos ociosos fallaba con `AccessDenied` en volúmenes, IPs elásticas y snapshots — silenciosamente, mostrando la lista incompleta en vez de un error.
- **Caché de Cost Explorer** (Fase 5). CE cobra **USD 0.01 por request** y cada página de la paginación cuenta aparte, así que un dashboard que refresca solo podía costar más que el ahorro que encuentra. `getCostAndUsage` ahora cachea en Redis por `(cuenta, rango)` con TTL de 24 h si el rango ya cerró y 1 h si incluye el día en curso —que AWS sigue actualizando—, reintenta con backoff exponencial **y jitter** ante throttling (sin jitter, las cuentas de un mismo tenant se re-throttlean entre sí al sincronizar juntas) y traduce `AccessDeniedException` en un mensaje que nombra el permiso faltante. Redis caído degrada a lectura fresca: la caché no es un punto de falla.
- **Panel parametrizado por proveedor** (Fase 7, en curso). Nuevo `src/lib/tenantProviderContext.ts`: una ruta puede preguntar `tenantUsesAzure(tenantId)` y saltear el camino live de Azure, cayendo a `CostSnapshots` —tabla que el sync de AWS **ya alimenta**—. `/api/dashboard/summary` lo usa en sus 3 llamadas live: antes un tenant AWS pagaba el timeout completo antes de ver el mismo fallback. Se habilitan para AWS `cost-by-category`, `cost-groups` y `simulator`. **La decisión de fondo quedó tomada: el panel AWS se parametriza, no se forkea** — no hay componentes `*Aws.tsx` paralelos.
- **Fix de disponibilidad en el rate limiter**. `pipeline.exec()` de ioredis **no lanza** cuando fallan los comandos individuales: devolvía `undefined`, `Number(undefined)` daba `NaN` y `NaN <= limite` es `false`, así que el limiter respondía **429 a todo el mundo** en vez de degradar a memoria. No hacía falta que Redis estuviera caído: ioredis conecta *lazy*, así que el primer request tras cada arranque lo disparaba. Afectaba **25 rutas**, incluidas toda la API pública `/api/v1/*`, checkout, SSO y los 7 endpoints de auth local.
- **Credenciales para pruebas locales**: `npm run seed:aws-tenant -- --email=… --password=… --tier=Enterprise --provider=both` crea un tenant AWS con un Owner **ya verificado**. El signup normal deja al usuario sin verificar y envía un link por email; sin SMTP en local, no había forma de entrar. El script se niega a correr con `NODE_ENV=production`.
- ⚠️ **Riesgo conocido documentado**: el parser de Cost Explorer usa `parseFloat` sobre montos de dinero, en violación de la Regla Cero. Ver §6.0 de [`docs/aws-multicloud-handoff.md`](docs/aws-multicloud-handoff.md); el refactor a `decimal.js` queda atado a la primera prueba contra una cuenta AWS real.
- **Mocks y demo AWS por tier** (Fase 7.5). `src/lib/mockData.ts` era 100% Azure, así que la demo comercial no podía mostrar AWS sin conectar una cuenta real. Nuevo `src/lib/awsMockData.ts` con datos AWS-nativos —cuentas de 12 dígitos, códigos de servicio tal como los devuelve Cost Explorer (`AmazonEC2`, `AWSDataTransfer`), regiones reales, rightsizing con migración a **Graviton**, los cuatro huérfanos clásicos (Elastic IP, EBS `available`, snapshots, NAT Gateway) y **Savings Plans vs Reserved Instances**—. Se agregan **4 tenants de demo AWS** (uno por tier) en vez de un flag sobre los de Azure, para poder mostrar ambas nubes en paralelo; los multiplicadores son deliberadamente los mismos (1/3/10/50) para que la comparación entre nubes sea honesta. Se entra por `/demo?tier=business&provider=aws` o con el selector de proveedor del formulario; el valor se **normaliza server-side**. Una de las cuentas de demo aparece en `ERROR` a propósito: la demo debe mostrar cómo se ve un problema, no sólo el camino feliz.
- **Terminología por proveedor** (Fase 7.6). El simulador What-If le ofrecía "Crecimiento de Cómputo (VMs/AKS)" y "Aplicar Licencias (AHB)" a tenants AWS —donde ni AKS ni el Azure Hybrid Benefit existen—; Cost Groups hablaba de "Suscripción" y "Resource Group". Como el panel se parametriza y no se forkea, se resuelve con **variantes de clave**: `useProviderTranslations` busca `<clave>_aws` cuando el proveedor activo es AWS y cae a la clave base si no existe, así sólo se traduce lo que difiere de verdad (un diccionario AWS completo garantizaría que las dos mitades diverjan). Detalle que evitó una traducción plausible pero falsa: el sync AWS escribe la **región** en la columna `resource_group`, así que el equivalente de "Resource Group" en AWS es "Región", no "tag". `__tests__/unit/i18nProviderTerms.test.ts` **falla si una página habilitada para AWS usa terminología de Azure sin variante**, en cualquiera de los 3 idiomas.
- i18n en `es`/`en`/`pt-BR` con paridad verificada (4115 keys). Validado con `typecheck` limpio, `lint` sin errores, **705 tests** en verde y `build` de producción exitoso.

### 2026-07-25 — Multi-cloud AWS: identidad propia, modelo de proveedor y ciclo de vida de datos

- **Identidad propia para tenants AWS** (Fase 2). AWS no tiene un IdP equivalente a Entra, así que el camino de login AWS es email+contraseña: 7 endpoints en `/api/auth/local/*` (signup, login, verificación de email, reset de contraseña ×2, invitación ×2), todos con rate limit distribuido y fail-closed sin `LOCAL_AUTH_SECRET`. Se agrega una segunda rama de auth **en paralelo** a MSAL: el único punto de cambio es `validateRequestToken`, que discrimina por algoritmo (HS256 propio vs RS256 de Entra, cada rama exigiendo el suyo). Los guards y las ~250 rutas quedan intactos. UI completa: login con las dos opciones, `/verify-email`, `/reset-password`, `/accept-invite`, y el token local enganchado en `getFreshIdToken` para que `fetchWithAuthRetry` y `TenantProvider` funcionen sin ramificar.
- **Modelo de proveedor por tenant** (Fase 3). Columna `Tenants.provider` (`azure` | `aws` | `both`), con `both` restringido a Enterprise y **enforcement server-side** en los 4 puntos de ingesta. Selector de proveedor en el signup, switch AWS/Azure en el header (sólo si hay más de uno para elegir) y **filtrado del Sidebar por proveedor activo** — antes un tenant AWS habría visto los ~30 ítems de menú de Azure, todos rotos al abrirlos.
- **Política de datos al bajar de tier**: archivado reversible con ventana de gracia de 90 días, avisos en T-30/T-7, purga auditada y restauración total si el tenant vuelve a Enterprise antes del plazo. Punto único `applyTierChange()` wireado en los 4 lugares que escriben `Tenants.tier`. Banner in-app con la cuenta regresiva y las tres salidas (exportar / invertir la elección / volver a Enterprise). Rationale completo en [`docs/provider-downgrade-policy.md`](docs/provider-downgrade-policy.md).
- **Seguridad**: tokens de un solo uso hasheados en SHA-256 y consumidos atómicamente; emitir uno invalida los anteriores del mismo propósito; el rol **no** es parámetro de la invitación (todo invitado entra como Reader, si no un Admin podría autoinvitarse como Owner); el cupo del plan se revalida al aceptar, no sólo al invitar; `verifyPasswordConstantTime` gasta un bcrypt contra un hash dummy *válido* aunque el usuario no exista (con uno inválido `compare()` retorna al instante y el timing filtra qué emails están registrados).
- **Migraciones**: `20260725-004-local-auth.sql` (`Users.password_hash`/`email_verified_at`, `entra_oid` NULLable, tabla `AuthTokens`, `Tenants.provider`) y `20260725-005-provider-archive.sql` (`Tenants.provider_archived`/`provider_purge_at`, `TenantProviderTransitions`, `AwsAccounts.disabled_at`/`disabled_reason`).
- **Nuevas env vars**: `LOCAL_AUTH_SECRET` (obligatoria para el login AWS) y `PROVIDER_ARCHIVE_RETENTION_DAYS` (opcional, default 90, clampeada 7–730).
- **Nuevo cron**: `/api/cron/provider-archive-purge` (diario).
- i18n en `es`/`en`/`pt-BR` con paridad verificada (4090 keys), mocks por tier para `/demo` y manuales de usuario y superadmin actualizados en los 3 idiomas (MD + PDF).

### 2026-07-23 — Look & feel: unificación al azul de marca CSCloudSolutions (design system)

- Todo el proyecto usa ahora el **azul principal de marca `#0054A6`** (`--brand-deep`) de forma consistente. Se remapearon las escalas genéricas de Tailwind `blue-*` e `indigo-*` al ramp "deep" (anclado en `#0054A6`) y `sky-*` al ramp "bright" (anclado en `#00AEEF`, `--brand-bright`) directamente en `src/app/globals.css` vía `@theme`, evitando editar ~124 archivos y garantizando cohesión visual futura sin re-trabajo.
- `purple`/`violet` se mantienen como color semántico secundario distinto (token `--purple`).
- Los acentos primarios hardcodeados en gráficos (`#0ea5e9` → `#00AEEF`, `#3b82f6` → `#0054A6`) se alinearon al azul de marca; las paletas categóricas multiserie (arrays `COLORS`/`LINE_COLORS`) se conservan para diferenciar series.

### 2026-07-23 — Log Analytics: control de costos + tarjeta White Board + página (nueva feature, tier Business)

- Nueva capability de **control de costos de Azure Monitor Log Analytics Workspaces** (`Microsoft.OperationalInsights/workspaces`) que ataca las 3 palancas clásicas de gasto: **ingesta masiva innecesaria** (workspaces sin tope diario → recomendar filtrar en origen + `dailyQuotaGb`), **retención excesiva** (recortar `retentionInDays` sobre el umbral) y **Commitment Tiers** (migrar de Pay-As-You-Go al tier comprometido más conveniente según la ingesta diaria).
- **Endpoint**: `GET /api/intelligence/log-analytics?tenantId=...[&subscriptionId=...]` — feature **tier Business+** (`requireTenantTier(..., 'Business')`); tenants demo pasan por `requireTenantAccess` con datos sintéticos escalados por tier.
- **Servicio**: `src/modules/collectors/azure/logAnalyticsCostService.ts`. Roles Azure (Service Principal, **solo lectura**): **Reader** (Resource Graph) + **Cost Management Reader**. La ingesta se **estima** desde el costo y precios de referencia de Azure Monitor (marcada `estimated`); sirve para priorizar, no para facturar.
- **UI**: página dedicada `/intelligence/log-analytics` (KPIs + tabla con recomendación por workspace) y tarjeta `LogAnalyticsCard` en el White Board (`FeatureGuard` Business). Entrada en Sidebar, `routeTiers` Business, `pageRegistry`, `pageRoleTags` (FinOps), widget pineable. i18n `LogAnalytics` en en/es/pt-BR. Mocks por tier en el servicio.
- **Regla Cero**: montos agregados en centavos enteros (`src/lib/money.ts`).

### 2026-07-23 — Container Apps: control de costos + tarjeta White Board + página (nueva feature, tier Business)

- Nueva capability de **control de costos de Azure Container Apps** (`Microsoft.App/containerApps`): inventario, costo `MonthToDate` por app y detección de oportunidades de **scale-to-zero** (apps con `minReplicas >= 1` mantienen réplicas encendidas 24/7 aunque no reciban tráfico).
- **Endpoint**: `GET /api/intelligence/container-apps?tenantId=...[&subscriptionId=...]` — feature **tier Business+** (`requireTenantTier(..., 'Business')`); tenants demo pasan por `requireTenantAccess` con datos sintéticos escalados por tier.
- **Servicio**: `src/modules/collectors/azure/containerAppsCostService.ts`. Roles Azure requeridos (Service Principal, **solo lectura**): **Reader** (Resource Graph, inventario) + **Cost Management Reader** (costo por recurso). No requiere ningún rol de escritura.
- **UI**: tarjeta `ContainerAppsCard` en el White Board (`ExecutiveSummaryBoard`), envuelta en `FeatureGuard requiredTier="Business"`. Muestra costo mensual total, ahorro potencial por scale-to-zero y top-6 apps por costo (barras ámbar = candidatas a scale-to-zero). i18n `ContainerApps` en en/es/pt-BR. Mocks por tier dentro del servicio.
- **Regla Cero**: todos los montos se agregan en centavos enteros (`src/lib/money.ts`) para evitar drift de floats.

### 2026-07-18 — MFA: enforcement cableado a operaciones sensibles (opt-in por usuario)

- El enrollment 2FA (TOTP + QR + recovery codes) ya existía y funcionaba, pero la **exigencia del challenge en operaciones sensibles nunca estuvo cableada** (`requireMfaChallenge` y `MfaPromptModal` estaban definidos pero no se usaban en ningún lado). Ahora sí.
- Nuevo helper `enforceMfaIfEnabled(request, email, tenantId, operation, payload)` (`src/lib/requireMfaChallenge.ts`): respeta que **el 2FA es opcional por usuario** — si el usuario no lo tiene activado, la operación procede normal; si lo tiene activado, exige un challenge verificado (< 60s, con hash de payload) o devuelve 403.
- **Operaciones cableadas** (server): `delete_tenant` (`/api/admin/tenants/delete`), `change_plan` + `cancel_subscription` (`/api/billing/subscription` PATCH/DELETE), `change_billing_config` (`/api/admin/billing-markup`). Cada ruta captura la identidad de su guard existente (`requireSuperAdmin` / `requireTenantRole` / `requireTenantAccess`) y usa el email/tenant del **llamador** (creador del challenge), no el tenant objetivo.
- **Cliente**: nuevo hook reutilizable `useMfaChallenge()` (`src/hooks/useMfaChallenge.tsx`) que chequea `/api/mfa/status`, y si el 2FA está activo abre `MfaPromptModal` y adjunta el header `X-MFA-Challenge-Id` a la request. Cableado en `DeleteTenantModal`, `admin/billing` (upgrade + cancelar) y `PartnerMarkup`.
- Fix: `MfaPromptModal` enviaba `fetch` sin header `Authorization` (habría dado 401 contra `/api/mfa/challenge`); ahora usa MSAL (`getFreshIdToken`). Strings del modal i18n en `Mfa` (en/es/pt-BR). Ver `docs/mfa.md` → "Enforcement wiring".

### 2026-07-15 — Power Schedules: recurrencia semanal, timezone del navegador, fix crítico de ejecución y reducción de latencia

- **Fix crítico "apagado/reinicio no ejecuta"**: `executeDueSchedules()` usaba `setHours` (reloj local del proceso) en vez de `setUTCHours` sobre el epoch ya desplazado por `gmt_offset` — si el proceso no corría en GMT-3 el matching de fecha/hora fallaba silenciosamente para cualquier acción que no fuera la primera evaluada. También se corrigió `String(date)` de una columna `Date` de mysql2 (no da formato ISO, rompía la comparación "ya ejecutado hoy"). Verificado end-to-end contra Azure real (start/restart/shutdown, los 3 `SUCCESS` en `ActionLogs`) tanto en local como con el crontab real de producción.
- **Recurrencia semanal + rango horario:** nuevo modo "range" en `PowerSchedules.tsx` — se define un rango **"Desde–Hasta"** y los **días de la semana**; crea automáticamente un horario de encendido y uno de apagado con los mismos días (columna `days_of_week`, migración `20260716-001`).
- **Timezone por defecto = navegador:** el selector de GMT ahora detecta automáticamente el offset del navegador del usuario (`getTimezoneOffset()`) en vez de forzar GMT-3.
- **Reducción de latencia de ejecución:** `POST /api/power/schedule` dispara `executeDueSchedules()` de inmediato en background al crear/editar un horario (no espera al próximo tick); el cron externo pasó de cada 10 min a cada **2 min** (ventana 15→8 min). Latencia máxima esperable: ~2 min (o instantánea si el horario ya venció al guardarlo), más ~20-40s por acción de VM (tiempo real de la API de Azure).

### 2026-07-09 — Dashboard: histórico extendido, proyección de gastos, descarga What-If, tags de venta

Seis pedidos consecutivos sobre el dashboard, la Simulación (What-If) y el panel superadmin. Ver `docs/dashboard-improvements-2026-07-09.md` para el detalle técnico completo.

- **Histograma de costos + Estado de Gobernanza en modo demo:** el mock de `dashboard_summary` devolvía el histograma en formato `{name, value}` (categorías) en vez de `{date, cost}` (serie diaria) que espera el chart — quedaba vacío. Se agrega `complianceScore` precalculado por tier al mock para que el score de gobernanza no dependa del cálculo por-recurso (que da ~0% sobre zombies sin tags).
- **Lookback histórico hasta 13 meses (límite de Azure Cost Management Query API):** nueva `getHistoricalDailyCosts()` en `billingService.ts` que completa el histograma desde Azure cuando el snapshot local (`CostSnapshots`) no cubre toda la ventana pedida. El selector del dashboard ahora permite hasta 13 meses (antes 12, hardcodeado a 365 días).
- **Tarjeta de Proyección de Gastos** (tier Professional+): proyecta N meses (3/6/12/24) a partir del promedio mensual real de los últimos 12 meses, aplicando el % de crecimiento anual que el usuario ingresa (compuesto mes a mes, calculado con `Decimal.js` — Regla Cero). `src/lib/costProjection.ts` + `CostProjectionCard.tsx`.
- **Descarga de simulaciones What-If:** `ScenarioManager.tsx` permite exportar a CSV un escenario individual, todos los escenarios guardados, o la comparación lado-a-lado con delta vs. línea base.
- **Tarjetas bloqueadas por tier sin borde:** `FeatureGuard.tsx` no tenía borde/fondo propio y se fundía con el fondo oscuro; se agrega contenedor con borde y radio visibles.
- **404 al finalizar onboarding:** el dashboard vive en `/${locale}` (raíz), no en `/${locale}/overview` (ruta inexistente). Corregido en el wizard de onboarding, el callback SSO y el link del email de bienvenida.
- **Etiquetado de tenants por origen comercial (solo SUPERADMIN):** nuevo campo `sales_referrer` en `Tenants` (migración `20260709-001`), editable desde el Directorio de Entornos (`admin/onboarding`), para identificar clientes vendidos/referidos por un comercial. Expuesto únicamente en el branch de lectura SUPERADMIN de `GET /api/tenants` (least privilege).
- **Post-QA (misma tarde):** cache Redis + página dedicada `/intelligence/cost-projection` para la Proyección de Gastos (`GET /api/intelligence/cost-projection`, `getWithCache` TTL 6h); fix del loop del wizard de onboarding cuando un SUPERADMIN entra a un tenant demo (el guard de auto-redirect no excluía `isMockTenant()`); selector CSV/PDF para las descargas de What-If (`jsPDF` + `jspdf-autotable`).
- **Auditoría de moneda (CostUSD vs PreTaxCost):** `PreTaxCost` de Azure Cost Management viene en la moneda de facturación de la suscripción (no necesariamente USD) — la plataforma lo agregaba como si fuera USD en TODAS las queries (MTD del dashboard, forecast, chargeback, commitments, AKS, unit-economics, network, budgets, histórico). Nuevo `src/lib/azureCostColumn.ts` resuelve `CostUSD` por tenant con degradación automática a `PreTaxCost` (cacheada en Redis 7 días) si la oferta no lo soporta. Script `scripts/recalculate-cost-snapshots-usd.ts` (+ `docs/runbook-recalculate-cost-snapshots-usd.md`) para limpiar y recalcular el histórico ya persistido en `CostSnapshots`/`CostMeterSnapshots`/`CostCategorySnapshots`/`cost_snapshots`.

### 2026-07-05 — Seguridad (tercera tanda): rate limit IA, prompt injection, Redis, CSP report-only

Remediación de 8 hallazgos más del assessment, todo sin downtime. Ver `docs/security/audit-2026-07-05.md`.

- **IA-3 (ALTO) — prompt injection:** en el copilot, los datos no confiables (payload de tenant, `pageContext`, pregunta) se movieron del `system` prompt al mensaje de usuario, envueltos en delimitadores `<context_data>`/`<user_question>` con instrucción explícita de tratarlos como datos, no instrucciones.
- **IA-4 (ALTO) — denial-of-wallet:** rate limiting por (tenant, usuario) en todos los endpoints de IA (copilot 15/min; ai-report/assessment/upload 5 cada 5 min).
- **A-4 (MEDIO) — rate limiter distribuido:** nuevo `checkByKeyDistributed` con backend Redis (INCR+PTTL atómico) y **fallback transparente a memoria** si Redis no responde. Aplicado a IA, `checkout` y `sso/start` (throttle pre-login por IP).
- **A-6 — fuga de internals:** helper `src/lib/apiErrors.ts` (`serverError`) que loguea server-side y omite `details` en producción; aplicado a 18 handlers que devolvían `error.message` al cliente.
- **IA-6 (MEDIO) — inyección KQL:** validación de formato UUID de `subscriptionId` antes de interpolarlo en el query de Resource Graph (`sustainability`).
- **A-3 (MEDIO) — CSP:** CSP nonce + `strict-dynamic` desplegada en modo **Report-Only** (`src/proxy.ts`, compuesta con next-intl). No bloquea nada; recoge violaciones para validar antes de promover a enforcing y quitar `unsafe-inline`. Enfoque de bajo riesgo elegido para no romper checkout/login.
- **IA-5 (MEDIO):** marcador DLP documentado en `aiProvider.ts` (redacción de PII pendiente de decisión de producto).
- **A-2 (ALTO):** riesgo aceptado — `thrift`/`@dsnp/parquetjs` sin fix upstream; path parquet solo alcanzable vía endpoints AWS con RBAC ADMIN/OWNER, input semi-confiable, feature AWS oculta.

### 2026-07-05 — Seguridad IA-2: API keys de IA cifradas en reposo (AES-256-GCM)

Remediación del hallazgo **IA-2 (CRÍTICO)** del assessment: las API keys de IA por tenant (`Tenants.ai_api_key`) y global (`GlobalSettings`) se guardaban en **texto plano**; un dump/backup/acceso DBA exponía las keys de OpenAI/Anthropic/Azure/Gemini de todos los clientes (denial-of-wallet).

- Nuevo helper `src/lib/secretCrypto.ts` (AES-256-GCM, formato self-contained `enc:v1:<iv>:<authTag>:<ciphertext>`, clave maestra `MFA_ENCRYPTION_KEY` — la misma que MFA y el cache de Key Vault, ya en KV).
- Cifrado al escribir (`admin/config/ai` PATCH), descifrado al leer (`getAIConfig`) con **fallback transparente a plaintext legacy** (`decryptSecret` devuelve el valor tal cual si no lleva el prefijo). Migración de datos sin downtime.
- Columna `Tenants.ai_api_key` ampliada a `VARCHAR(1024)` (migración `20260705-003`, idempotente).
- Script `scripts/encrypt-existing-ai-keys.ts` (`--dry-run` disponible) para cifrar las keys ya existentes en prod; idempotente (salta las ya cifradas).
- De paso se remedió **IA-7**: el PATCH ahora invalida el cache in-memory de config IA (`invalidateAIConfigCache`), sin ventana de ~5 min con la key vieja tras rotar.
- 8 tests nuevos para `secretCrypto` (round-trip, IV aleatorio, idempotencia, retrocompat, detección de tampering).

### 2026-07-05 — Assessment de seguridad: remediados 2 hallazgos de código + hardening VPS

Assessment exhaustivo (VPS + app Next.js + IA). Postura general sólida; ver informe completo en [`docs/security/audit-2026-07-05.md`](docs/security/audit-2026-07-05.md). Remediaciones aplicadas en este ciclo:

- **IA-1 (CRÍTICO) — fuga cross-tenant en cache de IA:** `getAssessment` cacheaba en `AiCache` indexando solo por `sha256(metricsData)` sin `tenant_id`, y resolvía la key de IA global en vez de la del tenant. Ahora el hash incluye `tenantId`, se requiere `tenantId` explícito y se usa `getGeminiModel(tenantId)`. Sin migración de esquema (`hash_prompt` sigue VARCHAR(64)); las entradas viejas quedan huérfanas y se recalculan en el primer miss.
- **A-1 (ALTO) — stored XSS en FinOps Academy:** se eliminó `parseMarkdown` + `dangerouslySetInnerHTML` (sin sanitización) y se reemplazó por `<ReactMarkdown remarkPlugins={[remarkGfm]}>` sin `rehype-raw`, consistente con el resto de la app.
- **Hardening VPS (V-1/V-2/V-4/V-6):** SSH endurecido vía drop-in `99-hardening.conf` (`PasswordAuthentication no`, `PermitRootLogin prohibit-password`, `X11Forwarding no`) + neutralización de `50-cloud-init.conf`; `.env` de producción a `chmod 600`. Verificado con conexión nueva por key.

Pendientes priorizados para el próximo ciclo: IA-2 (keys de IA en texto plano), V-3 (reboot para kernel parcheado), IA-3/IA-4 (prompt injection + rate limit de IA), A-2 (dependencia `thrift`/`@dsnp/parquetjs`).

### 2026-07-05 — Auditoría de honestidad en pricing: corregidas 6 features sobre-vendidas

Auditoría completa de las ~50 features anunciadas en la pantalla de precios contra la implementación real (40+ confirmadas reales y funcionales). Se corrigieron/removieron las que prometían algo que el código no cumple:

- **Azure Key Vault BYOK (Secretos Gestionados por el Cliente)** → "Azure Key Vault (cifrado gestionado por la plataforma)". No existe ningún mecanismo para que el cliente aporte su propio Key Vault; es el KV interno de la plataforma.
- **M365 Copilot Connector + Studio Agent** → "Configuración de Costos de M365 Copilot". El propio código lo admite: `// NOTE: This is a mock-first implementation. No real Microsoft Graph API calls are made.`
- **SSO Federado (SAML / OIDC)** → "SSO Federado (SAML)". Solo SAML vía WorkOS está implementado; cero OIDC en el código de auth.
- **Residencia de Datos Multi-Región (UE / US / BR)** → removida del pricing Enterprise. Mismo hallazgo que la entrada de Sidebar ya oculta: sólo hay un datacenter real (Brasil).
- **Tarifas Custom (EA)** y **Azure OpenAI Cost Analytics** → removidas (sin evidencia de implementación real en el código).
- **Gamificación y Scorecard** → "Scorecard y Ranking de Equipos". Existe un ranking real por equipo con score y penalizaciones, pero no hay mecánica de gamificación (badges, puntos, niveles).
- **Monitoreo de Frescura de Datos (Pipeline Health)** → removida de Essential. Es una herramienta interna de super-admin (`requireSuperAdmin`), sin panel visible para el cliente.
- **Detección de Anomalías** (duplicado en Business) → removida; el motor real (Z-Score) ya se lista en Professional y los tiers son acumulativos ("Todo lo de X").

Aplicado en paridad en los 3 idiomas (es/en/pt-BR), conteos verificados. Ninguna corrección requirió cambios de código — sólo redacción del pricing.

### 2026-07-05 — Ocultar referencias a AWS (por ahora)

No hacemos referencia a AWS por el momento. Se oculta la entrada "Cloud Accounts (AWS)" del Sidebar y del page registry (pin de dashboard), y se remueven las 2 menciones de AWS en las features de la pantalla de precios (Business: "Ingesta Multi-Cloud AWS"; Enterprise: "Billing AWS Marketplace SaaS") en los 3 idiomas. El código de ingesta AWS (CUR/Cost Explorer), el webhook de AWS Marketplace y la landing `/marketplace/aws` **no se tocan** — quedan implementados y funcionales, sólo sin superficie de navegación ni promesa comercial, para cuando se retome soporte AWS.

### 2026-07-05 — Fix Signup Funnel (401) + canal de email de Alertas migrado a Graph + MFA activado en prod

- **Signup Funnel (SuperAdmin) 401**: la página hacía `fetch('/api/superadmin/funnel')` sin el Bearer token MSAL (mismo patrón de bug ya visto en `TagInheritancePanel`). Corregido.
- **Alertas Self-Service, canal `email`**: usaba SMTP genérico (`nodemailer`) vía `SMTP_HOST/USER/PASSWORD`, nunca configurado en prod → fallaba en silencio (`console.warn`, sin error visible). Migrado a **Microsoft Graph** (`emailHelper.ts`), el mismo mecanismo ya usado para leads/invoicing — un solo sistema de email en toda la plataforma. Se remueve la dependencia `nodemailer`/`@types/nodemailer` (sin más usos).
- **MFA local (TOTP) activado en prod**: es una segunda verificación para operaciones sensibles dentro de la app ya logueada (aprobar gastos, borrar tenants, cambiar billing) — no reemplaza el login con Microsoft/MSAL, lo complementa (ver `docs/mfa.md`). `MFA_ENCRYPTION_KEY` no existía en el `.env` de prod; se generó y agregó (queda en el `.env` plano a propósito — es un secreto de bootstrapping, no migrable a Key Vault). Efecto colateral positivo: también habilita el caché encriptado en disco de Key Vault (`~/.finops-data/kv-cache.enc`), antes deshabilitado por falta de clave.

### 2026-07-05 — Fase 2: consolidación de secretos en Key Vault (Paddle, Azure SP, backup SAS, Gemini)

Extiende el patrón de `infraSecrets.ts` (ya usado para `DB_PASSWORD`/`REDIS_PASSWORD`/`CRON_SECRET`, Fase 0.1) a 6 secretos más: `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` (ahora Live), `AZURE_CLIENT_SECRET`, `AZURE_MARKETPLACE_AAD_APP_SECRET`, `BACKUP_AZURE_SAS_URL` y `GEMINI_API_KEY`. Mismo mecanismo fallback-seguro (KV primero, `.env` si KV no responde); `scripts/migrate-infra-secrets-to-kv.ts` extendido con la misma lista para poblar KV desde el VPS. **No migrables a propósito**: las credenciales de acceso al propio Key Vault y `MFA_ENCRYPTION_KEY` (bootstrapping — no se puede guardar la llave de la caja fuerte dentro de la caja fuerte). **Fuera de alcance**: `SMTP_*`/`MFA_ENCRYPTION_KEY` no están configurados en prod (sin email/2FA activos hoy), es un tema aparte. Detalle completo en `docs/key-vault-integration.md`.

### 2026-07-05 — Gestión de tenants: activar suscripción TRIAL→ACTIVE + Data Residency deshabilitada (feature engañosa)

- **`/admin/tenants` (SuperAdmin):** la columna "Suscripción" era texto plano; ahora es un `<select>` editable (TRIAL/ACTIVE/PAST_DUE/CANCELED/EXPIRED) igual que el Tier. `PATCH /api/admin/tenants` acepta `subscriptionStatus` opcional (además de `tier`, cada uno independiente o juntos). Permite al superadmin activar manualmente un tenant que quedó en TRIAL sin depender de un webhook de Paddle.
- **Data Residency oculta del Sidebar**: la feature ofrecía elegir entre 5 regiones (EU/US/LATAM/APAC/GLOBAL) con listas de subprocesadores, pero hoy sólo existe **un datacenter real (Azure Brazil South)** — la UI sugería una capacidad que no existe. Se sacó la entrada de `Sidebar.tsx` (página y API quedan implementadas, sin romper, para cuando haya multi-región real). Se corrigió además `/legal/subprocessors` (página legal pública) que afirmaba tener subprocesadores en 4 regiones y prometía "routing por región en Q2 2026" — ahora refleja el estado real (Brasil, único deployment) con nota de "futura mejora sin fecha". `docs/data-residency.md` y `docs/qa-checklist.md` actualizados con el mismo criterio.

### 2026-07-05 — Paddle Live habilitado en prod + aviso de correo corporativo en checkout

- **Paddle Live activado en producción** (solo VPS; local/dev sigue en sandbox): se descomentó el bloque `#PRODUCCION` del `.env` del VPS (API key, webhook secret y 6 price IDs live) y se comentó el bloque `#SANDBOX`. Requirió `docker compose up -d --build` (no alcanza con restart) porque `NEXT_PUBLIC_PADDLE_*` se usa en `PricingPage.tsx` (`"use client"`) y esas variables se inlinean en build-time en el bundle del navegador. Verificado: `PADDLE_API_KEY` runtime = `pdl_live...`, health check 200, webhook `/api/webhooks/paddle` responde 401 (vivo) y la *Notification Destination* ya está configurada en el dashboard de Paddle Live.
- **Aviso de correo corporativo antes del checkout**: como el correo usado en Paddle queda como cuenta admin del tenant, `PricingPage.tsx` ahora muestra un modal de confirmación antes de abrir el checkout embebido, prellenando el email con el que el usuario ya inició sesión (MSAL `accounts[0].username`) vía el campo `customer.email` de `Paddle.Checkout.open()`. Nuevas keys i18n `pricing.corporateEmailNotice.*` (es/en/pt-BR).

### 2026-07-05 — Fix: página de Facturación (plan en N/A, pago inactivo, 502 al cambiar plan)

- **Tier/Estado en "N/A"**: la UI pedía `GET /api/billing` esperando `{tier, status, trialEndsAt, paddleSubscriptionId, marketplace*}`, pero ese endpoint devuelve la URL de actualización de pago de Paddle (y 404 si el tenant no tiene `paddle_subscription_id`). Los datos siempre existieron en `Tenants`; nunca se exponían en ese shape. **Nuevo endpoint `GET /api/billing/plan`** (RBAC OWNER) que lee el plan directo de la DB sin llamar a Paddle.
- **Botón "Método de pago" inactivo**: colateral del anterior (`billingInfo` quedaba `null`). Resuelto al poblar el plan; el botón se habilita cuando hay `paddle_subscription_id`.
- **Cambiar plan → 502**: el tenant era Enterprise; `tierToPriceId('Enterprise')` es `null` y no hay flujo self-service de Paddle para pricing negociado. Ahora Enterprise muestra un aviso de **contactar al equipo comercial** en lugar del modal. Además, `preview`/`PATCH` de suscripción **propagan el `error.detail` de Paddle** (sin secretos) para diagnosticar fallos reales (ej. suscripción de otro entorno sandbox/prod) en vez de un 502 mudo.

### 2026-07-05 — Fix operativo: `/api/cron/sync` faltaba en el crontab del VPS

Cost by Category, Storage Efficiency y Compute Efficiency mostraban "sin datos" / "verificá que la sincronización haya corrido" en prod. Causa: el README siempre documentó `/api/cron/sync` (snapshot diario de costos → `CostSnapshots`/`CostMeterSnapshots`/`CostCategorySnapshots`) como cron diario 06:00 UTC, pero esa entrada **nunca se instaló** en el crontab real del VPS — sólo estaban `prewarm-dashboard`, `power-schedules` y `open-data`. No era un bug de código: las 3 tablas de costo estuvieron vacías desde siempre en prod por falta del disparador, sin ningún error visible (el dashboard general no dependía de ellas, sólo estas 3 features nuevas).

- Se agregó la entrada faltante al crontab del VPS (backup del crontab previo tomado antes de editar).
- Se disparó un sync manual para backfillear de inmediato: 320 filas insertadas, 3 de 5 tenants sincronizados con éxito en el primer run.
- Los 2 tenants restantes no sincronizaron por falta de Service Principal configurado (onboarding técnico incompleto de esos clientes) — no requiere acción de código.
- Se agregó una nota de verificación periódica en la sección [Cron Jobs](#-cron-jobs) para detectar este tipo de drift crontab-vs-documentación en futuras auditorías/migraciones de VPS.

### 2026-07-05 — Hotfix de incidentes en producción

Diagnóstico y corrección de un conjunto de fallos reportados en prod:

- **Partner Markup (500 "Fallo al obtener margen")**: la columna `Tenants.markup_percentage` sólo existía en el `CREATE TABLE` de `db.ts` (no-op sobre la tabla preexistente) y nunca tuvo una migración `ALTER`. Nueva migración idempotente `20260705-001`.
- **Alertas Self-Service (500 al crear reglas)**: el código consulta una tabla `Budgets` (GET/POST budgets, `LEFT JOIN` en alerts, `/api/mcp`, powerbi-feed) que **nunca se creaba** en el esquema (`ER_NO_SUCH_TABLE`). Nueva migración `20260705-002` que la crea con el esquema derivado de todas las queries.
- **Dashboard / Reporte Ejecutivo (`fetch failed`)**: los self-fetch server-side usaban `request.nextUrl.origin` (dominio público) → NAT hairpin desde el contenedor. Nuevo helper `getInternalBaseUrl()` (loopback `127.0.0.1:$PORT`, override con `INTERNAL_BASE_URL`) aplicado en `dashboard/summary` y `cron/prewarm-dashboard`.
- **Herencia de Tags (401)**: `TagInheritancePanel` hacía fetch sin el Bearer token MSAL a endpoints protegidos por `requireTenantAccess/requireTenantRole`. Se agrega el id token.
- **Cumplimiento de Etiquetas**: paginación + autorefresh (60s, sólo con la pestaña visible) en `TagManager`.
- **Nota operativa**: las páginas de costo (Categoría / Storage / Cómputo) muestran cero porque las tablas `Cost*Snapshots` están vacías: el sync de Azure viene fallando por throttling (429) y `AADSTS700016` (SP sin consentir en directorios cliente). Es un tema de pipeline/consentimiento, no de código.

### 2026-07-05 — Ola 2: Reporting de Gobernanza (nueva feature, tier Enterprise)

Nueva página `/governance/reporting` con tres vistas read-only de gobernanza, todas con roles ya
presentes en el tier Essential (Reader):

- **Cumplimiento de Azure Policy** (PolicyInsights `policyStates/latest/summarize` REST): recursos y
  políticas no conformes, y nº de asignaciones. Distinto de `/governance/policies` (que despliega
  Azure Policy; esto lo *reporta*).
- **Inventario de recursos** (Resource Graph): total y desglose por tipo y por región.
- **Identidades/roles (RBAC)** (Resource Graph `authorizationresources`): asignaciones de rol por tipo
  de principal (User/ServicePrincipal/Group).

`governanceReportingService` + `GET /api/governance/reporting` (RBAC `requireTenantAccess`, tier
Enterprise) + UI de 3 secciones + i18n es/en/pt-BR + mocks por tier. **Verificado contra Azure real**:
122 recursos no conformes / 32 asignaciones de política, 376 recursos inventariados, 219 asignaciones
de rol (110 User / 106 ServicePrincipal).

### 2026-07-05 — Ola 2: colectores SQL Elastic Pool + VMSS ociosos en el motor de zombies

Dos colectores nuevos en `kqlCatalog` / motor de limpieza (`/cleanup/zombies`), cerrando gaps del
Optimization Engine del FinOps Toolkit:

- **`emptySqlElasticPools`**: Elastic Pools de SQL sin bases de datos (facturan capacidad reservada
  sin alojar nada) — join en KQL a `sql/servers/databases` por `elasticPoolId`. Gasto puro; costo
  estimado por tier (Standard $150 / Premium $400).
- **`idleVmss`**: VM Scale Sets escalados a 0 instancias — flag de gobernanza (sin costo de cómputo;
  el rightsizing por métricas de utilización queda para otra feature).

Ambos heredan el tier del motor de zombies (sin nueva superficie). Labels en la tabla de la UI.

### 2026-07-05 — Ola 2: Simulación Savings Plan vs Reservation (nueva feature, tier Enterprise)

Nueva página `/intelligence/commitment-simulator` que compara, por término (1 y 3 años), el ahorro
mensual estimado de una **Reserva (RI)** vs un **Savings Plan (SP)**, con un veredicto de cuál conviene.

- **Números nativos de Azure** (no heurística propia): `commitmentSimulatorService` cruza la
  **Reservation Recommendations API** (`@azure/arm-consumption`) y la **Benefit Recommendations API**
  (`@azure/arm-costmanagement`). Ambas operan por suscripción (no MG) y usan `Cost Management Reader`
  — **ya incluido en el tier Essential**, sin rol nuevo. Montos con `decimal.js` (Regla Cero).
- **Endpoint**: `GET /api/intelligence/commitment-simulator` (RBAC `requireTenantAccess`, tier Enterprise).
- **UI** `CommitmentSimulatorDashboard` (comparación lado a lado por término + guía de decisión),
  i18n es/en/pt-BR (namespace `CommitmentSimulator`), mocks por tier, registrada en Sidebar/registry.
- **Verificado contra Azure real** (tenant productivo, 4 suscripciones): SP a 3 años ahorraría
  **$861/mes (23% de ahorro, 85% de cobertura)**, sin recomendación de RI ni de SP a 1 año.
- **Fix colateral**: el sync de `OpenDataCommitmentEligibility` estaba roto (el toolkit migró a columnas
  FOCUS `x_CommitmentDiscount*Eligibility`) → todos los meters figuraban como no elegibles. Corregido:
  75.943 RI-elegibles / 99.840 SP-elegibles (antes 0). Reactiva `commitments/recommendations`.

### 2026-07-04 — Ola 2: Costo por Categoría FinOps (nueva feature, tier Business)

Nueva página `/intelligence/cost-by-category` que desglosa el gasto por **categoría FinOps**
(Compute/Storage/Networking/Databases/...), uniendo el costo por `ResourceType` a la categoría
canónica del FinOps Toolkit.

- **Clave de join correcta**: se captura `ResourceType` en el sync (query C de Cost Management,
  dimensión `ResourceType`) → tabla dedicada `CostCategorySnapshots` (migración `20260704-003`).
  El join `resource_type → OpenDataServices.service_category` tiene cobertura **~100%** (2 de 330
  tipos son ambiguos), vs. ~75% si se usara el `ServiceName` de billing (dejaba ~25% en "Other").
- **Endpoint**: `GET /api/intelligence/cost-by-category` (RBAC `requireTenantAccess`, tier Business).
  No lee Azure en el request; los datos los puebla `/api/cron/sync` (rol `Cost Management Reader`).
- **UI**: `CostByCategoryDashboard` (barra apilada 100% + detalle por categoría), i18n es/en/pt-BR
  (namespace `CostByCategory`), mocks por tier, registrada en Sidebar/pageRegistry/routeTiers.
- **Verificado end-to-end** con tenant real: 0% "Other" (Compute 67% / Networking 9% / Storage 7%
  / Management&Governance 7% / Web 5% / Databases 4% / Analytics 2%).

### 2026-07-04 — Ola 1 de adopción del FinOps Toolkit (enriquecimiento con Open Data)

Tres mejoras que aprovechan reference-data del Microsoft FinOps Toolkit que **ya ingeríamos pero no aplicábamos**:

1. **Fix del sync de regiones**: `syncRegions` (`src/lib/openData.ts`) buscaba la columna `ResourceLocation`, pero el toolkit la renombró a `OriginalValue` → el sync tiraba error y `OpenDataRegions` quedaba **vacía**. Ahora acepta `OriginalValue`/`ResourceLocation`/`Location`.
2. **Nombre canónico de región en compute-cost-per-core**: el desglose por región mostraba el valor crudo de billing (`us east`); ahora aplica `getRegionFriendlyName()` → `East US`. Fallback al valor crudo si el dataset no está sincronizado.
3. **Cron semanal de Open Data** (`GET /api/cron/open-data`): sincroniza los 5 datasets a `OpenData*`. Sin esto los lookups quedaban en null. Estos datasets cambian con baja frecuencia → semanal (lunes 04:00).
4. **Colector de Application Gateways sin uso** en el motor de zombies (`kqlCatalog.unusedAppGateways`): detecta App GWs sin backend pools o sin reglas de ruteo (gasto puro), con costo estimado por tier (Standard/WAF/v2). Cierra un gap de recomendación del Optimization Engine del toolkit.

Estas mejoras **enriquecen features existentes** (compute-efficiency = Professional, zombies/cleanup) y heredan su tier; el cron es interno (protegido por `CRON_SECRET`, sin tier).

### 2026-07-04 — Fix Storage Efficiency: tabla dedicada `CostMeterSnapshots` para filas a nivel de meter

**Bug:** el cron `sync` escribía dos desgloses del mismo costo en `CostSnapshots`: (A) por
ResourceGroup y (B) por `MeterSubCategory` con `resource_group='*'`. La
`UNIQUE KEY (tenant, sub, date, resource_group, service_name)` hacía colisionar entre sí a todas
las filas B de un mismo servicio: cada `ON DUPLICATE KEY UPDATE` pisaba la subcategoría anterior y
**solo sobrevivía la última** (Storage Efficiency nunca veía los tiers Hot/Cool/Archive reales).
Además, A+B en la misma tabla duplicaba el costo en cualquier consumidor que sume.

**Fix:** las filas B viven en `CostMeterSnapshots` (migración `20260704-001-cost-meter-snapshots.sql`),
con `UNIQUE KEY (tenant, sub, date, service_name, MeterSubCategory)` — la subcategoría integra la
clave y se normaliza a `''` (nunca `NULL`; MySQL trata los NULL como distintos en unique keys).
La migración además elimina las filas B corruptas históricas de `CostSnapshots`.

**Consumidores actualizados** (fuente primaria `CostMeterSnapshots`, fallback legacy a `CostSnapshots`):
`/api/intelligence/storage-efficiency` (expone `diagnostics.source: 'meters' | 'legacy'`) y
`/api/intelligence/compute-cost-per-core`. `insertCostSnapshotRow` ya no ejecuta `ALTER TABLE`
ad-hoc por fila (las columnas las garantizan el `CREATE TABLE` y la migración).

**Tests:** `__tests__/unit/storageEfficiency.test.ts` (tiers por subcategoría sin colapso, fallback
legacy, estado vacío, normalización de la clave en el insert).

**Follow-up (misma fecha) — región real en compute-cost-per-core:** el desglose "por región"
mostraba todo como `unknown` porque se derivaba de `resource_group` (vacío en filas de meter, y
un RG no es una región). La query B del sync ahora agrega la dimensión `ResourceLocation` de Cost
Management (3 groupings: `ServiceName + Meter + ResourceLocation`), persistida en la nueva columna
`CostMeterSnapshots.resource_location` (migración `20260704-002`, integrada a la unique key para no
colapsar un mismo meter facturado en varias regiones). Verificado end-to-end: el panel pasa de
`unknown` a regiones reales (`us east`, `us west 2`, ...).

### 2026-07-02 — Historial diario genérico (retención ≥ 1 año, consultable por página)
Framework **write-through** que persiste una foto (snapshot) diaria de las métricas clave de
cada página y permite consultarlas históricamente. Retención **400 días** (~13 meses), con poda
automática por escritura (sin cron adicional).

**Modelo de datos:** tabla `DailySnapshots` (migración `20260702-001-daily-snapshots.sql`)
con `UNIQUE(tenant_id, subscription_scope, domain, snapshot_date)` → un registro por
tenant/scope/dominio/día (`ON DUPLICATE KEY UPDATE` idempotente). Payload en `LONGTEXT` (JSON serializado).
Sin FK a `Tenants` (resiliencia: el write-through nunca debe romper el request principal).

**Dominios capturados:** `dashboard_summary`, `commitments`, `rightsizing`, `anomalies`,
`budgets`, `governance` (extensible vía `SNAPSHOT_DOMAINS`).

**Servicio:** `src/services/snapshotService.ts` → `recordDailySnapshot` / `recordDailySnapshotAsync`
(fire-and-forget, best-effort), `getSnapshotHistory`, `getSnapshotRange`, `getSnapshotDomains`,
`SNAPSHOT_RETENTION_DAYS = 400`.

**Endpoint:**

| Endpoint | Método | RBAC app | Notas |
|---|---|---|---|
| `/api/history` | GET | `requireTenantAccess` | Params: `tenantId`, `domain`, `from?`, `to?`, `scope?`, `tier?`. Default: último año. Tenants demo → serie simulada por tier. |

**UI:** componente reutilizable `<HistoryButton domain="..." title="..." />`
(`src/components/history/HistoryButton.tsx`, self-contained con MSAL + `useTenant`) montado en el
header de Dashboard, Descuentos por Compromiso, Rightsizing, Anomalías, Presupuestos y Alta
Disponibilidad. Abre un panel con selector de rango (hasta 1 año), gráfico de líneas (recharts) y
tabla; grafica automáticamente las métricas numéricas del payload.

**i18n:** namespace `History` (es/en/pt-BR, 9 keys c/u). **Mocks:** `getMockSnapshotHistory(domain, tier, from, to)`
en `src/lib/mockData.ts` (serie determinista escalada por tier).

**Adopción en una página nueva:** (1) en el route handler, llamar
`recordDailySnapshotAsync(tenantId, '<domain>', { ...métricas numéricas }, scope)` sobre datos
frescos (no degradados/mock); (2) añadir `'<domain>'` a `SNAPSHOT_DOMAINS`; (3) montar
`<HistoryButton domain="<domain>" title={...} />` en el header; (4) opcional: añadir un `case`
en `getMockSnapshotHistory` para la demo.

### 2026-07-01 — Reservas Activas: detalle del blade Azure Reservations
La sección **Reservas Activas** de *Descuentos por Compromiso (RIs & Savings Plans)*
(`/intelligence/commitments`) ahora replica el blade **Reservations** del portal de Azure,
consumiendo `Microsoft.Capacity/reservations` (best-effort, degradación silenciosa sin permisos).

**Columnas nuevas:** Nombre, Estado, Expiración, Alcance (Scope), Tipo, Nombre del producto,
Región, **Renovación**, Cantidad, **Utilización último día** y **últimos 7 días**.

**Interacción:**
- **Renovación** → botón que abre un modal para **activar/deshabilitar la auto-renovación**
  (mutación real vía `PATCH Microsoft.Capacity/reservationOrders/{orderId}/reservations/{id}`),
  invalidando la caché `commitments:v3:{tenantId}` al aplicar.
- **% de utilización** (clic sobre el porcentaje) → modal con **aggregates 1/7/30 días** +
  **tendencia diaria (30 días)** desde Consumption `reservationsSummaries` (best-effort EA/MCA).

**Endpoints:**

| Endpoint | Método | RBAC app | Rol Azure mínimo |
|---|---|---|---|
| `/api/intelligence/commitments` | GET | `requireTenantAccess` | Reservations Reader |
| `/api/intelligence/commitments/reservations/utilization` | GET | `requireTenantAccess` | Reservations Reader |
| `/api/intelligence/commitments/reservations/renew` | PATCH | `requireTenantRole(['Admin','Owner'])` | Reservations Contributor / Owner |

**Cambios asociados:** `src/services/reservationService.ts` (+`getActiveReservations`,
`getReservationUtilizationTrend`, `setReservationRenew`, `parseReservationResourceId`);
componentes `ReservationRenewalModal` y `ReservationUtilizationModal`; namespace i18n
`Commitments` (es/en/pt-BR, 41 keys c/u); mocks por tier (`reservationDetails` +
`reservation_utilization`). Sin cambios de esquema en DB.


### 2026-06-28 — FinOps Toolkit Gap Closure (P2/P3/P4)
Implementación de 15 features inspirados en `microsoft/finops-toolkit`, con datos mock para Tenants demo, i18n completo (es/en/pt-BR), `FeatureGuard` por tier y `RouteTierGate` automático. Mapa completo:

| ID | Feature | Tier | URL | Endpoint |
|----|---------|------|-----|----------|
| IT-10 | Storage Efficiency (Hot/Cool/Archive savings) | Business | `/intelligence/storage-efficiency` | `/api/intelligence/storage-efficiency` |
| IT-11 | Compute Cost per Core | Professional | `/intelligence/compute-efficiency` | `/api/intelligence/compute-cost-per-core` |
| IT-14 | Alertas self-service (presupuesto/anomalía) | Professional | `/intelligence/alerts` | `/api/budgets/alerts` |
| IT-15 | Networking Zombies (LBs/NSGs/PIPs huérfanos) | Professional | `/cleanup/zombies/networking` | `/api/cleanup/zombies/networking` |
| IT-01 | AI Analytics (consumo OpenAI / tokens / $/1k) | Enterprise | `/intelligence/ai-analytics` | `/api/intelligence/ai-analytics` |
| IT-04 | MACC Tracker (consumo de compromiso) | Enterprise | `/intelligence/macc` | `/api/intelligence/macc` |
| IT-02 | Invoicing Report (export PBI/CSV) | Enterprise | `/admin/report` | `/api/admin/report/invoicing` |
| IT-07 | Rightsizing VMSS | Professional | `/intelligence/rightsizing/vmss` | `/api/rightsizing/vmss` |
| IT-03a | Rightsizing App Service | Professional | `/intelligence/rightsizing/appservice` | `/api/rightsizing/appservice` |
| IT-03b | Rightsizing SQL DB | Professional | `/intelligence/rightsizing/sqldb` | `/api/rightsizing/sqldb` |
| IT-03c | Rightsizing Storage tier | Professional | `/intelligence/rightsizing/storage` | `/api/rightsizing/storage` |
| IT-12 | VM HA Recommendations (Zone/Set) | Business | `/governance/ha` | `/api/governance/ha` |
| IT-16 | Credenciales AAD por expirar | Business | `/governance/credentials` | `/api/governance/expiring-credentials` |
| IT-18 | Azure Lighthouse onboarding (ARM stub) | Enterprise | `/admin/onboarding/lighthouse` | `/api/onboard/lighthouse` |
| IT-17 | M365 Copilot integration & RAG | Enterprise | `/admin/copilot-m365` | `/api/copilot-m365/{config,ask}` |

**Cambios estructurales asociados:**
- `db.ts`: +11 tablas (`AICostSnapshots`, `MACCCommitments`, `AppServiceRecommendations`, `SqlDbRecommendations`, `StorageRecommendations`, `VmssRecommendations`, `HARecommendations`, `AlertRules`, `ExpiringCredentials`, `TenantDelegations`, `M365CopilotConfig`) + 3 columnas en `CostSnapshots` (`billing_profile_id`, `invoice_section_id`, `customer_id`) para soporte EA/MCA.
- `Sidebar.tsx`: 8 entries nuevos en Inteligencia / Gobernanza / Admin con iconos lucide dedicados.
- `routeTiers.ts`: 9 rutas registradas, todas auto-protegidas por `RouteTierGate`.
- `messages/{es,en,pt-BR}.json`: 10 namespaces nuevos (`StorageEfficiency`, `ComputeEfficiency`, `AlertsSelfService`, `AIAnalytics`, `MACC`, `HA`, `Credentials`, `CopilotM365`, `Lighthouse`, `Mock`) + features por tier extendidos en `pricing.{essential,pro,business,enterprise}`.
- Patrón **mock-first**: cada endpoint detecta `isMockTenant()` y devuelve datos sintéticos; los componentes muestran banner ámbar (`Mock` namespace) cuando `data.mock === true`.

- **App móvil (PWA, Fase 1)**: la plataforma es instalable desde el navegador del teléfono ("Agregar a pantalla de inicio") y abre a pantalla completa (`src/app/manifest.ts` + metas de iOS; sin service worker a propósito para no servir versiones cacheadas tras cada deploy). En móvil (<768px) la home redirige a la experiencia móvil: pantallas mobile-first **Resumen** (`/mobile` — costo del mes, proyección, ahorro, zombies), **Alertas** (`/mobile/alerts`), **Aprobaciones** (`/mobile/approvals` — aprobar/rechazar remediaciones con un toque) y **Perfil** (`/mobile/profile` — incluye toggle a versión de escritorio), navegadas con una barra de pestañas inferior estilo app (Resumen · Alertas · Aprobar · Soporte · Perfil). Reutiliza el 100% de las APIs existentes; el resto de las páginas sigue accesible vía el menú hamburguesa.
- **Alertas de Vencimiento de Credenciales (Tier Business)**: Desde Gobernanza → Credenciales por Expirar (o Alertas Self-Service, tipo `credential_expiry`) el usuario crea reglas que notifican cuando alguna credencial de App Registration vence dentro de N días (incluye vencidas). Evaluación diaria vía `/api/cron/credential-expiry-alerts` (Bearer CRON_SECRET) reusando el `credentialExpiryService` (Graph read-only) y los canales existentes: email (ACS) o webhook Slack/Teams (SSRF-safe). Anti-spam: máx. 1 notificación por regla por día (`last_triggered_at`).
- **Responsive móvil**: bloque global ≤640px en `globals.css` (grids del design system a 1-2 columnas, fuentes mínimas legibles, `font-size:16px` en inputs para evitar el auto-zoom de iOS, overflow-x confinado a contenedores internos) + header compactado.
- **Adjuntos y Notificaciones de Soporte**: Los tickets aceptan adjuntos `jpg/jpeg/png` (validados por magic bytes) y `txt/json` (UTF-8) de hasta 5 MB (máx. 10 por ticket), almacenados localmente como `<uuid>.<ext>` en el volumen `support_uploads` (`SUPPORT_UPLOAD_DIR`) y eliminados a los **60 días** (cron `/api/cron/support-attachments-cleanup` + limpieza oportunista). Descarga con anti-IDOR por tenant y `Content-Disposition: attachment` + `nosniff`. Acceso rápido a Soporte desde el header (y "Soporte Global" 🎧 solo para superadmins de CSCloudSolutions); un poller (60 s) inyecta notificaciones en la campanita + toast cuando llega una respuesta de soporte (usuarios) o un mensaje nuevo de cliente (equipo, `scope=global`).
- **Sistema de Soporte Interno (Tier Essential)**: Panel de tickets in-app (`/support`) donde cualquier usuario del tenant abre solicitudes al equipo de CSCloudSolutions y sigue el hilo de conversación dentro de la plataforma. Cuota mensual y SLA de primera respuesta por tier (Essential 5/mes·48h, Professional 20/mes·24h, Business ∞·8h, Enterprise ∞·4h — `src/lib/supportConfig.ts`). El equipo atiende la cola global multi-tenant desde `/superadmin/support` (RBAC `requireSuperAdmin`), respondiendo como rol `support` y gestionando estado/prioridad. API: `/api/support/tickets` (+`/[id]`) con `requireTenantAccess` anti-IDOR (ticket siempre filtrado por `tenant_id`), rate limit distribuido (10 creaciones/h, 30 respuestas/h por usuario) y validación de inputs; tablas `SupportTickets`/`SupportTicketMessages` (migración `20260706-001`).
- **Predictive Anomaly Engine (Tier Professional)**: Sistema inteligente impulsado por Machine Learning básico (Z-Score & SMA de 60 días) que detecta picos de costos anormales. Alerta de forma asíncrona mediante un webhook a Slack/Teams con deep-links para una investigación inmediata de causa raíz.
- **Action Center & Quick Fixes (Tier Professional)**: Capacidad de auto-remediación con un solo clic desde Azure Advisor. Permite eliminar recursos huérfanos (como Discos no adjuntos o IPs públicas) directamente desde el dashboard sin navegar al portal de Azure.
- **Apagado Programado de VMs Real (Power Schedules)**: `PowerSchedules.tsx` (botón "Establecer") era un stub de UI: mostraba un `alert()` simulando éxito pero no persistía ni ejecutaba nada. Se agregó la tabla `PowerSchedules` (MySQL), el API `/api/power/schedule` (GET/POST/DELETE, RBAC Owner/Admin/Operator) y el cron `/api/cron/power-schedules` (cada 10 min) que apaga realmente las VMs cuyo horario local se cumplió, respetando Smart Shutdown (umbral de CPU) cuando está habilitado. La UI ahora lista los horarios configurados con su última ejecución y permite eliminarlos.
- **Smart Shutdown (Tier Professional)**: Integración con Azure Monitor para evaluar el uso de CPU y Memoria (Performance-Aware) antes de apagar máquinas virtuales mediante Power Schedules, evadiendo el apagado si la VM sigue en uso activo.
- **FOCUS 1.0 Schema Compliance**: Homologación del esquema de base de datos (`CostSnapshots`) para soportar los estándares universales de la Fundación FinOps, permitiendo la portabilidad de los datos facturados.
- **Power BI / Fabric Export (Tier Enterprise)**: Conector seguro (`/api/intelligence/export/powerbi`) para ingerir datos financieros crudos en formato FOCUS directamente desde Microsoft Fabric, Power BI, o herramientas de BI empresariales externas.
- **FinOps Academy (Tier Essential)**: Módulo de *Customer Success* que empodera a los nuevos usuarios. Funciona como un LMS interno que imparte alfabetización en la nube (Conceptos de Egress, AHB, Burn Rate) y guía sutilmente a los locatarios a ejecutar sus scripts de Onboarding seguros tras completar su primera certificación.
- **Azure Hybrid Benefit Scanner (Tier Professional)**: Nuevo motor que escanea VMs y bases de datos SQL para detectar instancias con precio de lista (PAYG) y simula el ahorro mensual al reutilizar licencias on-premise mediante el licenciamiento híbrido.
- **Shared Cost Allocation Engine (Tier Enterprise)**: Herramienta interactiva para definir reglas de distribución porcentual en recursos compartidos (ej: ExpressRoute, Clústeres AKS). Asegura una suma matemática estricta del 100% para realizar Showback corporativo real.
- **FinOps Policies as Code (Tier Enterprise)**: Panel de gobernanza preventiva que permite a los SuperAdmins activar/desactivar políticas restrictivas (requerir tags, bloquear SKUs de máquinas costosas) inyectando directivas ARM directamente vía *Azure Policy* bajo un esquema *Shift-Left*.
- **Partner Markup / CSP Billing (Tier Enterprise)**: Configuración B2B2B global para Proveedores de Servicios (MSPs) que permite inflar matemáticamente de forma transparente (Markup %) el costo real de Azure en todos los reportes y dashboards orientados al cliente final.
- **Self-Service Plan Change con Preview de Prorrateo (Paddle)**: El rol `Owner` puede cambiar de plan (Essential/Professional/Business, mensual/anual) desde `/admin/billing`. Antes de aplicar, `POST /api/billing/subscription/preview` invoca `PATCH /subscriptions/{id}/preview` de Paddle Billing y devuelve el prorrateo exacto (`update_summary.result` → cargo por upgrade / crédito por downgrade, total recurrente y próxima facturación). El cambio se confirma con `PATCH /api/billing/subscription`; la persistencia del `tier` la resuelve el webhook `subscription.updated`.
- **Defense in Depth God Mode**: Se implementó una lógica estricta de doble factor para SuperAdmins, requiriendo dominio corporativo (`@cscloudsolutions.com.ar`) y el rol explícito `SUPERADMIN` en Base de Datos. Incluye una interfaz UI dedicada en `/superadmin/users` para promover Staff.
- **Mandatory Onboarding Flow**: Redirección forzada implementada en `TenantProvider` para asegurar que todo nuevo locatário ejecute obligatoriamente el script de RBAC, validándose de forma automática en la consulta de `/api/subscriptions`.
- **Enterprise Provisioning via SuperAdmin**: Nuevo módulo para provisionar Tenants B2B Enterprise manualmente mediante la UI de God Mode sin intervención de base de datos directa.
- **Módulo de License Optimization**: Se implementó una solución nativa mediante Microsoft Graph API para extraer suscripciones (`subscribedSkus`) e inactividad (`getOffice365ActiveUserDetail`). Incluye gestión avanzada de errores, mapeo de permisos de forma automática en el Onboarding, y recomendaciones visuales de revocación de licencias para usuarios inactivos.
- **Ingesta FOCUS (CSV Upload)**: Creación de interfaz dedicada e endpoint `/api/intelligence/upload` para ingestar y homologar CSVs crudos de nubes externas o cargos directos hacia la especificación FOCUS.
- **Estado Global de Suscripciones Basado en URL**: Migración del `SubscriptionContext` para usar variables de ruta y búsqueda profunda (deep-linking), garantizando consistencia universal de los selectores de suscripción en todos los componentes y reduciendo dependencias redundantes.
- **Backoff Exponencial en AI**: Incorporación de lógica de reintentos inteligente con backoff exponencial para evitar interrupciones en la plataforma al superar los "Rate Limits" de la API de Google Gemini (429 errors).
- **Tenant Teardown Seguro**: Adición de API y componente UI en la sección Admin (`/api/admin/tenants/delete`) que permite borrar completamente y con seguridad a Tenants, desvinculándolos de bases de datos y purgas locales.
- **Modularización del Proyecto**: Movilización estratégica del código hacia un nuevo directorio `src/modules/` para agrupar dominios de negocio específicos (`core`, `collectors`, `storage`) mejorando la mantenibilidad futura frente a los `services/` genéricos.
- **Power Schedules**: Se incorporó el comando `restartVirtualMachine` en el API de `/api/power`. Ahora la interfaz refleja fielmente si una ejecución a Azure falla por permisos, devolviendo códigos `403` a la UI.
- **Onboarding Automator**: Se ajustó el mecanismo de inserción en Base de Datos de Nuevos Tenants (UPSERT). Ahora utiliza `INSERT IGNORE` para proteger renombramientos manuales de los usuarios (company_name no se reinicia en cada inicio de sesión). Además, el script PowerShell inyecta vía `Invoke-AzRestMethod` los roles para lectura de Microsoft Graph automáticamente.
- **Soporte multi-suscripción para Budget Burn Chart**: Se adaptó el gráfico de presupuesto para soportar la suma y visualización concurrente de múltiples presupuestos cuando el Tenant tiene varias suscripciones o se selecciona la opción "Global".
- **Refactor de Cálculos en Consumo y Facturación**: Se ajustó la fórmula de "Proyección Anual" para basarse en los días transcurridos del mes en curso, proporcionando un estimado realista en USD en lugar de un promedio engañoso basado en la longitud del arreglo.
- **Sincronización de Contexto de Tenant**: Se implementó una corrección en `TenantProvider` para asegurar que el nombre local del Tenant en el contexto global de Next.js se mantenga sincronizado automáticamente si ocurre una actualización del nombre a nivel de base de datos desde el panel de Configuración.
- **Internacionalización Completa (i18n)**: Se extendieron y estandarizaron las traducciones en todas las pantallas principales (Dashboard, Billing, Network, Rates, Rightsizing) mediante `next-intl`, soportando de forma robusta los idiomas Inglés, Español y Portugués.
- **Control Real de VMs (Power Schedules / Control)**: Se refactorizó la lógica en `remediationService.ts` utilizando las promesas LRO nativas (`beginDeallocateAndWait`, `beginStartAndWait`) para asegurar que la solicitud llegue a la API de Microsoft Compute y la acción física se inicie verdaderamente.
- **Modo Demo y Generación de Datos Mocks**: Se implementó una interceptación completa de la API `fetch` en el `TenantProvider` para inquilinos de demostración (como el Tenant Master de Enterprise). Dependiendo del tier, inyecta datos locales de `mockData.ts` con multiplicadores configurables para visualizar métricas (como ahorros, recursos zombis, y puntajes de gobernanza) sin requerir llamadas reales a Azure, ideal para demostraciones comerciales offline.
- **Control Visual de Tiers (FeatureGuard)**: El componente `FeatureGuard` se ajustó para bloquear y desenfocar interactivamente los widgets/menús a los que el Tenant no tenga acceso según su nivel de suscripción (Essential, Professional, Business, Enterprise), devolviendo un diseño nítido y manipulable en la grilla para tiers superiores y un elegante cristal esmerilado con candados para tiers no autorizados.
- **FinOps Copilot Sensible al Contexto**: El Chatbot AI Global ahora se muestra sólo tras haber iniciado sesión. Además, lee la ruta actual de navegación del usuario para proporcionar una bienvenida y respuestas altamente contextualizadas sobre la página en la que se encuentra (ej. "Veo que estás revisando el Budget Burn, ¿quieres ayuda configurando las alertas?").
- **Dashboard Data Fixes**: Se homologaron estructuras de datos ficticias faltantes (como `budgets_burn`, `tags` y `anomalies`) y se resolvieron inconsistencias que provocaban que componentes de `react-grid-layout` colapsaran al no mantener sus clases `h-full` `w-full` en los tiers sin bloqueos.
- **Creación Temprana de Tenants (SuperAdmin)**: Añadimos la capacidad a la API `/api/admin/tenants` para que los administradores globales (SuperAdmins) puedan provisionar tenants de forma manual, bypasseando los flujos de pago directos e insertando tiers personalizados a nivel de base de datos.
- **Azure PowerShell v16 Support**: El script de onboarding fue refactorizado para adaptarse a los inminentes cambios rompedores de `Get-AzRoleDefinition`, verificando la existencia y el contador de `.Permissions` antes de iterar, soportando la versión v16 sin lanzar excepciones silenciadas.
- **UI Consistency**: Alineación visual y márgenes ajustados bajo un formato estandarizado para los paneles interactivos del Dashboard, aplicando clases (`card-h`).
- **Traefik Networking & Certs Fix**: Se corrigió el archivo `docker-compose.yml` para conectarse explícitamente a una red de Traefik preexistente en producción (`finops.cscloudsolutions.com.ar`) y se eliminó el servicio de Redis integrado localmente para reutilizar la instancia de Redis global del VPS, previniendo errores 404 por duplicación de contenedores en la capa de balanceo de carga.
- **Entra ID UPN Identity Claim Support**: Se aplicó una refactorización global en los más de 30 endpoints de la API (`src/app/api`) para soportar la lectura de correos electrónicos bajo la directiva `decoded.upn` (User Principal Name) provenientes de tokens de Microsoft Entra ID. Esto previene que usuarios legítimos pierdan su estatus de SuperAdmin si su token oculta su email nativo.
- **Advisor por Idioma Activo del Usuario**: El módulo de Azure Advisor ahora consume recomendaciones en el idioma seleccionado en la UI (ES/EN/PT-BR), propagando locale explícito al backend y normalizándolo para Azure APIs.

---

## 🌐 Internacionalización (i18n)

Soportado por `next-intl`. Todo el contenido visible se gestiona dinámicamente mediante diccionarios en la carpeta `/messages`:
- `es.json` (Default)
- `en.json` (English)
- `pt-BR.json` (Português do Brasil)

Cualquier cambio de estructura de UI o adición de páginas debe registrarse en los diccionarios respectivos antes del despliegue.

---

## ⏰ Cron Jobs

Endpoints internos protegidos por `Authorization: Bearer ${CRON_SECRET}`. Se invocan desde el crontab del VPS (o cualquier scheduler externo). Todos son idempotentes.

| Endpoint                              | Frecuencia recomendada | Propósito                                                                                       |
| ------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /api/cron/sync`                  | Diaria 06:00 UTC       | Snapshot diario de costos por tenant (CostManagement / CUR).                                    |
| `GET /api/cron/historical-gap-backfill` | Diaria 03:00 UTC     | Re-consulta los últimos 2 meses de `getHistoricalDetailedCosts`/`getHistoricalDailyCosts` para todos los tenants activos y upsertea (`ON DUPLICATE KEY UPDATE`, nunca `DELETE`) — cierra huecos que el backfill liviano de `/api/cron/sync` (ventana de 7 días) no alcanza a ver, típicamente una suscripción que pierde el sync diario por 429 sostenido durante semanas (ver incidente RPA365 2026-07 abajo). También se dispara on-demand (fire-and-forget, debounced 6h por Redis) al abrir el Invoicing Report si el tenant tiene datos stale — `src/lib/historicalGapBackfill.ts`. |
| `GET /api/cron/prewarm-dashboard`     | Cada 10 min            | Pre-calienta el cache SWR del Dashboard General (`/api/dashboard/summary`) por tenant activo.  |
| `GET /api/cron/power-schedules`      | Cada 2 min              | Ejecuta los horarios de apagado programado de VMs (tabla `PowerSchedules`) cuyo horario local ya se cumplió (ventana de 8 min). También se dispara al instante desde `/api/power/schedule` (POST) al crear/editar un horario, sin esperar al próximo tick, para minimizar la latencia percibida. |
| `GET /api/cron/open-data`            | Semanal (lunes 04:00)  | Sincroniza los Open Data Sets del Microsoft FinOps Toolkit (Regions/Services/ResourceTypes/PricingUnits/CommitmentEligibility) a las tablas `OpenData*`. Sin él, los lookups (nombre canónico de región, categoría de servicio, iconos) devuelven null. |
| `GET /api/cron/anomaly-detection`    | Cada 5 min (mínimo)     | Corre Z-Score sobre `CostSnapshots` para todos los tenants Professional+, persiste en `Anomalies` y notifica (Slack/Teams/email + alerta de navegador) — antes la detección era 100% on-demand (solo calculaba si alguien abría `/intelligence/anomalies`), sin ningún monitoreo proactivo. |
| `GET /api/cron/cost-sync-staleness-check` | Diaria 08:00 UTC   | Verifica que `/api/cron/sync` haya escrito datos nuevos en `CostSnapshots` en las últimas 36h para cada tenant real con Azure conectado — Cost Groups y el resto de features basadas en `CostSnapshots` requieren refresco diario. Si el sync no corrió (0 tenants frescos) crea una alerta `critical` en `SystemAlerts` + email a soporte; si es parcial, `warning` sin email. Existe justamente para detectar automáticamente el escenario del incidente del 2026-07-05 (ver nota abajo) la próxima vez que pase, en vez de depender de que alguien lo note manualmente. |
| `GET /api/cron/ttl-expiry-alerts`     | Diaria (o más seguido)  | Evalúa reglas `AlertRules` tipo `ttl_expiry` (Alertas Self-Service) contra los entornos con tag `ExpireOn`/`TTL` de cada tenant y notifica los que vencen dentro de N días (o ya vencidos) — paso 3 del flujo TTL Enforcement ("El sistema te alerta antes de la eliminación automática"), antes inexistente. Mismo patrón anti-spam que `credential-expiry-alerts` (`last_triggered_at`). |
| `GET /api/cron/focus-export-daily`   | Diaria                  | Genera el export FOCUS 1.1 (CSV/JSON) del día anterior para cada tenant con `FocusExportSchedules.enabled = TRUE` (Administración → FOCUS 1.1 Export → "Programación diaria automática") y lo manda como adjunto por email — antes el export solo era manual, por rango de fechas. |
| `GET /api/cron/credential-expiry-alerts` | Diaria             | Evalúa reglas `AlertRules` tipo `credential_expiry`: consulta Microsoft Graph por tenant y notifica (email/Slack/Teams/webhook) las App Registrations que vencen dentro del umbral configurado o ya vencieron. Anti-spam por `last_triggered_at`. |
| `GET /api/cron/subscription-expiry`  | Diaria                  | Pasa a `EXPIRED` los tenants `CANCELED` cuyo período ya pagado (`access_until`, seteado por el webhook de Paddle) venció — corta el acceso sin cortarlo antes de tiempo. |
| `GET /api/cron/trial-expiry`         | Diaria                  | Pasa a `EXPIRED` los tenants en `TRIAL` cuyo `trial_ends_at` ya venció y notifica por email. |
| `GET /api/cron/support-attachments-cleanup` | Diaria           | Borra archivo + fila de los adjuntos de soporte con más de `SUPPORT_ATTACHMENT_RETENTION_DAYS` (60) días. |
| `GET /api/cron/status-snapshot`      | Cada 5 min              | Chequea DB/Azure Sync/AI Provider/Paddle y persiste una fila en `PlatformStatusSnapshots`, de donde `/api/status` calcula `uptime_30d_pct` — sin él la página pública de estado no tiene datos de uptime. Auth vía `?secret=` (query param), no header `Authorization`, a diferencia del resto de los crons de esta tabla — mismo `CRON_SECRET`. |

**Ejemplo crontab VPS:**
```cron
# Snapshot diario de costos
0 6 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/sync >> /var/log/finops-cron.log 2>&1

# Pre-warm dashboard cada 10 min (cache hard-TTL = 15 min)
*/10 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/prewarm-dashboard >> /var/log/finops-cron.log 2>&1

# Power Schedules (apagado programado de VMs) cada 2 min (ventana de ejecución = 8 min).
# Además, /api/power/schedule dispara un chequeo inmediato al guardar un horario.
*/2 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/power-schedules >> /var/log/finops-cron.log 2>&1

# Backup diario de MySQL (script local del VPS, no endpoint HTTP) — ver docs/runbook-restore-mysql.md
# 02:00 en vez de 03:00 (valor original del comentario del script) para no chocar
# con historical-gap-backfill, agregado después en ese mismo horario.
0 2 * * * /home/manny/cscloud/finops/scripts/backup-db.sh >> /var/log/finops-backup.log 2>&1

# Open Data del FinOps Toolkit (Regions/Services/ResourceTypes/PricingUnits/CommitmentEligibility) — semanal
0 4 * * 1 curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/open-data >> /var/log/finops-cron.log 2>&1

# Detección de anomalías de gasto (Z-Score) — cada 5 min, comparte cache Redis
# de 6h con el endpoint on-demand así que no multiplica llamadas a Azure
*/5 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/anomaly-detection >> /var/log/finops-cron.log 2>&1

# Chequeo de frescura de CostSnapshots (Cost Groups y afines) — diario, 2h
# después del sync para dar margen. Alerta si /api/cron/sync no corrió.
0 8 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/cost-sync-staleness-check >> /var/log/finops-cron.log 2>&1

# Alertas de expiración TTL (entornos efímeros por vencer/vencidos) — diario
0 9 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/ttl-expiry-alerts >> /var/log/finops-cron.log 2>&1

# Alertas de expiración de credenciales (App Registrations por vencer) — diario
0 7 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/credential-expiry-alerts >> /var/log/finops-cron.log 2>&1

# Corta acceso a tenants CANCELED cuyo período pagado ya venció — diario
30 6 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/subscription-expiry >> /var/log/finops-cron.log 2>&1

# Vence trials cuyo trial_ends_at ya pasó — diario
0 1 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/trial-expiry >> /var/log/finops-cron.log 2>&1

# Retención de adjuntos de soporte (60 días) — diario, 05:00
0 5 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/support-attachments-cleanup >> /var/log/finops-cron.log 2>&1

# Snapshot de estado de plataforma (alimenta /api/status y /status) — cada 5 min.
# Nota: este endpoint autentica por query param ?secret=, no por header Authorization.
*/5 * * * * curl -fsS "https://finops.cscloudsolutions.com.ar/api/cron/status-snapshot?secret=$CRON_SECRET" >> /var/log/finops-cron.log 2>&1

# Export FOCUS 1.1 diario por email (tenants con programación habilitada)
0 7 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/focus-export-daily >> /var/log/finops-cron.log 2>&1

# Backfill de huecos históricos (upsert-only) — todos los tenants activos, 03:00 UTC,
# horario elegido por ser el único slot diario libre entre 00-09h en el crontab real
# (no compite con support-attachments-cleanup 05h, sync 06h, credential-expiry-alerts
# 07h, ni ttl-expiry-alerts 09h).
0 3 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/historical-gap-backfill >> /var/log/finops-cron.log 2>&1
```

**Backups de MySQL** (`scripts/backup-db.sh`, Fase 1 del [plan de infra](docs/vps-infra-improvement-plan.md)): dump diario comprimido con retención local 7 diarios + 4 semanales, y copia off-site a Azure Blob Storage vía SAS solo-escritura (`BACKUP_AZURE_SAS_URL` en el `.env` del VPS). Runbook completo de provisioning y restore en `docs/runbook-restore-mysql.md`.

**Auth interna**: `prewarm-dashboard` propaga `X-Cron-Auth` a las llamadas internas (`summary` → `audit/full` / `intelligence/forecast`) gracias al bypass en `requireTenantAccess`. Comparación timing-safe; nunca concede superadmin global, solo acceso al `tenantId` de la query.

> ⚠️ **Verificación periódica obligatoria**: esta tabla documenta el crontab *esperado*, pero puede desincronizarse del real (ej. tras migrar de VPS, reprovisionar el servidor, o editar el crontab a mano). El 2026-07-05 se detectó que `/api/cron/sync` — el que puebla `CostSnapshots`/`CostMeterSnapshots`/`CostCategorySnapshots` — **no estaba en el crontab real**, dejando Cost by Category, Storage Efficiency y Compute Efficiency sin datos indefinidamente sin ningún error visible. El 2026-07-18 se detectó el mismo patrón con `backup-db.sh` (documentado desde el 2026-07-04, nunca instalado). Verificar con `ssh finops-vps 'crontab -l'` contra esta tabla cada vez que se audite el VPS (ver directiva #14, auditorías de seguridad ~quincenales).
>
> **⚠️ El crontab del VPS NO viaja con el deploy ni vive en este repo — es estado manual del servidor.** Un `docker compose up -d --build` (el deploy normal) nunca lo toca, pero si el VPS se reprovisiona, se migra a otro servidor, o alguien corre `crontab -r`/edita a mano sin mirar esta tabla, las entradas se pierden en silencio sin ningún error visible hasta que alguien nota datos faltantes días/semanas después (exactamente los 2 incidentes de arriba). **Checklist de migración/reprovisioning de VPS**: reinstalar TODAS las líneas de la sección "Ejemplo crontab VPS" de arriba tal cual están, no de memoria.
>
> **Auditoría 2026-07-27 (retiro de AWS)**: se eliminó `provider-archive-purge` (código y fila de esta tabla) — solo existía para el ciclo de vida de tenants multi-cloud `provider = 'both'`, que dejó de ser posible al retirar el soporte AWS. Si esa línea sigue en el crontab real del VPS, ahora solo pega contra una ruta inexistente (404) — quitarla en la próxima edición manual del crontab. La misma auditoría encontró que `credential-expiry-alerts`, `subscription-expiry`, `trial-expiry`, `support-attachments-cleanup` y `status-snapshot` existen en el código, tenían mención suelta o ninguna en esta sección, y no tenían fila propia en la tabla ni línea de ejemplo en el crontab — se agregaron ambas cosas arriba con frecuencias inferidas del propio código, pero **no verificadas contra el crontab real** (no hay acceso SSH desde este entorno): confirmar con `ssh finops-vps 'crontab -l'` cuáles de las 5 corren de verdad antes de asumir que sí.
>
> **Confirmado instalado en el crontab real al 2026-07-18** (verificado con `crontab -l` en esa fecha, no solo documentado): `prewarm-dashboard` (*/10), `power-schedules` (*/2), `open-data` (lunes 04h), `sync` (06h), `support-attachments-cleanup` (05h), `credential-expiry-alerts` (07h), `cleanup-docker.sh` (domingo 04h), `ttl-expiry-alerts` (09h), **`historical-gap-backfill` (03h, agregado 2026-07-18)**, **`backup-db.sh` (02h, agregado 2026-07-18, era solo documentación desde el 07-04)**. `anomaly-detection`, `cost-sync-staleness-check` y `focus-export-daily` están documentados en la tabla de arriba pero **NO confirmados en el crontab real al 07-18** — verificar antes de asumir que corren.

---

## 📜 Development Protocol

**CRITICAL RULE: From this point forward, every time a new feature is added, an API route is modified, or a component is created, this README.md file MUST be updated to reflect the change. The Project Structure tree and the Mermaid Infrastructure diagram must be regenerated if the architecture changes.**

### The Core Loop
1. **Directivas (`/directivas/`)**: Antes de cualquier cambio, se consulta y se expande el archivo SOP (Standard Operating Procedure) correspondiente a la tarea.
2. **Ejecución**: El código debe ser generado y validado contra las reglas establecidas de Arquitectura y TypeScript (`npm run dev`, `npx tsc --noEmit`).
3. **Registro de Fallos**: Si un llamado a la API de Azure falla, la restricción debe plasmarse en el SOP para que el "Observer" de la plataforma mantenga una memoria viva del error.
4. **Documentación Automática**: Actualizar SIEMPRE el `README.md` (este documento) como fuente central y unificada de la verdad del ecosistema.
5. **Registro de Cambios Obligatorio**: Toda modificación aplicada (y las futuras) debe registrarse en `CAMBIOS_IMPLEMENTADOS.md` con fecha, alcance y archivos afectados.

---

## 🧾 Registro de cambios operativo

Desde ahora, el historial técnico incremental del proyecto se mantiene en:

- `CAMBIOS_IMPLEMENTADOS.md`

Regla activa: ante cualquier cambio de código, también se debe actualizar:

1. `README.md`
2. `MANUAL_DE_USUARIO.md`
3. `CAMBIOS_IMPLEMENTADOS.md`
