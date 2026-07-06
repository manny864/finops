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

1. **User Identity**: El acceso de usuarios es manejado vía MSAL (`@azure/msal-react`). Los tokens JWT emitidos validan la identidad de la sesión en todos los llamados a la API en `src/app/api`.
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

## 📈 Recent Major Updates

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
| `GET /api/cron/prewarm-dashboard`     | Cada 10 min            | Pre-calienta el cache SWR del Dashboard General (`/api/dashboard/summary`) por tenant activo.  |
| `GET /api/cron/power-schedules`      | Cada 10 min            | Ejecuta los horarios de apagado programado de VMs (tabla `PowerSchedules`) cuyo horario local ya se cumplió. |
| `GET /api/cron/open-data`            | Semanal (lunes 04:00)  | Sincroniza los Open Data Sets del Microsoft FinOps Toolkit (Regions/Services/ResourceTypes/PricingUnits/CommitmentEligibility) a las tablas `OpenData*`. Sin él, los lookups (nombre canónico de región, categoría de servicio, iconos) devuelven null. |

**Ejemplo crontab VPS:**
```cron
# Snapshot diario de costos
0 6 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/sync >> /var/log/finops-cron.log 2>&1

# Pre-warm dashboard cada 10 min (cache hard-TTL = 15 min)
*/10 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/prewarm-dashboard >> /var/log/finops-cron.log 2>&1

# Power Schedules (apagado programado de VMs) cada 10 min (ventana de ejecución = 15 min)
*/10 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/power-schedules >> /var/log/finops-cron.log 2>&1

# Backup diario de MySQL (script local del VPS, no endpoint HTTP) — ver docs/runbook-restore-mysql.md
0 3 * * * /home/manny/cscloud/finops/scripts/backup-db.sh >> /var/log/finops-backup.log 2>&1

# Open Data del FinOps Toolkit (Regions/Services/ResourceTypes/PricingUnits/CommitmentEligibility) — semanal
0 4 * * 1 curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/open-data >> /var/log/finops-cron.log 2>&1
```

**Backups de MySQL** (`scripts/backup-db.sh`, Fase 1 del [plan de infra](docs/vps-infra-improvement-plan.md)): dump diario comprimido con retención local 7 diarios + 4 semanales, y copia off-site a Azure Blob Storage vía SAS solo-escritura (`BACKUP_AZURE_SAS_URL` en el `.env` del VPS). Runbook completo de provisioning y restore en `docs/runbook-restore-mysql.md`.

**Auth interna**: `prewarm-dashboard` propaga `X-Cron-Auth` a las llamadas internas (`summary` → `audit/full` / `intelligence/forecast`) gracias al bypass en `requireTenantAccess`. Comparación timing-safe; nunca concede superadmin global, solo acceso al `tenantId` de la query.

> ⚠️ **Verificación periódica obligatoria**: esta tabla documenta el crontab *esperado*, pero puede desincronizarse del real (ej. tras migrar de VPS, reprovisionar el servidor, o editar el crontab a mano). El 2026-07-05 se detectó que `/api/cron/sync` — el que puebla `CostSnapshots`/`CostMeterSnapshots`/`CostCategorySnapshots` — **no estaba en el crontab real**, dejando Cost by Category, Storage Efficiency y Compute Efficiency sin datos indefinidamente sin ningún error visible. Verificar con `ssh finops-vps 'crontab -l'` contra esta tabla cada vez que se audite el VPS (ver directiva #14, auditorías de seguridad ~quincenales).

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
