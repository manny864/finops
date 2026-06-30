# QA Checklist — Todas las features activas del SaaS

> **Objetivo**: validar manualmente cada feature del SaaS antes de subir a staging/prod.
> **Setup base**: `npm run dev` en puerto 3000 · DB MySQL local arriba · sesión iniciada con usuario que tenga rol **OWNER**/**ADMIN** + tenant con tier suficiente.
> **Tier**: plan mínimo necesario para la ruta (Essential/Professional/Business/Enterprise).
> **Convención**: `[ ]` por validar · `[x]` validado · marcar `N/A` si no aplica al tier del tester.

---

## Índice

1. [Setup y auth](#1-setup-y-auth)
2. [Onboarding y configuración inicial](#2-onboarding-y-configuración-inicial)
3. [Overview / Dashboard principal](#3-overview--dashboard-principal)
4. [Intelligence — análisis de costos](#4-intelligence--análisis-de-costos)
5. [Intelligence — rightsizing & eficiencia](#5-intelligence--rightsizing--eficiencia)
6. [Intelligence — descuentos & commitments](#6-intelligence--descuentos--commitments)
7. [Intelligence — IA, scorecard, simulator](#7-intelligence--ia-scorecard-simulator)
8. [Cleanup — zombies y TTL](#8-cleanup--zombies-y-ttl)
9. [Governance — tags, policies, HA, power, credenciales](#9-governance--tags-policies-ha-power-credenciales)
10. [Remediation — approvals workflow](#10-remediation--approvals-workflow)
11. [Advisor & Academy](#11-advisor--academy)
12. [Admin — configuración del tenant](#12-admin--configuración-del-tenant)
13. [Admin — billing (Paddle)](#13-admin--billing-paddle)
14. [Admin — SSO SAML (WorkOS)](#14-admin--sso-saml-workos)
15. [Admin — notificaciones multi-canal](#15-admin--notificaciones-multi-canal)
16. [Admin — MCP server keys](#16-admin--mcp-server-keys)
17. [Admin — Power BI templates](#17-admin--power-bi-templates)
18. [Admin — pricing units](#18-admin--pricing-units)
19. [Admin — usuarios, tenants, copilot M365, workbooks](#19-admin--usuarios-tenants-copilot-m365-workbooks)
20. [SuperAdmin (corporate-only)](#20-superadmin-corporate-only)
21. [Demo mode y mock tenant](#21-demo-mode-y-mock-tenant)
22. [Multi-currency (FX)](#22-multi-currency-fx)
23. [i18n (multi-idioma)](#23-i18n-multi-idioma)
24. [Status page pública](#24-status-page-pública)
25. [Audit log export](#25-audit-log-export)
26. [API pública v1 + OpenAPI](#26-api-pública-v1--openapi)
27. [Legal + Compliance (DPA/SOC2/Trust Center)](#27-legal--compliance-dpasoc2trust-center)
28. [Tests + CI](#28-tests--ci)
29. [ML Forecasting (Linear, EMA, Holt-Winters)](#29-ml-forecasting-linear-ema-holt-winters)
30. [2FA/MFA (TOTP)](#30-2famfa-totp)
31. [Onboarding Wizard](#31-onboarding-wizard)
32. [Data Residency](#32-data-residency)
33. [Marketplace listings (Azure + AWS)](#33-marketplace-listings-azure--aws)
34. [Smoke checks finales](#34-smoke-checks-finales)

---

## 1. Setup y auth

### Pre-flight
- [ ] `npm install` corre sin errores.
- [ ] DB MySQL local arriba en puerto `3307` (o el configurado en `.env.development`).
- [ ] `npm run dev` arranca en `:3000`.
- [ ] `.env.development` tiene todas las vars críticas (DB_*, AZURE_*, PADDLE_*, GEMINI_API_KEY).

### Login MSAL (Azure AD)
- [ ] `/login` redirige a Microsoft login.
- [ ] Después de login, el callback redirige a `/{locale}/` (homepage).
- [ ] El selector de tenant aparece en topbar si el usuario tiene >1 tenant.
- [ ] Logout cierra sesión limpiamente (no quedan tokens stale).

### Token / Permisos
- [ ] Bearer JWT en `Authorization` se valida en endpoints protegidos.
- [ ] Rol `OWNER`/`ADMIN`/`MEMBER`/`VIEWER` se respeta en endpoints sensibles.
- [ ] Tenant equivocado en query string → 403 o redirección.

---

## 2. Onboarding y configuración inicial

### `/admin/onboarding` — wizard
- [ ] Página carga sin errores tras primer login.
- [ ] Step 1: crear SP (Service Principal Azure) → guía visible.
- [ ] Step 2: pegar `client_id` + `client_secret` + `azure_tenant_id`.
- [ ] Endpoint de diagnóstico (`/api/admin/diagnose-sp`) valida permisos en Azure.
- [ ] Status visual de cada permiso (Reader, Cost Management Reader, Resource Graph) en verde/rojo.
- [ ] Step 3: primera sync arranca → status pasa a `OK` en `Tenants.sync_status`.

### `/admin/onboarding/lighthouse` — multi-cliente (CSP)
- [ ] Si CSP/Lighthouse aplica: guía para delegated access carga.
- [ ] Permite agregar tenants delegados por subscription.

---

## 3. Overview / Dashboard principal

### `/` (homepage)
- [ ] Banner de mock data si tenant es `demoSession`.
- [ ] Widgets `react-grid-layout` arrastrables y redimensionables.
- [ ] Estado del layout persiste entre recargas (localStorage o DB).
- [ ] **Executive Summary Card** muestra: gasto MTD, forecast, % vs presupuesto, savings YTD.
- [ ] **CostPieChart** por servicio/RG carga sin errores.
- [ ] **ZombieResourcesTable** muestra recursos sin uso con costo estimado.
- [ ] **PowerSchedules** muestra schedules de start/stop.
- [ ] **BudgetBurnChart** dibuja línea de gasto vs límite.
- [ ] **RightsizingBlade** muestra recomendaciones.
- [ ] **ExpiredSandboxTable** lista RGs con TTL vencido.
- [ ] **HABreakdownCard** muestra zonas / disponibilidad.
- [ ] **AksChargebackCard** muestra AKS chargeback (tier Enterprise).
- [ ] **MyPinnedWidgets** muestra widgets pinneados por el usuario.
- [ ] Botón "Pin to dashboard" en cada subpágina funciona y aparece acá.

### `/overview/maturity`
- [ ] Cuestionario FinOps Foundation Maturity Model carga.
- [ ] Selecciones se guardan, score se calcula.
- [ ] Recomendaciones por dimensión aparecen.

### `/overview/progress`
- [ ] Time-series de KPIs (gasto, savings, anomalías, recursos no etiquetados).
- [ ] Filtro por rango de fecha funciona.

### `/overview/sustainability`
- [ ] KPIs CO₂ totales: kg, equivalentes (km auto, árboles/año, recargas teléfono).
- [ ] Breakdown por región/servicio.
- [ ] Lista de **green migrations** sugeridas (ej. `eastus → canadacentral` con % reducción).

---

## 4. Intelligence — análisis de costos

### `/intelligence/billing` — Cost Management
**Tier**: Professional
- [ ] Datos de cost management cargan sin 429 (rate-limit safe).
- [ ] Filtros: rango de fecha, granularidad (día/mes), agrupación.
- [ ] Export CSV funciona.

### `/intelligence/anomalies` — detección
**Tier**: Professional
- [ ] Lista anomalías detectadas con score, fecha, recurso afectado.
- [ ] Botón "Marcar como falso positivo" funciona.
- [ ] Si tenant tiene webhook configurado, dispara `sendWebhookAlert()` al detectar.
- [ ] Notificaciones multi-canal llegan a Slack/Teams/Email enabled.

### `/intelligence/budgets` — presupuestos
**Tier**: Professional
- [ ] CRUD de budgets por tenant/RG/servicio.
- [ ] Alertas configurables (50/80/100% del límite).
- [ ] Burn chart en tiempo real.

### `/intelligence/allocation` — chargeback/showback
**Tier**: Enterprise
- [ ] Allocation por business unit / cost center.
- [ ] Reglas configurables.

### `/intelligence/chargeback`
- [ ] Reporte de chargeback exportable PDF/CSV.
- [ ] Markup aplicado correctamente (de `/admin/markup`).

### `/intelligence/aks-chargeback`
**Tier**: Enterprise
- [ ] Chargeback por namespace / label de AKS.
- [ ] Pod-level cost split funciona.

---

## 5. Intelligence — rightsizing & eficiencia

### `/intelligence/rightsizing` — VMs
**Tier**: Professional
- [ ] Lista de VMs con CPU/RAM/Disk baja → SKU sugerido + savings $/mes.
- [ ] Click en recurso abre detalle con métricas históricas.
- [ ] Botón "Aplicar" inicia workflow de remediation (si está habilitado).

### Subpáginas rightsizing
- [ ] `/intelligence/rightsizing/appservice` — App Service SKU downsize.
- [ ] `/intelligence/rightsizing/sqldb` — SQL DB tier downsize.
- [ ] `/intelligence/rightsizing/storage` — Storage tier optimization.
- [ ] `/intelligence/rightsizing/vmss` — VMSS scale recommendations.

### `/intelligence/compute-efficiency`
**Tier**: Professional
- [ ] Score de eficiencia compute por tenant.
- [ ] Top 10 recursos ineficientes.

### `/intelligence/storage-efficiency`
**Tier**: Business
- [ ] Sugerencias: Hot→Cool, eliminar snapshots viejos, lifecycle policies.

### `/intelligence/network`
**Tier**: Professional
- [ ] Análisis de tráfico inter-region, NAT Gateway, Application Gateway.
- [ ] Sugerencias responsive (mobile-friendly).

### `/intelligence/zero-cost`
- [ ] Lista recursos con costo $0 que podrían eliminarse o consolidarse.

---

## 6. Intelligence — descuentos & commitments

### `/intelligence/rates` — recomendaciones de tarifa
**Tier**: Business
- [ ] "Analizar" dispara análisis sin error `Fallo al obtener recomendaciones de tarifas`.
- [ ] Devuelve recomendaciones: RI vs Savings Plan vs On-demand.
- [ ] Comparativo $ ahorro estimado.

### `/intelligence/commitments` — RI/Savings Plans
**Tier**: Professional
- [ ] Lista RIs/SPs activos con utilization %.
- [ ] Alerta si utilization < 80%.
- [ ] Recomendaciones de compra.

### `/intelligence/hybrid-benefit` — AHUB
**Tier**: Professional
- [ ] Lista VMs candidatas a AHUB (Windows/SQL).
- [ ] Dedup correcto (no aparece misma VM 2 veces).
- [ ] Estimado de savings.

### `/intelligence/licenses`
**Tier**: Professional
- [ ] Inventario de licencias M365 + Azure.
- [ ] Sub-utilización detectada.

### `/intelligence/macc` — Microsoft ACE Commitment
**Tier**: Enterprise
- [ ] Tracking de gasto vs commitment anual.
- [ ] Burn rate y proyección final.

---

## 7. Intelligence — IA, scorecard, simulator

### `/intelligence/ai-analytics`
**Tier**: Enterprise
- [ ] Consultas en lenguaje natural sobre cost data → respuesta con insight.
- [ ] Provider configurable (Gemini/OpenAI/Anthropic).

### `/intelligence/scorecard`
**Tier**: Enterprise
- [ ] FinOps maturity scorecard por área (cost, governance, optimization, automation).
- [ ] Export PDF.

### `/intelligence/simulator` — what-if
**Tier**: Enterprise
- [ ] Crear escenario: cambiar SKUs, regiones, commitments.
- [ ] Ver diff de costos proyectados.
- [ ] Guardar escenarios y compararlos side-by-side.

### `/intelligence/alerts`
**Tier**: Professional
- [ ] Configurar alertas custom (threshold, condition).
- [ ] Disparan notificaciones a canales enabled.

### `/intelligence/unit-economics`
**Tier**: Business
- [ ] $ por unidad de negocio (request, customer, GB transferido).

### `/intelligence/aks`
**Tier**: Business
- [ ] Vista cluster-level: cost, nodes, namespaces.

### `/intelligence/upload`
- [ ] Subir CSV/JSON de facturas legacy → parsea y normaliza.

---

## 8. Cleanup — zombies y TTL

### `/cleanup/zombies`
- [ ] Lista recursos sin uso (Public IPs, Disks unattached, NICs huérfanas).
- [ ] Selección múltiple + bulk delete.
- [ ] Confirm modal obliga a tipear nombre del recurso.

### `/cleanup/zombies/networking`
- [ ] Subset networking: NSG huérfanos, App Gateways sin backends, Load Balancers vacíos.

### `/cleanup/ttl`
**Tier**: Professional
- [ ] Configurar TTL por RG/tag.
- [ ] Notificación al owner antes de eliminar.
- [ ] Dry-run preview.

---

## 9. Governance — tags, policies, HA, power, credenciales

### `/governance/tags`
**Tier**: Business
- [ ] **TagManager** carga lista de recursos sin tags requeridos.
- [ ] **Tag Inheritance Preview**: muestra recursos que heredarían tags del RG/Subscription.
- [ ] **Apply Inheritance**: batch (max 200 ops/request) ejecuta y muestra success/failed.
- [ ] Sin Azure creds → mensaje claro, no crashea.

### `/governance/policies`
**Tier**: Enterprise
- [ ] Lista políticas Azure Policy activas.
- [ ] Compliance dashboard.

### `/governance/ha` — High Availability
**Tier**: Business
- [ ] Análisis de zonas de disponibilidad por recurso.
- [ ] Recursos single-zone marcados como riesgo.

### `/governance/power` — power schedules
**Tier**: Business
- [ ] CRUD de schedules (start/stop horarios).
- [ ] Asignación por tag o RG.

### `/governance/credentials`
**Tier**: Business
- [ ] Inventario de SPs / certificates / secrets próximos a expirar.

---

## 10. Remediation — approvals workflow

### `/remediation/approvals`
**Tier**: Professional
- [ ] Lista pending approvals de acciones automatizadas (delete, resize).
- [ ] Approve/Reject con comentario.
- [ ] Auditoría queda en log.

---

## 11. Advisor & Academy

### `/advisor`
- [ ] Azure Advisor recommendations integradas.
- [ ] Categorías: Cost, Performance, Security, Reliability, Operational.

### `/academy`
- [ ] Cursos / tutoriales FinOps cargan.
- [ ] Tracking de progreso por usuario.

---

## 12. Admin — configuración del tenant

### `/admin/config`
- [ ] Editar perfil del tenant: nombre, webhook URL legacy, AI provider, AI key.
- [ ] Cambios persisten en `Tenants` table.

### `/admin/ai-config`
- [ ] Selector provider: System/Gemini/OpenAI/Anthropic.
- [ ] BYOK: tenant pone su API key (encripted in DB).
- [ ] Test button valida la key.

### `/admin/markup`
**Tier**: Enterprise
- [ ] `markup_percentage` editable (0-100%).
- [ ] Aplica a reportes de chargeback/invoicing.

### `/admin/audit`
- [ ] Lista de eventos (login, mutación de billing, cambio de tier, etc.).
- [ ] Filtros: usuario, acción, fecha.
- [ ] Export CSV/JSON (para SOC2).

### `/admin/report`
- [ ] Reportes ejecutivos generables (PDF).
- [ ] Schedule de envío por email.

### `/admin/report/invoicing`
- [ ] Period selector (month picker, defaults to current month).
- [ ] Markup % display (read-only, edit link to /admin/markup).
- [ ] Summary cards: total original cost, total markup amount, total adjusted cost.
- [ ] Table of customers with columns: customer, original $, markup $, adjusted $, action buttons.
- [ ] **Download all (ZIP)**: Fetch `format=pdf` (no customerId), generates ZIP with one PDF per customer.
  - [ ] ZIP file downloads with correct filename `showback-{period}.zip`.
  - [ ] ZIP contains one PDF per customer.
  - [ ] Each PDF has correct customer data and totals.
- [ ] **Download CSV**: Existing endpoint works (format=csv).
- [ ] **Download JSON**: Existing endpoint works (format=json).
- [ ] **Per-row Download PDF**: Fetch `format=pdf&customerId=X`, browser saves single PDF.
  - [ ] PDF filename: `showback-{customerId}-{period}.pdf`.
  - [ ] PDF header includes customer name, period, tenant name.
  - [ ] PDF line items match CostSnapshots for that customer/period.
  - [ ] PDF totals calculated correctly (original + markup = adjusted).
  - [ ] Markup % applied correctly in calculations (no float precision errors).
  - [ ] Multi-page PDF generated if >15 line items.
  - [ ] Page numbering correct ("X of Y").
- [ ] **Per-row Email PDF**: Triggers `POST /api/admin/report/invoicing/email`.
  - [ ] Prompt for recipient email address.
  - [ ] Email sent via Microsoft Graph (AZURE_SENDER_EMAIL configured).
  - [ ] Email subject: `Showback Report - {customerName} - {period}`.
  - [ ] Email body includes HTML formatting, cost summary table, professional branding.
  - [ ] PDF attached to email as base64.
  - [ ] Toast notification on success/failure.
- [ ] **ActionLogs entries created**:
  - [ ] `action_type='SHOWBACK_PDF_GENERATED'` for each download.
  - [ ] `resource_id='{customerId}:{period}'` for single PDFs or `'all:{period}'` for ZIP.
  - [ ] `status='SUCCESS'` or `'FAILED'`.
  - [ ] `user_email` recorded from claims.
- [ ] **Tenant notifications** (via notifyTenant):
  - [ ] When PDF emailed, notify tenant via configured channels (Slack, Teams, Email).
  - [ ] Notification severity: `info`.
- [ ] **MockBanner** displayed for mock tenant.
- [ ] **Mock tenant** (`demo_tenant` or mock UUIDs):
  - [ ] Uses MOCK_PAYLOAD for all downloads.
  - [ ] PDF generation works without DB access.
  - [ ] ZIP contains 3 mock customer PDFs.
- [ ] **Error handling**:
  - [ ] 401 if no auth token.
  - [ ] 403 if user not ADMIN role or not in tenant.
  - [ ] 404 if customer not found (when customerId specified).
  - [ ] 503 if AZURE_SENDER_EMAIL not configured (email endpoint).
  - [ ] Audit log FAILED status on errors.

### `/admin/payments`
- [ ] Historial de pagos (vista global, no por tenant).

---

## 13. Admin — billing (Paddle)
**Tier**: Essential · **Doc**: [`paddle-billing.md`](./paddle-billing.md)

### `/admin/billing` UI
- [ ] Plan actual: badge con tier + status.
- [ ] Countdown de trial si `subscription_status=TRIAL`.
- [ ] **Cambiar plan** modal: selector tier × billing (monthly/yearly) + proration mode.
- [ ] **Método de pago** abre URL de Paddle en nueva tab.
- [ ] **Historial de facturas** lista BillingTransactions DESC.
- [ ] **Cancelar suscripción** con confirm; acepta "immediately" o "next period".

### Flujo end-to-end (sandbox)
- [ ] `/pricing` → click plan → overlay Paddle abre (sandbox env).
- [ ] Pago con tarjeta test `4242 4242 4242 4242` → checkout completa.
- [ ] Webhook `subscription.created` actualiza tier + paddle_subscription_id en DB.
- [ ] `/admin/billing` refleja el nuevo plan.
- [ ] PATCH upgrade Essential→Pro con `prorated_immediately` → invoice diff aparece.
- [ ] PATCH downgrade Pro→Essential con `prorated_next_billing_period` → cambio efectivo en próximo ciclo.
- [ ] DELETE cancel → webhook `subscription.canceled` → status='CANCELED'.

### Webhook
- [ ] `POST /api/webhooks/paddle` sin `paddle-signature` → 401.
- [ ] Con signature stale (>5 min) → 401.
- [ ] Con signature válida + `subscription.created` → tier asignado, paddle_subscription_id guardado.
- [ ] `transaction.completed` → row en BillingTransactions.
- [ ] `transaction.payment_failed` → notificación a canales del tenant.
- [ ] `subscription.past_due` → status='PAST_DUE'.

### Forward local (para sandbox)
```bash
paddle webhooks forward http://localhost:3000/api/webhooks/paddle --env sandbox
```

---

## 14. Admin — SSO SAML (WorkOS)
**Tier**: Enterprise · **Doc**: [`sso-setup.md`](./sso-setup.md)

### Prerequisitos
- [ ] `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI`, `SSO_SESSION_SECRET` (>=32 chars) en `.env.development`.
- [ ] Tenant de prueba con tier Enterprise.

### UI
- [ ] `/admin/sso` carga (Enterprise only).
- [ ] Tenant non-Enterprise → upgrade CTA.
- [ ] Formulario: domain, workos_org_id, workos_connection_id, enabled toggle.
- [ ] **Generate Admin Portal Link** abre WorkOS self-service portal (cliente IT sube su metadata SAML).
- [ ] **Test SSO** abre nueva tab con `/api/auth/sso/start`.

### Flujo
- [ ] Login en IdP del cliente → callback setea cookie `finops_sso` (HttpOnly, Secure prod, SameSite=Lax).
- [ ] Redirige a `/{locale}/overview`.
- [ ] `GET /api/auth/sso/me` retorna `{ authenticated: true, email, tenantId, source: "sso" }`.
- [ ] `POST /api/auth/sso/logout` borra cookie + row SSOSessions.

### Negativos
- [ ] WorkOS sin configurar → `/api/auth/sso/start` retorna 503.
- [ ] Callback sin `code` → 400.
- [ ] TenantSSO con `enabled=false` → start retorna 403.

### Coexistencia
- [ ] MSAL (Azure AD) sigue funcionando para usuarios no-SAML.

---

## 15. Admin — notificaciones multi-canal
**Tier**: Professional · **Doc**: [`notifications.md`](./notifications.md)

### Prerequisitos
- [ ] Slack webhook URL (de `api.slack.com/apps`).
- [ ] Teams webhook URL (Connectors → Incoming Webhook).
- [ ] SMTP configurado en `.env.development` (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`) o por tenant.

### UI `/admin/notifications`
- [ ] Tabla de canales con type badge + enabled toggle.
- [ ] **Add channel** selector type (slack/teams/email) → fields dinámicos por type.
- [ ] Crear Slack con webhook URL → aparece en tabla.
- [ ] Crear Teams con webhook URL.
- [ ] Crear Email con `recipients: ["a@b.com"]`.
- [ ] **Test** dispara payload de prueba; mensaje llega real al canal.
- [ ] **Delete** con confirm elimina canal.

### Dispatcher
- [ ] Trigger desde `/api/intelligence/anomalies` → fan-out a TODOS los canales enabled cuyo `severity_filter` incluya el severity.
- [ ] Canal con `severity_filter=error` NO recibe alertas `info`.
- [ ] Back-compat: legacy `webhook_url` en Tenants sigue recibiendo.
- [ ] `NotificationLog` registra cada envío (success/failed + error_message).

### Visual por canal
- [ ] **Slack**: header con emoji por severity (🟢🟡🔴), section con mensaje, context con timestamp.
- [ ] **Teams**: Adaptive Card 1.4 con color (Good/Warning/Attention) + botón opcional "Ver detalle".
- [ ] **Email**: subject `[SEVERITY] title`, body HTML.

### Negativos
- [ ] POST sin `type` → 400.
- [ ] POST con `type: "sms"` → 400.
- [ ] Slack webhook malformado → 400.

---

## 16. Admin — MCP server keys
**Tier**: Professional · **Doc**: [`feature-F-mcp-server.md`](./feature-F-mcp-server.md)

### UI `/admin/mcp-keys`
- [ ] Lista keys del tenant (sin plaintext).
- [ ] **Create key** muestra plaintext UNA VEZ con copy button.
- [ ] **Delete** con confirm elimina key.
- [ ] Refrescar página NO vuelve a mostrar plaintext.

### API
- [ ] `GET /api/mcp` (sin auth) → 200 con `name:"finops-saas-mcp"`, `tools.length===5`.
- [ ] `POST /api/mcp` sin Authorization → 401.
- [ ] `POST /api/mcp` con Bearer válido + `method:"tools/list"` → 200 con tools array.
- [ ] `method:"initialize"` → devuelve serverInfo.
- [ ] `method:"tools/call"` con tool inválido → JSON-RPC error `-32601`.
- [ ] Key disabled → 401.

---

## 17. Admin — Power BI templates
**Tier**: Professional · **Doc**: [`feature-G-powerbi-templates.md`](./feature-G-powerbi-templates.md)

### UI `/admin/powerbi-templates`
- [ ] 4 cards: `cost-overview`, `sustainability`, `zombies`, `budgets`.
- [ ] Click abre modal con script Power Query M.
- [ ] **Copiar M** copia al portapapeles + toast.
- [ ] Placeholders `<YOUR_BASE_URL>` y `<YOUR_MCP_KEY>` visibles.

### API
- [ ] `GET /api/templates/powerbi` → 200 con `count:4`.
- [ ] `GET /api/templates/powerbi/cost-overview` → 200 con template + usage.
- [ ] `?format=pq` → Content-Type `text/plain`.
- [ ] ID inexistente → 404.

### Power BI Desktop (manual)
- [ ] Pegar script en Power BI → Get Data → Blank Query → Advanced Editor.
- [ ] Reemplazar placeholders, conexión exitosa, datos cargados.

---

## 18. Admin — pricing units
**Tier**: Essential · **Doc**: [`feature-B-pricing-units.md`](./feature-B-pricing-units.md)

### UI `/admin/pricing-units`
- [ ] Tabla de UoMs carga.
- [ ] **Reseed** repuebla tabla + toast.
- [ ] **Test normalizador**: `100 Hours`→730, `10K Transactions`→50000, `1M Tokens`→2500000.

### API
- [ ] `GET /api/admin/pricing-units` (autenticado) → lista `count>0`.
- [ ] `POST /api/admin/pricing-units/reseed` sin auth → 401.
- [ ] `POST /api/admin/pricing-units/normalize` con `{ unit:"100 Hours" }` → `{ multiplier: 730 }`.

### Fallback
- [ ] Sin DB → fallback embebido, no crashea.

---

## 19. Admin — usuarios, tenants, copilot M365, workbooks

### `/admin/users`
- [ ] CRUD usuarios del tenant.
- [ ] Asignar rol: OWNER/ADMIN/MEMBER/VIEWER.
- [ ] Invitar por email.

### `/admin/tenants`
- [ ] Vista de tenants accesibles al usuario.
- [ ] Cambiar tenant activo.

### `/admin/copilot-m365`
**Tier**: Enterprise
- [ ] Análisis Copilot M365 cost + adoption.

### `/admin/workbooks`
**Tier**: Enterprise
- [ ] Workbooks personalizados embebidos.

---

## 20. SuperAdmin (corporate-only)

> Solo accesible para emails `@cscloudsolutions.com.ar` con `system_role=SUPERADMIN`.

### `/superadmin/health`
- [ ] Status de la plataforma: DB, Redis, AI provider, Paddle.
- [ ] Uptime y last sync por tenant.

### `/superadmin/tenants`
- [ ] Lista TODOS los tenants del SaaS.
- [ ] Force impersonate (con audit log).
- [ ] Suspender/Reactivar tenant.

### `/superadmin/users`
- [ ] Lista TODOS los usuarios.
- [ ] Promote/Demote SUPERADMIN.

---

## 21. Demo mode y mock tenant

### `/demo`
- [ ] Landing demo con datos mockeados.
- [ ] No requiere login.
- [ ] Banner "DEMO MODE" visible.

### Mock tenant (`demoSession`)
- [ ] Al loguearte sin tenant real, se asigna `demoSession`.
- [ ] Todos los widgets cargan con datos sintéticos.
- [ ] `isMockTenant()` retorna `true` y dispara `MockBanner`.

---

## 22. Multi-currency (FX)
**Tier**: Essential · **Doc**: [`feature-D-multicurrency.md`](./feature-D-multicurrency.md)

### UI
- [ ] **CurrencySelector** en topbar muestra USD default + permite cambiar a EUR/ARS/BRL/CLP/MXN/etc.
- [ ] Al cambiar, todos los montos se reformatean (símbolo + valor convertido).
- [ ] Preferencia persiste tras refrescar.

### API
- [ ] `GET /api/fx/rates` → 200 con `rates.USD === "1"` (string Decimal).
- [ ] `GET /api/fx/preference?tenantId=X` (auth) → 200 con `currency`.
- [ ] `POST /api/fx/preference` con `{ currency: "ZZZ" }` → 400.
- [ ] `POST` con `{ currency: "EUR" }` → 200, persiste.

### Precisión
- [ ] Conversiones usan **Decimal.js** — montos nunca `99.99999...`.

---

## 23. i18n (multi-idioma)

- [ ] Switcher de idioma cambia entre `es`, `en` (y otros configurados).
- [ ] URL respeta locale prefix (`/es/...`, `/en/...`).
- [ ] Strings de cada idioma cargan desde `messages/{locale}.json`.
- [ ] Sin string traducido → fallback al default sin mostrar key cruda.

---

## 24. Status page pública
**Acceso**: público (sin login) · **Doc**: [`status-page.md`](./status-page.md)

### Página
- [ ] `/status` redirige a `/{defaultLocale}/status`.
- [ ] `/es/status` carga **sin estar logueado**.
- [ ] Banner grande con estado global (🟢/🟡/🔴).
- [ ] 5 cards de componentes: API, Database, Azure Sync, AI Provider, Paddle Billing.
- [ ] Latencias visibles (ms) por componente cuando aplica.
- [ ] "Uptime 30 days: XX.XX%" stat presente.
- [ ] Lista de incidentes recientes (30d) con timeline.
- [ ] Página funciona **sin JavaScript** (HTML puro, meta refresh 60s).

### API
- [ ] `GET /api/status` → 200 con `status`, `components[]`, `timestamp`, `uptime_30d_pct`, `version`.
- [ ] Headers: `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=30`.
- [ ] DB caída → componente `Database` con `down` y `status` global `down`.
- [ ] >50% de tenants con `sync_status != 'OK'` → componente Azure Sync `degraded`.
- [ ] `GEMINI_API_KEY` vacío → AI Provider `degraded`.
- [ ] `PADDLE_API_KEY` vacío → Paddle Billing `degraded`.

### Incidentes
- [ ] `GET /api/status/incidents` (público) → array de PlatformIncidents últimos 30d.
- [ ] `POST /api/status/incidents` sin superadmin → 401.
- [ ] `POST` con superadmin + `{ title, severity, status, started_at, description }` → crea incidente.
- [ ] `PATCH /api/status/incidents/:id` con superadmin → actualiza status/resolved_at.

### Snapshots (cron)
- [ ] `GET /api/cron/status-snapshot?secret=$CRON_SECRET` → 200 + inserta row en PlatformStatusSnapshots.
- [ ] Sin secret correcto → 401.
- [ ] Configurar Vercel cron / crontab cada 5min según [`status-page.md`](./status-page.md).

---

## 25. Audit log export
**Tier**: Admin role required · **Doc**: [`audit-log.md`](./audit-log.md)

### UI `/admin/audit`
- [ ] Tabla con paginación **server-side** (no client-side).
- [ ] Total count visible: "X resultados (mostrando Y-Z)".
- [ ] Filtros: user_email (LIKE), action_type (select), status (select), date range (from/to).
- [ ] "Aplicar filtros" re-fetcha con query params.
- [ ] "Limpiar" resetea.
- [ ] 4 botones export: **CSV (página actual)**, **CSV (filtrado completo)**, **JSON**, **NDJSON**.
- [ ] Cada export descarga archivo con nombre `audit-{tenantId}-{YYYYMMDD}.ext`.

### API
- [ ] `GET /api/admin/audit?tenantId=X` (auth) → `{ logs, total, limit, offset, hasMore }`.
- [ ] `?format=csv` → Content-Type `text/csv`, body con header `id,timestamp,user_email,action_type,resource_id,status`.
- [ ] `?format=ndjson` → Content-Type `application/x-ndjson`, una línea por log.
- [ ] Filtros combinables: `?action_type=DELETE&from=2026-01-01&to=2026-06-30`.
- [ ] `limit` max 1000.
- [ ] Sin tenantId → 400.

### Export completo
- [ ] `GET /api/admin/audit/export?tenantId=X` (ADMIN role) → streaming CSV.
- [ ] Sin auth ADMIN → 401/403.
- [ ] Cap 100k filas; batches de 5k para evitar OOM.
- [ ] Filename: `audit-{tenantId}-full-{ISO date}.csv`.

### CSV escaping (RFC 4180)
- [ ] Valor con coma → entrecomillado.
- [ ] Valor con comilla → comilla doblada.
- [ ] Valor con newline → entrecomillado.

---

## 26. API pública v1 + OpenAPI
**Tier**: Professional (admin para crear keys) · **Doc**: [`api-v1.md`](./api-v1.md)

### Admin UI `/admin/api-keys`
- [ ] Tabla de keys: name, prefix, scopes, rate limit, enabled toggle, last_used_at.
- [ ] **Create key** modal: name, scopes multi-select, rate limit slider (10-1000/min).
- [ ] Plaintext mostrado UNA VEZ con copy button (formato `pak_test_<hex>` o `pak_live_`).
- [ ] **Delete** con confirm.
- [ ] Refrescar página NO vuelve a mostrar plaintext.

### API key auth
- [ ] `POST /api/v1/*` sin header → 401 con envelope `{ error: { code:"unauthorized", request_id } }`.
- [ ] Authorization Bearer `pak_xxx` válido → autorizado.
- [ ] `X-API-Key: pak_xxx` también válido.
- [ ] Key disabled → 401.
- [ ] Key con scope insuficiente → 403 `{ code:"forbidden_scope" }`.

### Endpoints v1
- [ ] `GET /api/v1/me` (cualquier key válida) → `{ tenantId, key_name, scopes, rate_limit }`.
- [ ] `GET /api/v1/cost/summary?from=&to=&groupBy=service` (scope `read:cost`) → datos agregados.
- [ ] `GET /api/v1/cost/timeseries?from=&to=&granularity=daily` → timeseries.
- [ ] `GET /api/v1/resources?type=&limit=&offset=` (scope `read:resources`) → lista.
- [ ] `GET /api/v1/budgets` (scope `read:budgets`).
- [ ] `GET /api/v1/recommendations` (scope `read:recommendations`).
- [ ] `GET /api/v1/anomalies?from=&to=&severity=` (scope `read:anomalies`).
- [ ] Bad date range → 400 con código de error claro.

### Envelope + headers
- [ ] Success: `{ data, meta: { request_id, rate_limit: { limit, remaining, reset } } }`.
- [ ] Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-Request-Id`.
- [ ] Money values como **string Decimal**, nunca floats.

### Rate limiting
- [ ] Hacer N+1 requests donde N = rate_limit_per_min → llamada N+1 retorna 429.
- [ ] Header `X-RateLimit-Remaining` decrementa correctamente.

### OpenAPI + Swagger UI
- [ ] `GET /api/v1/openapi.json` (público) → 200 con `openapi: "3.1.0"`.
- [ ] `GET /api/v1/docs` (público) → HTML con Swagger UI funcional desde CDN.
- [ ] Swagger UI permite probar endpoints con un X-API-Key real.

### Curl smoke
```bash
KEY="pak_test_xxx"
BASE="http://localhost:3000/api/v1"
curl -H "X-API-Key: $KEY" "$BASE/me"
curl -H "X-API-Key: $KEY" "$BASE/cost/summary?from=2026-01-01&to=2026-06-30&groupBy=service"
curl "$BASE/openapi.json" | jq .openapi
```
- [ ] Los 3 comandos responden esperado.

---

## 27. Self-service signup + free trial funnel
**Doc**: [`signup-trial-funnel.md`](./signup-trial-funnel.md)

### Pages & Components
- [ ] `/signup` public page loads without auth
- [ ] Plan selector shows Essential, Professional, Business, Enterprise
- [ ] Each plan CTA stores plan in sessionStorage and calls `instance.loginRedirect`
- [ ] After login, `/api/onboard` auto-creates Tenant with tier and trial dates
- [ ] Welcome email sent with CTA to /overview
- [ ] TrialBanner component shows on all authenticated pages
  - [ ] Blue banner for >7 days
  - [ ] Yellow banner for 3-7 days
  - [ ] Red banner for ≤2 days or EXPIRED
  - [ ] Dismissible for 24h (localStorage)
- [ ] TrialStatusCard widget on dashboard shows trial countdown

### Trial Lifecycle
- [ ] Day 0: Trial starts, SignupEvents `trial_started` logged, welcome email sent
- [ ] Day 12: Reminder email sent once (no duplicates via last_trial_reminder_at)
- [ ] Day 14: Cron job runs, trial marked EXPIRED, email sent, banner becomes non-dismissable
- [ ] Expired user cannot access non-public routes or sees readonly mode
- [ ] User can upgrade anytime → subscription_status changes to ACTIVE, SignupEvents `converted_to_paid`

### API Endpoints
- [ ] `POST /api/onboard` accepts Bearer token + plan, creates Tenant, sends email
  - [ ] Without auth: 401
  - [ ] With valid token: 200 + Tenant created
  - [ ] SignupEvents row inserted with plan and metadata
- [ ] `POST /api/onboard/complete` marks is_onboarded=TRUE
  - [ ] Without auth: 401
  - [ ] With auth: 200 + SignupEvents `onboarding_completed`
- [ ] `GET /api/cron/trial-expiry?secret=CRON_SECRET` processes expired trials
  - [ ] Without secret: 401
  - [ ] With valid secret: 200 + returns { processed, expired, reminded }
  - [ ] Finds TRIAL tenants with trial_ends_at < NOW, sets status=EXPIRED
  - [ ] Finds tenants with trial_ends_at within 2d, sends reminder (once per 24h)
  - [ ] Sends emails async (fire-and-forget, never blocks response)
- [ ] `POST /api/superadmin/tenants/extend-trial` with `{ tenantId, days }`
  - [ ] Without superadmin: 401
  - [ ] With superadmin: 200 + trial extended
  - [ ] If tenant is EXPIRED, status reverts to TRIAL
  - [ ] SignupEvents `trial_extended` logged with admin_email and days
- [ ] `GET /api/superadmin/funnel` returns analytics
  - [ ] Without superadmin: 401
  - [ ] With superadmin: 200 + JSON with KPIs, funnel stages, recent signups
  - [ ] KPIs: signups_30d, trials_active, converted, conversion_pct, churn_pct

### Superadmin Dashboard
- [ ] `/superadmin/funnel` page loads with KPI cards (signups, active trials, converted, conversion %, churn %)
- [ ] Funnel visualization shows 4 stages with counts and % bars
- [ ] Recent signups table (last 50) with email, plan, status, days_left, created_at

### Database
- [ ] `SignupEvents` table created with correct ENUM values and indexes
- [ ] `Tenants.last_trial_reminder_at` column added
- [ ] `Tenants.trial_ends_at` and `subscription_status` already present

### Email & Cron
- [ ] Welcome email template has branded HTML, CTA to /overview
- [ ] Reminder email sent on day 12, max once per tenant
- [ ] Expired email sent on day 14+
- [ ] Cron secret configured in `.env` (CRON_SECRET)
- [ ] Cron runs daily (Vercel, AWS EventBridge, or crontab)
- [ ] Email sending is async (fire-and-forget, no response blocking)
- [ ] If AZURE_SENDER_EMAIL not configured, emails skipped silently

### i18n
- [ ] `messages/en.json` has `signup` namespace with all keys
- [ ] `messages/es.json` has Spanish translations
- [ ] `messages/pt-BR.json` has Portuguese translations
- [ ] Plan names, CTA labels, FAQ all translated

### Tests
- [ ] Unit test `trialStatus.test.ts` covers getTrialState() helper
  - [ ] TRIAL with 5d → warning severity
  - [ ] TRIAL with 14d → info severity
  - [ ] TRIAL with 1d → critical severity
  - [ ] EXPIRED → expired=true
  - [ ] ACTIVE → null state
- [ ] Integration test `api-signup.test.ts` covers all endpoints
  - [ ] /api/onboard auth checks
  - [ ] /api/onboard/complete auth checks
  - [ ] /api/cron/trial-expiry secret checks
  - [ ] /api/superadmin/.../extend-trial auth checks
  - [ ] /api/superadmin/funnel returns correct schema

---

## 28. Tests + CI
**Doc**: [`testing.md`](./testing.md)

### Local
- [ ] `npm test` → 293 tests passing en <2s.
- [ ] `npm run test:coverage` genera `coverage/index.html`.
- [ ] `npm run typecheck` sin errores.
- [ ] `npm run lint` sin errores.

### CI (GitHub Actions)
- [ ] `.github/workflows/ci.yml` ejecuta lint, typecheck, test, build en PR a main/staging y push a staging.
- [ ] Coverage artifact subido.
- [ ] Build depende de lint + typecheck.

---

## 29. ML Forecasting (Linear, EMA, Holt-Winters)

> **Ruta**: `/api/intelligence/forecast` (GET/POST) · `/intelligence/billing` (UI)
> **Tier**: Professional+ (forecasting con confianza bands Pro, análisis básico Essential)
> **Docs**: `/docs/forecasting.md`

### API: GET `/api/intelligence/forecast` (Forecasting avanzado)

- [ ] **Sin auth → 401**: `curl http://localhost:3000/api/intelligence/forecast -s | jq .error`
- [ ] **Sin tenantId → 400**: `curl "http://localhost:3000/api/intelligence/forecast" -H "Authorization: Bearer $TOKEN" -s | jq .error`
- [ ] **method=linear**: `curl "http://localhost:3000/api/intelligence/forecast?tenantId=demo&method=linear&days=30" -H "Authorization: Bearer $TOKEN" | jq '.method_used'` → `"linear"`
- [ ] **method=ema**: `curl "http://localhost:3000/api/intelligence/forecast?tenantId=demo&method=ema&days=30" -H "Authorization: Bearer $TOKEN" | jq '.method_used'` → `"ema"`
- [ ] **method=holt_winters**: `curl "http://localhost:3000/api/intelligence/forecast?tenantId=demo&method=holt_winters&days=30" -H "Authorization: Bearer $TOKEN" | jq '.forecast | length'` → `30`
- [ ] **method=auto (backtest)**: `curl "http://localhost:3000/api/intelligence/forecast?tenantId=demo&method=auto" -H "Authorization: Bearer $TOKEN" | jq '.method_used'` → uno de `linear`, `ema`, `holt_winters`
- [ ] **withConfidence=true**: Forecast tiene campos `lower`, `upper` (95% CI): `jq '.forecast[0] | keys'` contiene `lower`, `upper`
- [ ] **withBacktest=true**: Response incluye objeto `backtest` con `rmse`, `mape`, `mae`: `jq '.backtest | keys'` incluye `rmse`, `mape`, `mae`
- [ ] **days=90 (max)**: `curl "...&days=200"` limita a 90: `jq '.metrics.forecast_horizon_days'` ≤ `90`
- [ ] **Anomalies**: Si datos spike, `jq '.anomalies | length'` > 0; cada anomalía tiene `date`, `z_score`, `is_anomaly`
- [ ] **Fallback EMA**: Si history < 14 días y method=holt_winters, devuelve method_used="ema"

### API: POST `/api/intelligence/forecast` (Proyección fin de mes)

- [ ] **Sin auth → 401**: `curl -X POST http://localhost:3000/api/intelligence/forecast -d '{}' -s | jq .error`
- [ ] **Sin tenantId → 400**: Similar.
- [ ] **Tier Starter/Essential → 403**: POST devuelve "Feature bloqueada. Requiere plan Pro o superior."
- [ ] **Tenant inválido → 404**: `curl -X POST ... -d '{"tenantId":"invalid"}' -H "Authorization: $TOKEN" | jq .error` → "Tenant no encontrado"
- [ ] **Sin historial → 200 empty**: Si no hay costs actuales, devuelve `{"success":true, "empty":true, "chartData": []}`
- [ ] **method=linear**: `jq '.method_used'` → `"linear"`
- [ ] **method=holt_winters**: `jq '.method_used'` → `"holt_winters"` (si history ≥ 14 días)
- [ ] **method=auto**: Elige mejor vía backtest
- [ ] **Presupuesto OK**: `projectedEndOfMonthCost < monthlyBudget` → `isBreachPredicted: false`, `breachDate: null`
- [ ] **Presupuesto breach**: `projectedEndOfMonthCost > monthlyBudget` → `isBreachPredicted: true`, `breachDate` es ISO date
- [ ] **chartData**: Array con 30 (o días del mes) elementos, cada uno con `day`, `actualSpend` (días pasados), `forecastedSpend` (días futuros), `budgetLimit`

### Unit Tests

- [ ] `npm run test -- __tests__/unit/forecasting.test.ts` pasa: ✓ Linear perfect fit (y=2x+1)
- [ ] `✓ EMA smoothing`
- [ ] `✓ Holt-Winters seasonality (weekly pattern)`
- [ ] `✓ Confidence intervals (lower < forecast < upper)`
- [ ] `✓ Backtest metrics (RMSE, MAPE, MAE)`
- [ ] `✓ Anomaly detection`

### Integration Tests

- [ ] `npm run test -- __tests__/integration/api-forecast.test.ts` pasa: ✓ GET sin auth → 401
- [ ] `✓ GET method=linear`
- [ ] `✓ GET withConfidence`
- [ ] `✓ GET auto method selection`
- [ ] `✓ POST breach detection`
- [ ] `✓ POST tier validation`

### UI Forecast Card (if implemented)

- [ ] En `/intelligence/billing` o widget nuevo:
  - [ ] Method selector dropdown: Linear / EMA / Holt-Winters / Auto
  - [ ] Confidence bands rendered (shaded area si usando Recharts)
  - [ ] Badge mostrando "Method: holt_winters · MAPE: 8.2%"
  - [ ] Si anomalía en datos recientes, marker rojo en el punto
  - [ ] Days input (default 30, max 90)
  - [ ] Export forecast a CSV

### Backwards Compatibility

- [ ] GET sin query params (o legacy call) devuelve array `data` con `date`, `actualCost`, `forecastCost` (formato antiguo)
- [ ] Clientes antiguos no se rompen

### Documentation

- [ ] `docs/forecasting.md` existe y cubre:
  - [ ] Overview de métodos (Linear, EMA, Holt-Winters)
  - [ ] Cuándo usar cada uno
  - [ ] Fórmulas y parámetros
  - [ ] Ejemplos de uso
  - [ ] Troubleshooting
  - [ ] Referencias

---

## 30. 2FA/MFA (TOTP)
**Doc**: [`mfa.md`](./mfa.md)
**Tier**: Essential (available for all users)

### UI — Enrollment & Management
- [ ] Navigate to **Admin → Security** page loads with "Two-Factor Authentication" card
- [ ] Click "Enable 2FA" shows modal with QR code, manual secret, and 10 recovery codes
- [ ] Can scan QR with authenticator app (Google Authenticator, Microsoft Authenticator, Authy)
- [ ] Can enter manual secret in app instead of scanning
- [ ] Recovery codes show as copyable list with "Download as Text" button
- [ ] Enter 6-digit TOTP code from app
- [ ] Click "Verify & Enable" enables 2FA
- [ ] MFA status updates to "Active" with last used timestamp
- [ ] "Disable 2FA" button appears after enabling
- [ ] "View Recovery Codes" button shows recovery codes with hide/show toggle
- [ ] Can copy individual recovery codes with one-click copy

### API — Enrollment
- [ ] POST `/api/mfa/enroll/start` without auth → 401
- [ ] POST `/api/mfa/enroll/start` with auth → 200, returns `{ qrCodeDataUrl, manualSecret, recoveryCodes[10] }`
- [ ] Manual secret is valid Base32 string
- [ ] QR code is valid PNG data URL (otpauth://)
- [ ] Recovery codes are 10 chars alphanumeric, all unique
- [ ] POST `/api/mfa/enroll/verify` with wrong token → 400 "Invalid token"
- [ ] POST `/api/mfa/enroll/verify` with correct token → 200, `{ enabled: true }`
- [ ] User `mfa_enabled` = TRUE in DB
- [ ] User `mfa_secret_encrypted` stored as JSON with `{ ciphertext, iv, authTag }`
- [ ] User `mfa_recovery_codes_hash` stored as JSON array of 10 bcrypt hashes

### API — Challenge & Verification
- [ ] POST `/api/mfa/challenge` with `{ operation: "...", payload?: {} }` without auth → 401
- [ ] POST `/api/mfa/challenge` with MFA disabled user → 412, `{ error: { code: "mfa_required" }, mfa_enrollment_required: true }`
- [ ] POST `/api/mfa/challenge` with MFA enabled user → 200, `{ challenge_id }`
- [ ] Challenge expires after 5 minutes
- [ ] Challenge row in MfaChallenges table has all fields (id, user_email, tenant_id, operation, payload_hash, expires_at, consumed_at)
- [ ] POST `/api/mfa/verify-challenge` with invalid challenge_id → 404
- [ ] POST `/api/mfa/verify-challenge` with expired challenge → 400
- [ ] POST `/api/mfa/verify-challenge` with correct TOTP token → 200, `{ verified: true }`
- [ ] POST `/api/mfa/verify-challenge` with valid recovery code → 200, `{ verified: true }`
- [ ] Challenge marked as consumed after verification
- [ ] User `mfa_last_used_at` updated to NOW()
- [ ] Recovery code hashes updated to remove used code

### API — Disable
- [ ] POST `/api/mfa/disable` with valid TOTP token → 200, `{ disabled: true }`
- [ ] POST `/api/mfa/disable` with valid recovery code → 200, `{ disabled: true }`
- [ ] User `mfa_enabled` = FALSE
- [ ] User `mfa_secret_encrypted` = NULL
- [ ] User `mfa_recovery_codes_hash` = NULL

### Integration — Sensitive Operations
- [ ] Endpoint decorated with `requireMfaChallenge()` rejects request without `X-MFA-Challenge-Id` header → 403
- [ ] Endpoint accepts request with valid `X-MFA-Challenge-Id` header → proceeds
- [ ] Payload hash verified correctly (same payload → same challenge)
- [ ] Challenge verified within 60 seconds of consumption

### MfaPromptModal Component
- [ ] Component accepts `open`, `operation`, `payload`, `onVerified`, `onCancel` props
- [ ] Shows dialog when `open=true`
- [ ] Auto-calls `/api/mfa/challenge` when modal opens
- [ ] Prompts for 6-digit TOTP or recovery code
- [ ] Calls `/api/mfa/verify-challenge` on submit
- [ ] Shows error toasts for invalid codes
- [ ] Calls `onVerified(challengeId)` on success
- [ ] Calls `onCancel()` when closing modal

### Database
- [ ] `Users` table has: `mfa_enabled`, `mfa_secret_encrypted`, `mfa_recovery_codes_hash`, `mfa_last_used_at`
- [ ] `MfaChallenges` table created with all columns and indexes
- [ ] Encryption key configured in `.env.development`: `MFA_ENCRYPTION_KEY` (64 hex chars)

### Tests
- [ ] Unit tests `__tests__/unit/mfa.test.ts`:
  - [ ] AES encrypt/decrypt round-trip works
  - [ ] Different IVs produce different ciphertexts
  - [ ] Wrong key fails decryption
  - [ ] Recovery codes: 10 codes, 10 chars alphanum, all unique
  - [ ] Verify valid recovery code removes it from list
  - [ ] Reject invalid recovery code
  - [ ] Payload hash consistent
- [ ] Integration tests `__tests__/integration/api-mfa.test.ts`:
  - [ ] Endpoints require auth
  - [ ] Database schema correct
  - [ ] Encryption round-trip in DB

### Security
- [ ] TOTP secrets encrypted AES-256-GCM, not stored in plaintext
- [ ] Recovery codes bcrypt hashed, not stored in plaintext
- [ ] `MFA_ENCRYPTION_KEY` environment variable required; error if missing/wrong length
- [ ] Challenges expire after 5 minutes
- [ ] Verification window ±30 seconds (standard TOTP)
- [ ] Recovery codes burn after use (cannot be reused)
- [ ] Audit log entries for enable/disable (TODO if audit system exists)

---

## 31. Onboarding Wizard

**Route:** `/{locale}/onboarding` (no Sidebar)
**Tier:** All (Essential+)
**DB:** `OnboardingProgress` table
**Auth:** Requires ADMIN role
**Docs:** `docs/onboarding-wizard.md`

### UI Checks
- [ ] Wizard loads without /admin/onboarding in URL.
- [ ] All 5 steps display in vertical order: Welcome → Azure SP → Sync → Budget → Notifications.
- [ ] Progress bar shows 0% on load, updates when steps completed.
- [ ] Step 1 (Welcome): Can enter company name, select cloud, currency, timezone.
- [ ] Step 2 (Azure SP): Can paste client_id, secret, tenant_id. "Validate" button shows green ✓ on success or red ✗ on failure.
- [ ] Step 3 (Sync): "Run Sync" shows spinner for 2-3s, then marks complete.
- [ ] Step 4 (Budget): Form accepts budget name, monthly limit, alert threshold. "Create Budget" on success advances to Step 5.
- [ ] Step 5 (Notifications): Link to `/admin/notifications` opens in new tab; user can return and continue.
- [ ] "Finish Onboarding" button at bottom (only when all steps are completed/skipped).
- [ ] "Skip wizard" link in header redirects to overview.
- [ ] "Advanced Setup" button links to `/admin/onboarding`.
- [ ] Each step shows status: pending (gray dot), in_progress (spinner), completed (✓), skipped (⚠️).

### Auto-Redirect Check
- [ ] New tenant with `is_onboarded=0`: redirects to wizard on first login.
- [ ] Existing tenant with `is_onboarded=1`: does not redirect; shows overview.
- [ ] Redirect uses `useRef` to prevent loop.

### API: GET /api/onboarding/progress
- [ ] **Positive:** Authenticated ADMIN returns 200 with progress object including `percent_complete`.
- [ ] **Positive (new tenant):** Returns all steps as "pending" and 0% (no error).
- [ ] **Negative:** No auth token returns 401.
- [ ] **Negative:** Non-ADMIN role returns 403 (if enforced).

### API: PUT /api/onboarding/progress
- [ ] **Positive:** Valid step + status returns 200 with updated progress.
- [ ] **Valid steps:** `step_welcome`, `step_azure_sp`, `step_first_sync`, `step_first_budget`, `step_notifications`.
- [ ] **Valid statuses:** `pending`, `in_progress`, `completed`, `skipped`.
- [ ] **Negative:** Invalid step name returns 400.
- [ ] **Negative:** Invalid status returns 400.
- [ ] **Negative:** No auth returns 401.

### API: POST /api/onboarding/finish
- [ ] **Positive:** Returns 200, sets `is_onboarded=1` on Tenants table.
- [ ] **Positive:** Fires `SignupEvents.onboarding_completed` event.
- [ ] **Positive:** All pending/in_progress steps become "completed"; skipped steps remain skipped.
- [ ] **Positive:** Transaction commits (verify DB state after).
- [ ] **Negative:** No auth returns 401.
- [ ] **Negative:** DB error rolls back transaction (no partial updates).
- [ ] **Post-finish:** User redirected to `/{locale}/overview` with `?onboarding_success=true`.

### Database
- [ ] `OnboardingProgress` table created with all 5 step columns (ENUM + 4 statuses).
- [ ] Tenant foreign key cascades on delete.
- [ ] Unique constraint on `tenant_id`.
- [ ] No rows exist until first step is updated (INSERT IGNORE pattern).

### Tests
- [ ] Unit: `__tests__/unit/onboardingPercent.test.ts` passes (0%, 20%, 40%, 60%, 80%, 100%).
- [ ] Integration: `__tests__/integration/api-onboarding.test.ts` passes (all 6 test cases).
- [ ] Run: `npx vitest run __tests__/integration/api-onboarding.test.ts __tests__/unit/onboardingPercent.test.ts` → all green.

### Links
- **[Wizard Page](../../src/app/[locale]/onboarding/page.tsx)**
- **[API Progress](../../src/app/api/onboarding/progress/route.ts)**
- **[API Finish](../../src/app/api/onboarding/finish/route.ts)**
- **[Components: WizardLayout](../../src/components/onboarding/WizardLayout.tsx)**
- **[Components: WizardStep](../../src/components/onboarding/WizardStep.tsx)**
- **[DB Schema](../../src/modules/storage/db.ts)**
- **[Tests](../../__tests__/integration/api-onboarding.test.ts)**

---

## 32. Data Residency

**Route:** `/{locale}/admin/data-residency` (requires Enterprise + OWNER role)
**Tier:** Enterprise
**DB:** `Tenants.data_residency`, `Tenants.data_residency_locked_at`, `DataResidencyChanges`
**Auth:** Requires tenant access (GET), OWNER role (PUT), SUPERADMIN (lock/unlock)
**Docs:** `docs/data-residency.md`

### UI Checks
- [ ] Admin page loads with current region badge (flag emoji + region name).
- [ ] Current region displays locked status if `data_residency_locked_at` is set.
- [ ] Region selector grid shows all 5 regions (EU, US, LATAM, APAC, GLOBAL) with flags.
- [ ] Selecting a region highlights it with blue border.
- [ ] "Reason for Change" textarea (optional) accepts freetext.
- [ ] "Save Region Change" button disabled if no region selected or same as current.
- [ ] "Save Region Change" button disabled if region is locked (shows message).
- [ ] Subprocessor info section lists cloud providers per region.
- [ ] "Lock My Region" button (if unlocked) shows confirmation dialog.
- [ ] Confirmation dialog warns: "Locking will prevent future region changes without support intervention."
- [ ] After lock: "Locked" badge appears + button disappears, form disabled.
- [ ] Info box explains: "Currently a logical declaration; physical routing Q2 2026."

### Sidebar Check
- [ ] "/admin/data-residency" appears in admin menu with Globe icon.
- [ ] Link hidden if tier is not Enterprise.
- [ ] Link visible only if user has Admin/OWNER role.

### API: GET /api/admin/data-residency?tenantId=X
- [ ] **Positive:** Returns `{ region, locked_at, can_change, available_regions }`.
- [ ] **Positive (locked):** `can_change=false`, `locked_at` has ISO timestamp.
- [ ] **Positive (new tenant):** `region="GLOBAL"`, `locked_at=null`, `can_change=true`.
- [ ] **Negative (no tenantId):** Returns 400 "tenantId query parameter required".
- [ ] **Negative (tenant not found):** Returns 404.
- [ ] **Negative (no auth):** Returns 401.

### API: PUT /api/admin/data-residency
- [ ] **Positive:** Body `{ tenantId, region, reason? }` returns 200 with `{ success, region, message }`.
- [ ] **Positive (with ?lock=true):** Also sets `locked_at=NOW()` + returns `locked=true`.
- [ ] **Audit trail:** Inserts row in `DataResidencyChanges` with from_region, to_region, changed_by, reason.
- [ ] **Audit trail:** Inserts `ActionLogs` entry with type "DATA_RESIDENCY_CHANGED", status "SUCCESS".
- [ ] **Negative (invalid region):** Returns 400 "Invalid region. Must be one of: ...".
- [ ] **Negative (locked):** Returns 423 "Region locked. Contact support.".
- [ ] **Negative (no auth):** Returns 401.
- [ ] **Negative (not OWNER):** Returns 403 "Acceso denegado: requiere rol Admin/OWNER".
- [ ] DB transaction: If error occurs, rollback (no partial updates).

### API: POST /api/admin/data-residency/lock
- [ ] **Positive:** Body `{ tenantId }` returns 200, sets `locked_at=NOW()`.
- [ ] **Positive:** Inserts ActionLogs entry "DATA_RESIDENCY_LOCKED".
- [ ] **Negative (no SUPERADMIN):** Returns 403.
- [ ] **Negative (no auth):** Returns 401.

### API: POST /api/admin/data-residency/unlock
- [ ] **Positive:** Body `{ tenantId }` returns 200, sets `locked_at=NULL`.
- [ ] **Positive:** Inserts ActionLogs entry "DATA_RESIDENCY_UNLOCKED".
- [ ] **Negative (no SUPERADMIN):** Returns 403.
- [ ] **Negative (no auth):** Returns 401.

### Database
- [ ] `Tenants.data_residency ENUM('EU','US','LATAM','APAC','GLOBAL') DEFAULT 'GLOBAL'` exists.
- [ ] `Tenants.data_residency_locked_at DATETIME NULL` exists.
- [ ] `DataResidencyChanges` table created with columns: id, tenant_id, changed_by, from_region, to_region, reason, created_at.
- [ ] Index on `DataResidencyChanges.tenant_id`.
- [ ] New tenants default to `GLOBAL` region.

### Pool Abstraction (`regionPool.ts`)
- [ ] `getTenantPool(region)` returns pool for any valid region code.
- [ ] `getTenantPool(undefined)` returns default GLOBAL pool.
- [ ] `getTenantPool('invalid')` returns default pool (no error).
- [ ] `resolveTenantPool(tenantId)` queries DB and returns `{ pool, region }`.
- [ ] All regions currently map to same pool (roadmap: split in Q2 2026).

### Subprocessors Page
- [ ] `/legal/subprocessors` section "Data Residency & Regional Deployment" lists regions + providers.
- [ ] Section shows: EU (GDPR), US, LATAM, APAC with example subprocessor locations.
- [ ] Note: "Current Implementation: declared and audited; routing Q2 2026."

### Tests
- [ ] Unit: `__tests__/unit/regionPool.test.ts` passes (getTenantPool for all regions).
- [ ] Unit: `getTenantPool("EU")` returns a pool (same as GLOBAL for now).
- [ ] Unit: `getTenantPool(undefined)` returns default pool.
- [ ] Unit: `getTenantPool("INVALID")` returns default pool.
- [ ] Integration: `__tests__/integration/api-data-residency.test.ts` passes all cases.
- [ ] Integration: GET without auth → 401.
- [ ] Integration: GET valid tenant → returns region.
- [ ] Integration: PUT invalid region → 400.
- [ ] Integration: PUT when locked → 423.
- [ ] Integration: PUT valid → 200 + DB updated.
- [ ] Integration: POST unlock without SUPERADMIN → 401/403.
- [ ] Run: `npx vitest run __tests__/unit/regionPool.test.ts __tests__/integration/api-data-residency.test.ts` → all green.

### Compliance Checklist
- [ ] Change history queryable (SELECT from DataResidencyChanges).
- [ ] All changes logged to ActionLogs (audit trail).
- [ ] Region locked once set (prevents accidental changes).
- [ ] Locking requires SUPERADMIN (tenant cannot unlock self).
- [ ] Documentation explains: "Declared residency, not physical isolation (Q1 2026)".
- [ ] Subprocessor list includes region info.

### Links
- **[Data Residency Page](../../src/app/[locale]/admin/data-residency/page.tsx)**
- **[API Main Route](../../src/app/api/admin/data-residency/route.ts)**
- **[API Lock Route](../../src/app/api/admin/data-residency/lock/route.ts)**
- **[API Unlock Route](../../src/app/api/admin/data-residency/unlock/route.ts)**
- **[Pool Abstraction](../../src/modules/storage/regionPool.ts)**
- **[Subprocessors Page](../../src/app/[locale]/legal/subprocessors/page.tsx)**
- **[Documentation](../../docs/data-residency.md)**
- **[Tests](../../__tests__/integration/api-data-residency.test.ts)**

---

## 33. Marketplace listings (Azure + AWS)

### Azure Marketplace

- [ ] Landing page `/marketplace/azure/landing?token=test_xyz` renders (no server required)
  - Displays: "Welcome from Azure Marketplace"
  - Shows plan, features, activation button
  - Mock token resolution works

- [ ] POST `/api/webhooks/marketplace/azure/activate` with valid token
  - Tenant created with `marketplace_source='azure_marketplace'`
  - `marketplace_subscription_id` and `marketplace_plan_id` set correctly
  - Returns 200 with redirect URL

- [ ] POST `/api/webhooks/marketplace/azure` without Authorization header
  - Returns 401 Unauthorized

- [ ] POST `/api/webhooks/marketplace/azure` with Suspended event
  - Subscription status updated to PAST_DUE
  - MarketplaceEvents row logged

- [ ] POST `/api/webhooks/marketplace/azure` with Unsubscribed event
  - Subscription status updated to CANCELED

- [ ] POST `/api/webhooks/marketplace/azure` with ChangePlan event
  - Tenant tier updated correctly
  - MarketplaceEvents logged

- [ ] Database: Tenants table has marketplace_source, marketplace_subscription_id, marketplace_plan_id columns
- [ ] Database: MarketplaceEvents table exists with proper schema

### AWS Marketplace

- [ ] Landing page `/marketplace/aws/landing?x-amzn-marketplace-token=test_xyz` renders
  - Displays: "Welcome from AWS Marketplace"
  - Shows plan, features, setup button
  - Mock token resolution works

- [ ] POST `/api/webhooks/marketplace/aws/activate` with valid token
  - Tenant created with `marketplace_source='aws_marketplace'`
  - `marketplace_subscription_id` and `marketplace_plan_id` set correctly
  - Returns 200 with redirect URL

- [ ] POST `/api/webhooks/marketplace/aws` with EntitlementCreated event
  - Tenant created automatically (if not already exists)
  - Subscription status set to ACTIVE
  - MarketplaceEvents logged

- [ ] POST `/api/webhooks/marketplace/aws` with EntitlementUpdated event
  - Plan updated correctly
  - MarketplaceEvents logged

- [ ] POST `/api/webhooks/marketplace/aws` with EntitlementDeleted event
  - Subscription status updated to CANCELED

### Admin Billing Page

- [ ] Direct (Paddle) customers: See "Change Plan" section with upgrade button
- [ ] Azure Marketplace customers: See "Subscribed via Azure Marketplace" badge
  - Plan change button disabled
  - Link to Azure Portal provided
  - Subscription ID and Plan ID displayed

- [ ] AWS Marketplace customers: See "Subscribed via AWS Marketplace" badge
  - Plan change button disabled
  - Link to AWS Console provided
  - Subscription ID and Plan ID displayed

### Environment Variables

- [ ] `.env.development` has marketplace variables (even if empty):
  - `AZURE_MARKETPLACE_AAD_TENANT_ID`
  - `AZURE_MARKETPLACE_AAD_APP_ID`
  - `AZURE_MARKETPLACE_AAD_APP_SECRET`
  - `AWS_MARKETPLACE_PRODUCT_CODE`
  - `AWS_MARKETPLACE_ROLE_ARN`
  - `AWS_REGION`

### Documentation

- [ ] `/docs/marketplace-overview.md` — Architecture, billing flows, implementation status
- [ ] `/docs/marketplace-azure.md` — Partner Center setup, testing, deployment
- [ ] `/docs/marketplace-aws.md` — Seller Central setup, testing, deployment
- [ ] `/marketplace/azure/offer-listing.md` — Listing content for Partner Center
- [ ] `/marketplace/azure/technical-config.md` — API integration details
- [ ] `/marketplace/aws/listing.md` — Listing content for Seller Central
- [ ] `/marketplace/aws/technical-config.md` — API integration details

### Tests

- [ ] `npm test -- api-marketplace.test.ts` passes
  - Azure activation creates tenant
  - Azure webhook processes events
  - AWS activation creates tenant
  - AWS webhook processes events
  - MarketplaceEvents table operations work
  - Error cases return correct status codes

---

## 34. Smoke checks finales

Antes de hacer push a staging:

```bash
cd /Users/manuelchavez/Documents/FinOpsProyect

# 1. Todo verde
npm test && npm run typecheck && npm run lint && echo "✅ ALL GREEN"

# 2. Build local
npm run build 2>&1 | tail -20

# 3. Server arranca
npm run dev &
sleep 8

# 4. Endpoints públicos
curl -fsS http://localhost:3000/api/mcp | jq .name                    # → "finops-saas-mcp"
curl -fsS http://localhost:3000/api/fx/rates | jq '.rates.USD'        # → "1"
curl -fsS http://localhost:3000/api/templates/powerbi | jq '.count'   # → 4
curl -fsS http://localhost:3000/api/auth/sso/me | jq                  # → {"authenticated":false}
curl -fsS http://localhost:3000/api/status | jq .status               # → "operational"
curl -fsS http://localhost:3000/api/v1/openapi.json | jq .openapi     # → "3.1.0"

# 5. Pages renderean (200)
for p in / overview/sustainability intelligence/billing admin/billing admin/notifications admin/sso admin/mcp-keys admin/pricing-units admin/powerbi-templates admin/api-keys admin/audit status; do
  echo "/$p → $(curl -o /dev/null -s -w '%{http_code}' http://localhost:3000/es/$p)"
done
```

- [ ] Build pasa sin errores.
- [ ] Todos los curls públicos responden esperado.
- [ ] Todas las pages devuelven `200` (o `307` si redirect login OK).
- [ ] Logs del server sin errores rojos.

Si todo lo de arriba está marcado → **listo para `git push staging`**.

---

## Mantenimiento del checklist

Cada vez que se agregue feature nueva:
1. Añadir sección numerada antes de "Smoke checks finales".
2. Actualizar el índice.
3. Incluir: ruta, tier, UI checks, API positiva, API negativa, links a docs.
4. Si la feature tiene tests, sumarlos al smoke check final.
