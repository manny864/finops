# 📘 Handoff Integral de la Plataforma FinOps — 2026-08-23

**Documento Maestro de Traspaso y Estado del Repositorio**  
*Autocontenido y exhaustivo para retomar el desarrollo, auditoría o despliegue desde cualquier máquina o sesión.*

---

## 📌 1. Información General del Entorno y Estado Operativo

- **Repositorio:** `github.com/manny864/finops`
- **Rama Actual:** `main` (alineada con `staging`)
- **Producción URL:** `https://finops.cscloudsolutions.com.ar` (Cloudflare WAF/CDN + Azure Container Apps en `westus2`)
- **Health Check:** `GET /api/health` ➔ `HTTP 200 { "status": "healthy", "timestamp": "..." }`
- **Arquitectura de Base de Datos:** Azure Database for MySQL Flexible Server (MySQL 8.0, InnoDB, TLS 1.2, `utf8mb4_unicode_ci`)
- **Caché y Mensajería:** Azure Managed Redis (Balanced B3, HA, TLS 1.2)
- **Almacenamiento de Archivos:** Azure Blob Storage (`reports-pdf`, `reports-json`, `logos`, `support-attachments`)
- **Control de Acceso:** Microsoft Entra ID (MSAL JWT) + WorkOS (Enterprise SAML/OIDC SSO) + RBAC por Tenant (`Professional`, `Business`, `Enterprise`) + SuperAdmin System Role.

---

## 🚀 2. Detalle de Todos los Módulos y Cambios Recientes

### 1. 🗄️ Esquema Consolidado DDL MySQL 8.0 y Catálogos de Semillas
- **Archivo DDL:** [`migrations/20260823-003-consolidated-platform-schema.sql`](../migrations/20260823-003-consolidated-platform-schema.sql)
- **Estructura Idempotente (`CREATE TABLE IF NOT EXISTS`, `ON DUPLICATE KEY UPDATE`):**
  - **Dominio Core & Tenants:**
    - `Tenants`: Identidad central, tiers (`Professional`, `Business`, `Enterprise`), flags de activación.
    - `TenantSubscriptions`: Gating contractual de cuotas (`max_allowed_subscriptions [2, 3, 999]`), estados (`ACTIVE`, `TRIAL`, `PAST_DUE`, `CANCELED`), bypass manual e ID Paddle.
    - `TenantCommercialDeals`: Vendedor asignado, porcentaje de comisión comercial y notas privadas SuperAdmin.
    - `TenantGlobalSettings`: Preferencias de tema (`LIGHT`, `DARK`, `SYSTEM`), logo corporativo y nombre comercial.
  - **Dominio Configuración e Integraciones:**
    - `TenantIntegrations`: Webhooks proactivos, conectores ITSM (`JIRA`, `AZURE_DEVOPS`, `SERVICENOW`) y exportación a Power BI.
    - `TenantAiSettings`: Router de IA por tenant (`AZURE_OPENAI`, `OPENAI_DIRECT`, `ANTHROPIC_CLAUDE`, `GOOGLE_VERTEX`), sensibilidad de anomalías y políticas de privacidad de tags/recursos.
    - `NotificationChannels`: Canales de alerta (`SLACK`, `TEAMS`, `EMAIL`, `WEBHOOK`) con filtrado por severidad (`ALL`, `MEDIUM_AND_ABOVE`, `HIGH_AND_ABOVE`, `CRITICAL_ONLY`).
    - `TenantM365CopilotSettings`: Conector Graph e indexación de telemetría M365 Copilot.
    - `TenantMcpApiKeys` & `TenantPublicApiKeys`: Llaves de integración con hash SHA-256, scopes y rate limits.
  - **Dominio Reportes y Facturación:**
    - `ExecutiveReportJobs`: Orquestación asíncrona de generación de reportes ejecutivos con seguimiento de progreso (0–100%).
    - `ExecutiveReportHistory`: Catálogo de reportes compilados (PDF y JSON) con políticas de ciclo de vida.
    - `TenantMarkupSettings` & `MarkupOverrideRules`: Márgenes CSP globales y reglas de sobreescritura por suscripción o servicio.
    - `TenantFocusSchedule`: Exportación periódica estandarizada FOCUS 1.0 / 1.1 hacia Azure Blob o Email.
  - **Dominio Operaciones, SuperAdmin y Auditoría:**
    - `Notifications` & `TenantNotifications`: Centro de notificaciones in-app.
    - `AuditTrailLogs`: Trazabilidad inmutable de eventos con metadata JSON (`isImpersonated`, `user_email`, `ip_address`).
    - `SaaSCronJobs`: Estado, última ejecución y duraciones de los 9 cron jobs de la plataforma.
    - `SaaSComponentHealth`: Monitor de salud de componentes de infraestructura (MySQL, Redis, ARM, Blob, OpenAI, SMTP).
    - `TenantPartnerCenterAssociations`: Vinculaciones PAL y CPOR con reintentos automáticos.
    - `BillingPricingUnitsCatalog` & `PricingUnits`: 45 unidades de medida oficiales del FinOps Toolkit.
    - `SaaSLoadTestHistory`: Registro histórico de pruebas de estrés y concurrencia.
    - `PlatformGlobalAiConfig`: Router maestro para modelos Enterprise (`gpt-4o`) y no-Enterprise (`gpt-4o-mini`).

---

### 2. 🧹 Motor Desatendido de Purga y Retención por Tier (`storage-retention-cleanup`)
- **Archivos:**
  - Servicio: [`src/services/storageRetentionCleaner.service.ts`](../src/services/storageRetentionCleaner.service.ts)
  - Endpoint Cron: [`src/app/api/cron/storage-retention-cleanup/route.ts`](../src/app/api/cron/storage-retention-cleanup/route.ts)
  - Migración: [`migrations/20260823-001-storage-retention-cleanup.sql`](../migrations/20260823-001-storage-retention-cleanup.sql)
  - Suite de Tests: [`__tests__/unit/storageRetentionCleanerService.test.ts`](../__tests__/unit/storageRetentionCleanerService.test.ts)
- **Reglas Oficiales de Retención de Reportes:**
  - **Professional:** 90 días de retención.
  - **Business:** 180 días de retención.
  - **Enterprise:** 365 días de retención.
- **Mecanismo de Purga:**
  1. Identifica reportes generados con antigüedad superior a la ventana del tier (`createdAtIso < cutoffDate`).
  2. Elimina físicamente los blobs PDF y JSON en Azure Storage Containers.
  3. Ejecuta soft delete en base de datos (`UPDATE ExecutiveReportJobs SET deleted_at = NOW()`).
  4. Genera registro de auditoría en `AuditTrailLogs` y actualiza la tabla de estado `SaaSCronJobs`.

---

### 3. 🛡️ Motor de Impersonación de Sesión SuperAdmin (God Mode Delegado)
- **Archivos:**
  - Servicio de Sesión: [`src/services/sessionImpersonation.service.ts`](../src/services/sessionImpersonation.service.ts)
  - Componente UI: [`src/components/superadmin/ImpersonationBanner.tsx`](../src/components/superadmin/ImpersonationBanner.tsx)
  - Inyección Global: [`src/app/[locale]/layout.tsx`](../src/app/[locale]/layout.tsx)
  - Panel SuperAdmin: [`src/components/superadmin/TenantManagementPanel.tsx`](../src/components/superadmin/TenantManagementPanel.tsx)
  - Suite de Tests: [`__tests__/unit/sessionImpersonationService.test.ts`](../__tests__/unit/sessionImpersonationService.test.ts)
- **Características de Seguridad:**
  - **Cookie Segura:** Cookie HTTP-only cifrada `saas_impersonation_session` con validez de 4 horas (`maxAge: 14400`).
  - **Barra Flotante Global:** Barra fija superior en `z-[90]` que muestra el tenant activo impersonado, el email del SuperAdmin y el botón *"Salir de Impersonación"* con redirección a `/superadmin/tenants`.
  - **Auditoría Inmutable:** Cada operación ejecutada durante la sesión delegada se marca con `isImpersonated: true` y `executedBySuperAdmin` en `AuditTrailLogs`.

---

### 4. 🔔 Centro Global de Notificaciones y Control de Cuotas
- **Archivos:**
  - Componente Navbar: [`src/components/layout/NotificationBellDropdown.tsx`](../src/components/layout/NotificationBellDropdown.tsx)
  - Servicio Backend: [`src/services/tenantNotifications.service.ts`](../src/services/tenantNotifications.service.ts)
  - Hook React: [`src/hooks/useTenantNotifications.ts`](../src/hooks/useTenantNotifications.ts)
  - API Route: [`src/app/api/notifications/route.ts`](../src/app/api/notifications/route.ts)
  - Modal Upgrade: [`src/components/subscription/UpgradeModal.tsx`](../src/components/subscription/UpgradeModal.tsx)
  - Hook de Límites: [`src/hooks/useTenantPlanLimits.ts`](../src/hooks/useTenantPlanLimits.ts)
  - Suite de Tests: [`__tests__/unit/tenantNotificationsService.test.ts`](../__tests__/unit/tenantNotificationsService.test.ts)
- **Funcionalidad:**
  - **Campanita en el Header:** Ícono Tabler `IconBell` con badge azul `#0078D4` indicando el número de alertas no leídas.
  - **Dropdown Interactivo:** Pestañas de filtrado (*Todas*, *No Leídas*, *Info*, *Advertencias*, *Críticas*), botón *"Marcar todas como leídas"* y deep-links directos a los recursos afectados.
  - **Enforzamiento de Suscripciones Azure:** Professional (hasta 2), Business (hasta 3), Enterprise (ilimitadas). Si el tenant intenta vincular una suscripción adicional, se despliega automáticamente el `UpgradeModal` con pasarela Paddle B2B.

---

### 5. 🗑️ Módulos de Limpieza y Gobernanza Cloud (Cleanup & Governance)
- **Orphan Backups & Snapshots:** [`src/services/azureOrphanBackups.service.ts`](../src/services/azureOrphanBackups.service.ts), [`src/app/api/cleanup/backup-orphans/route.ts`](../src/app/api/cleanup/backup-orphans/route.ts), [`src/components/cleanup/OrphanBackupsPanel.tsx`](../src/components/cleanup/OrphanBackupsPanel.tsx), [`src/app/[locale]/cleanup/backup-orphans/page.tsx`](../src/app/[locale]/cleanup/backup-orphans/page.tsx).
  - Detección de snapshots de disco y puntos de restauración huérfanos sin VM asociada.
- **TTL Enforcement (Time-to-Live):** [`src/services/azureTtlEnforcement.service.ts`](../src/services/azureTtlEnforcement.service.ts), [`src/app/api/cleanup/ttl/route.ts`](../src/app/api/cleanup/ttl/route.ts), [`src/components/cleanup/TtlEnforcementPanel.tsx`](../src/components/cleanup/TtlEnforcementPanel.tsx), [`src/app/[locale]/cleanup/ttl/page.tsx`](../src/app/[locale]/cleanup/ttl/page.tsx).
  - Políticas de expiración automática de recursos basadas en etiquetas FinOps (`ttl`, `expire-on`).

---

## 📚 3. Documentación Sincronizada y Compilada (`/actualiza-docu`)

| Documento | Ubicación | Estado |
| :--- | :--- | :---: |
| **LLD Arquitectura** | [`docs/lld/00-lld-completo.md`](lld/00-lld-completo.md) | Sincronizado con tablas, crons, cuotas e impersonación ✅ |
| **LLD en PDF** | [`docs/lld/LLD-FinOps-CSCloudSolutions.pdf`](lld/LLD-FinOps-CSCloudSolutions.pdf) | Compilado (5.5 MB) con diagramas Mermaid SVG ✅ |
| **HLD Arquitectura** | [`docs/hld/00-hld-completo.md`](hld/00-hld-completo.md) | Actualizada matriz de tiers y retención de blobs ✅ |
| **Manual de Usuario** | [`MANUAL_DE_USUARIO.md`](../MANUAL_DE_USUARIO.md) | Añadida §3.8 Notificaciones y Cuotas, §3.9 Tiers ✅ |
| **Manuales Usuario Multi-Idioma** | [`docs/manual/MANUAL_USUARIO_{ES,EN,PT-BR}.md`](manual/) | Actualizadas secciones §8.4.1 y §8.5.1 en ES, EN, PT-BR ✅ |
| **Manuales SuperAdmin Multi-Idioma** | [`docs/manual/MANUAL_SUPERADMIN_{ES,EN,PT-BR}.md`](manual/) | Añadido Paso 5 sobre Impersonación Segura en ES, EN, PT-BR ✅ |
| **Manuales en PDF (6 archivos)** | [`docs/manual/`](manual/) y [`public/manual/`](../public/manual/) | Compilados con Playwright en los 3 idiomas ✅ |

---

## 🧪 4. Resumen de Calidad, Tests y CI/CD

```
================================================================================
ESTADO DE PRUEBAS Y COMPILACIÓN LOCAL
================================================================================
TypeScript Typecheck (npm run typecheck):   PASSED (0 errores)
ESLint (npm run lint -- --quiet):          PASSED (0 errores, 3025 warnings de tipo)
Vitest Unit Suite (npm run test):           PASSED (1706 tests passing, 0 fallos)

================================================================================
ESTADO DE PIPELINES EN GITHUB ACTIONS
================================================================================
Workflow 'CI' (rama staging):              SUCCESS ✅ (Run 32648821645)
Workflow 'deploy' (rama main):             SUCCESS ✅ (Run 32648826256)
 - Build & Push Docker Image:              SUCCESS
 - Container App Job Migraciones:          SUCCESS
 - Deploy App Runtime Revision:            SUCCESS
 - Deploy 14 Scheduled Cron Jobs:          SUCCESS
 - Health Check (HTTP 200):                SUCCESS
```

---

## 💻 5. Historial de Commits del Ciclo

1. **`961fc86`** — `feat(db): generate consolidated MySQL 8.0 DDL platform schema migration and seed catalogs`
2. **`56dad4d`** — `fix(notifications): avoid mutating activeTenantRef during render in useTenantNotifications`
3. **`3648a2f`** — `fix(i18n): add commercialUpdated key to es, en, pt-BR and update cron count in operations test`
4. **`bd332ed`** — `fix(migrations): use standard MySQL 8.0 ALTER TABLE ADD COLUMN syntax`
5. **`d9ec769`** — `fix(db): unify SaaSCronJobs schema and seed with storage retention cleaner`
6. **`c9e177a`** — `docs: synchronize LLD, HLD, user/superadmin manuals (ES, EN, PT-BR), and compiled PDFs`
7. **`59db64d`** — `docs: add durable platform and documentation handoff record`

---

## 🚀 6. Guía Rápida para la Próxima Sesión

```bash
# 1. Verificar estado del árbol de trabajo
git status

# 2. Si se desea publicar los commits de documentación pendientes a remoto:
git push origin main:staging
git push origin main:main

# 3. Validar estado de la aplicación
curl -s https://finops.cscloudsolutions.com.ar/api/health
```
