# Inventario de rutas API (generado)

> Generado por `scripts/generate-lld.mjs`. No editar a mano.

Total: **422** rutas.

La columna *Guard* es el guard de `src/lib/requestAuth.ts` presente en el archivo.
`_CRON_SECRET_` = no usa guard de tenant; autentica con el header `Authorization: Bearer $CRON_SECRET`.
`—` = ningún mecanismo de los anteriores: revisar caso por caso (ver más abajo).

| Endpoint | Métodos | Guard | Tier | Mock-aware |
|---|---|---|---|---|
| `/api/academy/content` | GET, POST | requireTenantRole, requireTenantAccess | — | sí |
| `/api/admin/audit` | GET | requireTenantAccess | — | sí |
| `/api/admin/audit-trail` | GET | requireTenantRole | — | sí |
| `/api/admin/audit-trail/export` | GET | requireTenantRole | — | sí |
| `/api/admin/audit/export` | GET | requireTenantRole | — | sí |
| `/api/admin/azure-policies` | GET | requireTenantAccess | — | sí |
| `/api/admin/billing` | GET | requireTenantRole | — | sí |
| `/api/admin/billing-markup` | GET, POST | requireTenantAccess | — | sí |
| `/api/admin/billing/cancel-subscription` | POST | requireTenantRole | — | sí |
| `/api/admin/billing/customer-portal` | GET, POST | requireTenantRole | — | sí |
| `/api/admin/check-sp-roles` | GET | requireTenantAccess, requireRequestIdentity | — | — |
| `/api/admin/compliance/request-soc2` | POST | requireTenantRole | — | — |
| `/api/admin/config/account-status` | GET | requireTenantAccess | — | sí |
| `/api/admin/config/account-status/sync-now` | POST | requireTenantRole | — | sí |
| `/api/admin/config/ai` | GET, PATCH | requireTenantRole | — | — |
| `/api/admin/config/ai-global` | GET, PATCH | requireSuperAdmin | — | — |
| `/api/admin/config/ai-global/test` | POST | requireSuperAdmin | — | — |
| `/api/admin/config/ai/test` | POST | requireTenantRole | — | — |
| `/api/admin/config/general` | GET, PUT | requireTenantRole, requireTenantAccess | — | sí |
| `/api/admin/config/integrations/test-itsm` | POST | requireTenantRole | — | sí |
| `/api/admin/config/integrations/test-webhook` | POST | requireTenantRole, requireTenantAccess | — | sí |
| `/api/admin/config/markup` | GET, PUT | requireTenantRole | — | sí |
| `/api/admin/config/markup/rules` | POST, PUT, PATCH, DELETE | requireTenantRole | — | sí |
| `/api/admin/config/markup/simulate` | GET, POST | — | — | — |
| `/api/admin/config/users` | GET, POST, PUT, DELETE | requireSuperAdmin, requireTenantAccess | — | sí |
| `/api/admin/config/users/entra-sync` | GET | requireTenantRole, requireRequestIdentity | — | — |
| `/api/admin/config/webhook` | GET, POST | requireTenantAccess | — | — |
| `/api/admin/configuration/markup` | — | — | — | — |
| `/api/admin/configuration/markup/simulate` | — | — | — | — |
| `/api/admin/data-residency` | GET, PUT | requireTenantRole, requireTenantAccess | — | — |
| `/api/admin/data-residency/lock` | POST | requireSuperAdmin | — | — |
| `/api/admin/data-residency/unlock` | POST | requireSuperAdmin | — | — |
| `/api/admin/focus-export/schedule` | GET, PATCH | requireTenantRole, requireTenantTier | Enterprise | — |
| `/api/admin/governance-policies` | GET, POST | requireTenantRole, requireTenantAccess | — | sí |
| `/api/admin/integrations/mcp-keys` | — | — | — | — |
| `/api/admin/load-test/run` | POST | requireSuperAdmin | — | — |
| `/api/admin/load-test/runs` | GET | requireSuperAdmin | — | — |
| `/api/admin/mcp-keys` | GET, POST, DELETE | requireTenantRole, requireTenantTier | Business | sí |
| `/api/admin/migrations/run` | POST | requireSuperAdmin | — | — |
| `/api/admin/migrations/status` | GET | requireSuperAdmin | — | — |
| `/api/admin/notifications/channels` | GET, POST, PATCH | requireTenantRole, requireTenantAccess | — | — |
| `/api/admin/notifications/channels/[id]` | PUT, DELETE | requireTenantRole | — | — |
| `/api/admin/notifications/channels/[id]/test` | POST | requireTenantRole | — | — |
| `/api/admin/onboarding` | POST | requireTenantAccess | — | — |
| `/api/admin/payments` | GET, POST | requireSuperAdmin | — | — |
| `/api/admin/pricing-units` | GET, POST | requireSuperAdmin | — | — |
| `/api/admin/public-api-keys` | GET, POST | requireTenantRole, requireTenantTier | Business | sí |
| `/api/admin/public-api-keys/[id]` | PUT, DELETE | requireTenantRole, requireTenantTier | Business | sí |
| `/api/admin/report/invoicing` | GET | requireTenantRole | — | sí |
| `/api/admin/report/invoicing/email` | POST | requireTenantRole | — | — |
| `/api/admin/sso` | GET, PUT | requireTenantRole | — | sí |
| `/api/admin/sso/portal-link` | POST | requireTenantRole | — | — |
| `/api/admin/sso/test` | POST | requireTenantRole | — | sí |
| `/api/admin/support/tickets` | GET, PATCH | requireSuperAdmin | — | — |
| `/api/admin/system-alerts` | GET | requireSuperAdmin | — | — |
| `/api/admin/system-alerts/[id]/ack` | POST | requireSuperAdmin | — | — |
| `/api/admin/tenant-settings` | GET, PUT | requireTenantRole, requireTenantAccess | — | — |
| `/api/admin/tenants` | POST, PATCH | requireSuperAdmin | — | — |
| `/api/admin/tenants/delete` | POST, DELETE | requireSuperAdmin | — | — |
| `/api/admin/tenants/logo` | POST, DELETE | requireTenantRole | — | — |
| `/api/admin/tenants/paddle-checkout-link` | POST | requireSuperAdmin | — | — |
| `/api/admin/users/search-entra` | GET | requireTenantRole | — | sí |
| `/api/admin/users/sync-group` | GET, POST | requireTenantRole | — | sí |
| `/api/admin/workbooks` | POST | requireTenantRole, requireRequestIdentity | — | — |
| `/api/advisor` | GET, POST | requireTenantRole, requireTenantAccess | — | sí |
| `/api/advisor/suppress` | POST, DELETE | requireTenantRole | — | — |
| `/api/advisor/suppressions` | GET | requireTenantAccess | — | — |
| `/api/analytics/allocation` | GET, POST, DELETE | requireTenantRole, requireTenantAccess | — | sí |
| `/api/analytics/anomalies` | GET, PATCH | requireTenantAccess | — | sí |
| `/api/analytics/macc` | GET, POST | requireTenantAccess | — | sí |
| `/api/analytics/scorecard` | GET | requireTenantAccess | — | sí |
| `/api/analytics/self-service-alerts` | GET, POST, DELETE | requireTenantRole, requireTenantAccess | — | sí |
| `/api/analytics/self-service-alerts/test` | POST | requireTenantAccess | — | sí |
| `/api/analytics/simulator` | GET, POST | requireTenantAccess | — | sí |
| `/api/analytics/tenant-health` | GET | requireTenantAccess | — | sí |
| `/api/audit/full` | GET | requireTenantAccess | — | — |
| `/api/audit/ttl` | GET | requireTenantAccess | — | — |
| `/api/auth/sso/callback` | GET | — | — | — |
| `/api/auth/sso/logout` | POST | — | — | — |
| `/api/auth/sso/me` | GET | — | — | — |
| `/api/auth/sso/start` | GET | — | — | — |
| `/api/automation/kill-switch` | POST | requireTenantAccess | — | — |
| `/api/billing` | GET, POST | requireTenantRole | — | — |
| `/api/billing/invoices` | GET | requireTenantRole | — | — |
| `/api/billing/plan` | GET | requireTenantRole | — | — |
| `/api/billing/portal` | GET | requireTenantRole | — | — |
| `/api/billing/subscription` | PATCH, DELETE | requireTenantRole | — | — |
| `/api/billing/subscription/preview` | POST | requireTenantRole | — | — |
| `/api/budgets` | GET, POST, PUT, DELETE | requireTenantRole, requireTenantAccess | — | — |
| `/api/budgets/alerts` | GET, POST | requireTenantRole, requireTenantAccess | — | sí |
| `/api/budgets/alerts/[id]` | DELETE | requireTenantRole | — | sí |
| `/api/budgets/alerts/[id]/test` | POST | requireTenantRole | — | sí |
| `/api/budgets/burn` | GET | requireTenantAccess | — | sí |
| `/api/budgets/create` | POST | requireTenantRole | — | — |
| `/api/budgets/delete` | POST | requireTenantRole | — | — |
| `/api/budgets/monthly-history` | GET | requireTenantAccess | — | sí |
| `/api/checkout` | POST | requireTenantAccess | — | — |
| `/api/cleanup/backup-orphans` | GET, POST | requireTenantRole, requireTenantTier, requireTenantAccess | Professional | sí |
| `/api/cleanup/networking-zombies` | — | — | — | — |
| `/api/cleanup/orphan-backups` | — | — | — | — |
| `/api/cleanup/ttl` | GET, POST | requireTenantRole, requireTenantTier, requireTenantAccess | Business | sí |
| `/api/cleanup/ttl/history` | GET | requireTenantAccess | — | sí |
| `/api/cleanup/ttl/policies` | GET, POST, DELETE | requireTenantRole, requireTenantTier, requireTenantAccess | Business | sí |
| `/api/cleanup/ttl/unlabeled` | GET | requireTenantAccess | — | sí |
| `/api/cleanup/zombies` | GET, POST | requireTenantRole, requireTenantAccess | — | sí |
| `/api/cleanup/zombies/networking` | GET, POST | requireTenantRole, requireTenantTier, requireTenantAccess | Professional | sí |
| `/api/consumption` | GET | requireTenantAccess | — | — |
| `/api/copilot-m365/ask` | POST | requireTenantAccess | — | sí |
| `/api/copilot-m365/config` | GET, POST, DELETE | requireTenantRole, requireTenantTier | Enterprise | sí |
| `/api/cost-groups` | GET, POST | requireTenantRole, requireTenantTier | Business | sí |
| `/api/cost-groups/[name]` | GET, PATCH, DELETE | requireTenantRole, requireTenantTier | Business | sí |
| `/api/cost-groups/[name]/resource-groups` | GET, POST, DELETE | requireTenantRole, requireTenantTier, requireTenantAccess | Business | sí |
| `/api/cron/anomaly-detection` | GET | _CRON_SECRET_ | — | — |
| `/api/cron/cost-exports-sync` | GET | _CRON_SECRET_ | — | sí |
| `/api/cron/cost-sync-staleness-check` | GET | _CRON_SECRET_ | — | — |
| `/api/cron/credential-expiry-alerts` | GET | _CRON_SECRET_ | — | — |
| `/api/cron/focus-export-daily` | GET | _CRON_SECRET_ | — | — |
| `/api/cron/historical-gap-backfill` | GET, POST | _CRON_SECRET_ | — | — |
| `/api/cron/invalidate-ai-cache` | POST | requireSuperAdmin | — | — |
| `/api/cron/open-data` | GET, POST | _CRON_SECRET_ | — | — |
| `/api/cron/partner-link-retry` | GET | _CRON_SECRET_ | — | — |
| `/api/cron/power-schedules` | GET, POST | _CRON_SECRET_ | — | — |
| `/api/cron/prewarm-compute` | GET, POST | _CRON_SECRET_ | — | — |
| `/api/cron/prewarm-cosmos-finops` | GET, POST | _CRON_SECRET_ | — | — |
| `/api/cron/prewarm-dashboard` | GET, POST | _CRON_SECRET_ | — | — |
| `/api/cron/prewarm-databases` | GET, POST | _CRON_SECRET_ | — | — |
| `/api/cron/prewarm-mongo-finops` | GET, POST | _CRON_SECRET_ | — | — |
| `/api/cron/prewarm-mysql-finops` | GET, POST | _CRON_SECRET_ | — | — |
| `/api/cron/prewarm-postgres-finops` | GET, POST | _CRON_SECRET_ | — | — |
| `/api/cron/prewarm-security-finops` | GET, POST | _CRON_SECRET_ | — | — |
| `/api/cron/prewarm-sql-finops` | GET, POST | _CRON_SECRET_ | — | — |
| `/api/cron/prewarm-storage-finops` | GET, POST | _CRON_SECRET_ | — | — |
| `/api/cron/status-snapshot` | GET | _CRON_SECRET_ | — | — |
| `/api/cron/subscription-expiry` | GET | _CRON_SECRET_ | — | — |
| `/api/cron/support-attachments-cleanup` | GET | _CRON_SECRET_ | — | — |
| `/api/cron/sync` | GET, POST | _CRON_SECRET_ | — | — |
| `/api/cron/sync-aml` | POST | _CRON_SECRET_ | — | — |
| `/api/cron/sync-azure-ai` | GET | _CRON_SECRET_ | — | — |
| `/api/cron/sync-azure-search` | POST | _CRON_SECRET_ | — | — |
| `/api/cron/sync-content-safety` | POST | _CRON_SECRET_ | — | — |
| `/api/cron/sync-databricks` | POST | _CRON_SECRET_ | — | — |
| `/api/cron/sync-doc-intel` | POST | _CRON_SECRET_ | — | — |
| `/api/cron/sync-foundry` | GET | _CRON_SECRET_ | — | — |
| `/api/cron/sync-speech-language` | POST | _CRON_SECRET_ | — | — |
| `/api/cron/sync-vision-video` | POST | _CRON_SECRET_ | — | — |
| `/api/cron/trial-expiry` | GET | _CRON_SECRET_ | — | — |
| `/api/cron/ttl-expiry-alerts` | GET | _CRON_SECRET_ | — | — |
| `/api/dashboard/pins` | GET, POST, PATCH, DELETE | requireTenantAccess | — | — |
| `/api/dashboard/summary` | GET | requireTenantAccess | — | sí |
| `/api/exports/focus` | GET | requireTenantRole, requireTenantTier | Enterprise | — |
| `/api/exports/powerbi-feed` | GET | — | — | — |
| `/api/fx/preference` | GET, POST | requireTenantAccess | — | — |
| `/api/fx/rates` | GET, POST | requireSuperAdmin | — | — |
| `/api/governance/advisor` | — | — | — | — |
| `/api/governance/approvals` | GET, POST | requireTenantRole, requireTenantTier | Business | sí |
| `/api/governance/auto-block` | GET | requireTenantTier | Enterprise | sí |
| `/api/governance/auto-block/deploy` | POST, DELETE | requireTenantRole, requireTenantTier | Enterprise | sí |
| `/api/governance/auto-block/remediate` | POST | requireTenantRole, requireTenantTier | Enterprise | sí |
| `/api/governance/credentials/rotate` | POST | requireTenantRole, requireTenantTier | Business | sí |
| `/api/governance/expiring-credentials` | GET, POST, PATCH, DELETE | requireTenantRole, requireTenantTier | Business | sí |
| `/api/governance/ha` | GET, POST | requireTenantRole, requireTenantTier | Business | sí |
| `/api/governance/policies` | GET, POST, PUT, DELETE | requireTenantAccess | — | — |
| `/api/governance/power-management` | GET | requireTenantTier, requireTenantAccess | Business | sí |
| `/api/governance/reporting` | GET | requireTenantTier | Enterprise | sí |
| `/api/governance/tags` | GET, POST | requireTenantAccess | — | sí |
| `/api/governance/tags/apply-inheritance` | POST | requireTenantRole, requireTenantTier | Business | — |
| `/api/governance/tags/inherit-rg` | POST | requireTenantAccess | — | sí |
| `/api/governance/tags/inheritance-preview` | GET | requireTenantAccess | — | — |
| `/api/governance/tags/suggest` | POST | requireTenantAccess | — | sí |
| `/api/health` | GET | — | — | — |
| `/api/history` | GET | requireTenantAccess | — | sí |
| `/api/integrations/itsm` | POST | requireTenantAccess | — | — |
| `/api/intelligence/ai-analytics` | GET | requireSuperAdmin, requireTenantAccess | — | sí |
| `/api/intelligence/ai-analytics/diagnostics` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/ai-report` | POST | requireTenantAccess | — | — |
| `/api/intelligence/aks` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/aks-chargeback` | GET | requireTenantTier, requireTenantAccess | Business | sí |
| `/api/intelligence/allocation-rules` | GET, POST | requireTenantRole, requireTenantAccess | — | sí |
| `/api/intelligence/anomalies` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/app-insights` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/applied-savings` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/assessment` | POST | requireTenantAccess | — | — |
| `/api/intelligence/azure-ai` | GET, POST | requireTenantAccess | — | sí |
| `/api/intelligence/azure-ai/aml` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/azure-ai/content-safety` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/azure-ai/databricks` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/azure-ai/document-intelligence` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/azure-ai/foundry/detail` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/azure-ai/search` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/azure-ai/speech-language` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/azure-ai/summary` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/azure-ai/vision-video` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/azure-monitor` | — | — | — | — |
| `/api/intelligence/billing` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/captured-savings` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/chargeback` | GET | requireTenantRole | — | — |
| `/api/intelligence/commitment-simulator` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/commitments` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/commitments/recommendations` | GET | requireTenantAccess | — | — |
| `/api/intelligence/commitments/reservations/renew` | PATCH | requireTenantRole | — | sí |
| `/api/intelligence/commitments/reservations/utilization` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/compute-cost-per-core` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/compute/service-cost` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/compute/workloads` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/container-apps` | GET | requireTenantTier, requireTenantAccess | Business | sí |
| `/api/intelligence/container-apps/details` | GET | requireTenantTier, requireTenantAccess | Business | sí |
| `/api/intelligence/copilot` | POST | requireTenantTier, requireRequestIdentity | Professional | sí |
| `/api/intelligence/copilot/quota` | GET | requireRequestIdentity | — | sí |
| `/api/intelligence/cosmos-db` | GET | requireTenantTier, requireTenantAccess | Business | sí |
| `/api/intelligence/cost-by-category` | GET | requireTenantAccess | — | — |
| `/api/intelligence/cost-centers` | GET, PUT, DELETE | requireTenantRole, requireTenantTier | Business | sí |
| `/api/intelligence/cost-centers/resources` | GET | requireTenantRole, requireTenantTier | Business | sí |
| `/api/intelligence/cost-projection` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/databases/cosmos-diagnostics` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/databases/cosmos-metrics` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/databases/mongo-diagnostics` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/databases/mongo-metrics` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/databases/mysql-diagnostics` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/databases/mysql-metrics` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/databases/postgres-diagnostics` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/databases/postgres-metrics` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/databases/redis-diagnostics` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/databases/redis-metrics` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/databases/service-cost` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/databases/sql-diagnostics` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/databases/sql-family` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/databases/sql-metrics` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/ddos-protection` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/defender` | GET, PATCH | requireTenantTier | Business | sí |
| `/api/intelligence/defender/details` | GET | requireTenantTier | Business | sí |
| `/api/intelligence/entra-id` | GET | requireTenantTier, requireTenantAccess | Business | sí |
| `/api/intelligence/executive-report/data` | — | — | — | — |
| `/api/intelligence/executive-report/export-pdf` | — | — | — | — |
| `/api/intelligence/executive-report/history` | — | — | — | — |
| `/api/intelligence/executive-report/history/[id]` | — | — | — | — |
| `/api/intelligence/executive-report/jobs` | GET, POST | requireTenantAccess | — | sí |
| `/api/intelligence/executive-report/send-email` | — | — | — | — |
| `/api/intelligence/export/powerbi` | GET | requireTenantRole | — | — |
| `/api/intelligence/financial-leaks` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/forecast` | GET, POST | requireTenantAccess | — | — |
| `/api/intelligence/forecast/by-service` | GET | requireTenantAccess | — | — |
| `/api/intelligence/history` | GET, POST | requireTenantAccess, requireRequestIdentity | — | sí |
| `/api/intelligence/hybrid-benefit` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/integration-services/[service]` | GET | requireTenantTier | Business | sí |
| `/api/intelligence/integration-services/adf` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/integration-services/apim` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/integration-services/event-grid` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/integration-services/event-hubs` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/integration-services/logic-apps` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/integration-services/service-bus` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/kpis/coin` | GET, POST | requireTenantTier, requireTenantAccess | Professional | — |
| `/api/intelligence/licenses` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/log-analytics` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/macc` | GET | requireSuperAdmin, requireTenantAccess | — | sí |
| `/api/intelligence/maturity` | GET, POST | requireTenantAccess | — | sí |
| `/api/intelligence/microsoft-fabric` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/misc-services` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/monitoring/action-groups` | GET, POST | requireTenantTier | Business | sí |
| `/api/intelligence/monitoring/alerts` | GET, POST | requireTenantTier | Business | sí |
| `/api/intelligence/monitoring/azure-monitor` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/monitoring/network-watcher` | GET | requireTenantTier | Business | sí |
| `/api/intelligence/monitoring/sentinel` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/monitoring/service-cost` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/monitoring/workbooks` | GET | requireTenantTier | Business | sí |
| `/api/intelligence/network` | GET | requireTenantAccess, requireRequestIdentity | — | — |
| `/api/intelligence/network-perimeter` | — | — | — | — |
| `/api/intelligence/network/analytics` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/network/basic` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/network/hybrid` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/network/internet` | — | — | — | — |
| `/api/intelligence/network/internet-access` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/network/load-balancing` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/network/loadbalancer` | — | — | — | — |
| `/api/intelligence/network/service-cost` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/network/service-cost-v2` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/rates` | GET | requireTenantAccess | — | — |
| `/api/intelligence/rightsizing` | GET | requireTenantRole | — | — |
| `/api/intelligence/rightsizing/exemptions` | GET, POST, DELETE | requireTenantRole | — | — |
| `/api/intelligence/scorecard` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/security/entra-id` | GET | requireTenantTier | Business | sí |
| `/api/intelligence/security/key-vault` | GET | requireTenantTier | Business | sí |
| `/api/intelligence/security/service-cost` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/seguridad/sentinel` | — | — | — | — |
| `/api/intelligence/sentinel` | — | — | — | — |
| `/api/intelligence/simulator` | GET, POST | requireTenantTier, requireTenantAccess | Business | sí |
| `/api/intelligence/simulator/compare` | POST | requireTenantRole, requireTenantTier | Business | sí |
| `/api/intelligence/simulator/scenarios` | GET, POST | requireTenantRole, requireTenantTier | Business | sí |
| `/api/intelligence/simulator/scenarios/[id]` | DELETE | requireTenantRole | — | — |
| `/api/intelligence/storage-efficiency` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/storage-efficiency/history` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/storage/backups` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/storage/data-lake-gen2` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/storage/managed-disks` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/storage/service-cost` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/sustainability` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/tenant-health` | GET | requireTenantTier | Business | sí |
| `/api/intelligence/top-expenses` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/top-spend` | — | — | — | — |
| `/api/intelligence/unit-economics` | GET, POST | requireTenantRole, requireTenantAccess | — | sí |
| `/api/intelligence/upload` | POST | requireRequestIdentity | — | — |
| `/api/intelligence/waf` | GET | requireTenantTier | Business | sí |
| `/api/intelligence/whiteboard` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/zero-cost` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/zombies` | GET | requireTenantAccess | — | sí |
| `/api/intelligence/zombies/exemptions` | GET, POST, DELETE | requireTenantRole | — | — |
| `/api/leads` | POST | — | — | — |
| `/api/leads/demo` | POST | — | — | — |
| `/api/legal/sign` | GET, POST | requireTenantRole | — | — |
| `/api/loadtest/probe` | GET | — | — | — |
| `/api/locations` | GET | requireTenantRole | — | — |
| `/api/m365/overview` | GET | requireTenantTier | Business | sí |
| `/api/m365/user-activity` | GET | requireTenantAccess | — | sí |
| `/api/m365/user-activity/signin-history` | GET | requireTenantAccess | — | sí |
| `/api/mcp` | GET, POST | — | — | — |
| `/api/mfa/audit` | GET | requireRequestIdentity | — | sí |
| `/api/mfa/challenge` | POST | requireRequestIdentity | — | — |
| `/api/mfa/disable` | POST | requireRequestIdentity | — | — |
| `/api/mfa/enroll/start` | POST | requireRequestIdentity | — | — |
| `/api/mfa/enroll/verify` | POST | requireRequestIdentity | — | — |
| `/api/mfa/recovery-codes/regenerate` | POST | requireRequestIdentity | — | — |
| `/api/mfa/status` | GET | requireRequestIdentity | — | — |
| `/api/mfa/verify-challenge` | POST | requireRequestIdentity | — | — |
| `/api/mfa/webauthn/register` | GET, POST, DELETE | requireRequestIdentity | — | — |
| `/api/notifications` | GET | requireTenantAccess | — | sí |
| `/api/onboard` | POST | requireRequestIdentity | — | — |
| `/api/onboard/complete` | POST | requireRequestIdentity | — | — |
| `/api/onboard/lighthouse` | GET, POST | requireTenantRole | — | sí |
| `/api/onboarding/finish` | POST | requireRequestIdentity | — | — |
| `/api/onboarding/progress` | GET, PUT | requireRequestIdentity | — | — |
| `/api/open-data` | GET, POST | requireSuperAdmin | — | — |
| `/api/overview/whiteboard` | GET | requireTenantAccess | — | sí |
| `/api/power` | GET, POST | requireTenantRole, requireTenantAccess | — | sí |
| `/api/power/schedule` | GET, POST, DELETE | requireTenantRole, requireTenantTier | Business | sí |
| `/api/profile` | GET, PATCH | requireRequestIdentity | — | — |
| `/api/profile/avatar` | GET, POST, DELETE | requireRequestIdentity | — | — |
| `/api/recommendations` | GET | requireTenantAccess | — | — |
| `/api/remediation` | POST | requireTenantRole, requireTenantTier, requireTenantAccess | — | sí |
| `/api/remediation/downgrade` | POST | requireTenantRole | — | — |
| `/api/remediation/workflow` | GET, POST, PATCH | requireTenantAccess, requireRequestIdentity | — | — |
| `/api/reports/billing` | GET | requireTenantAccess | — | sí |
| `/api/reports/billing/export/pbids` | GET | requireTenantAccess | — | sí |
| `/api/reports/billing/export/zip` | GET | requireTenantAccess | — | sí |
| `/api/reports/billing/invoice/pdf` | GET | requireTenantAccess | — | sí |
| `/api/reports/billing/map-customer` | POST | requireTenantAccess | — | sí |
| `/api/reports/executive/active-job` | GET | requireTenantAccess | — | sí |
| `/api/reports/executive/data` | GET | requireTenantAccess | — | sí |
| `/api/reports/executive/export-pdf` | POST | requireTenantAccess | — | sí |
| `/api/reports/executive/job-status` | GET | requireTenantAccess | — | sí |
| `/api/reports/executive/latest` | GET | requireTenantAccess | — | sí |
| `/api/reports/executive/send-email` | POST | requireTenantAccess | — | sí |
| `/api/reports/executive/start-job` | POST | requireTenantAccess | — | sí |
| `/api/reports/history` | GET | requireTenantAccess | — | sí |
| `/api/reports/history/[id]` | GET, DELETE | requireTenantAccess | — | sí |
| `/api/reports/history/[id]/download` | GET | requireTenantAccess | — | sí |
| `/api/reports/history/[id]/rehydrate` | GET | requireTenantAccess | — | sí |
| `/api/reports/history/download` | POST | requireTenantAccess | — | sí |
| `/api/resourcegroups` | GET, POST | requireTenantAccess | — | — |
| `/api/resources/costs-by-tag` | GET | requireTenantTier | Professional | sí |
| `/api/resources/created-by` | GET | requireTenantTier | Professional | sí |
| `/api/resources/inventory` | GET | requireTenantTier | Professional | sí |
| `/api/resources/search` | GET | requireTenantTier | Professional | sí |
| `/api/resources/status` | POST | requireTenantRole | — | — |
| `/api/rightsizing/appservice` | GET | requireTenantRole | — | sí |
| `/api/rightsizing/sqldb` | GET | requireTenantRole, requireTenantTier | Business | sí |
| `/api/rightsizing/storage` | GET | requireTenantRole, requireTenantTier | Business | sí |
| `/api/rightsizing/vmss` | GET | requireTenantRole, requireTenantTier | Business | sí |
| `/api/status` | GET | — | — | — |
| `/api/status/incidents` | GET, POST | requireSuperAdmin | — | — |
| `/api/status/incidents/[id]` | PATCH | requireSuperAdmin | — | — |
| `/api/subscriptions` | GET | requireTenantAccess | — | — |
| `/api/superadmin/funnel` | GET | requireSuperAdmin | — | — |
| `/api/superadmin/operations/crons/[cronKey]/trigger` | POST | requireSuperAdmin | — | — |
| `/api/superadmin/operations/health` | GET | requireSuperAdmin | — | — |
| `/api/superadmin/operations/notify-admins` | POST | requireSuperAdmin | — | — |
| `/api/superadmin/ops` | GET, POST | requireSuperAdmin | — | — |
| `/api/superadmin/partner-alerts` | GET | requireSuperAdmin | — | — |
| `/api/superadmin/partner-center/configure-mpn` | POST | requireSuperAdmin | — | — |
| `/api/superadmin/partner-center/relink` | POST | requireSuperAdmin | — | — |
| `/api/superadmin/partner-center/status` | GET | requireSuperAdmin | — | — |
| `/api/superadmin/pricing-units` | GET, POST | requireSuperAdmin | — | — |
| `/api/superadmin/pricing-units/reseed` | POST | requireSuperAdmin | — | — |
| `/api/superadmin/pricing-units/test` | POST | requireSuperAdmin | — | — |
| `/api/superadmin/signup-funnel` | GET | requireSuperAdmin | — | — |
| `/api/superadmin/tenants` | GET | requireSuperAdmin | — | sí |
| `/api/superadmin/tenants/[tenantId]/update-commercial` | PUT | requireSuperAdmin | — | — |
| `/api/superadmin/tenants/[tenantId]/update-tier` | PUT | requireSuperAdmin | — | — |
| `/api/superadmin/tenants/create` | POST | requireSuperAdmin | — | — |
| `/api/superadmin/tenants/create-manual` | POST | requireSuperAdmin | — | — |
| `/api/superadmin/tenants/extend-trial` | POST | requireSuperAdmin | — | — |
| `/api/superadmin/tenants/paddle/generate-checkout-link` | POST | requireSuperAdmin | — | — |
| `/api/superadmin/users` | GET | requireSuperAdmin | — | — |
| `/api/superadmin/users/promote` | PATCH | requireSuperAdmin | — | — |
| `/api/support/attachments/[id]` | GET | requireTenantAccess | — | — |
| `/api/support/notifications` | GET | requireTenantAccess, requireRequestIdentity | — | — |
| `/api/support/tickets` | GET, POST | requireTenantAccess | — | sí |
| `/api/support/tickets/[id]` | GET, POST, PATCH | requireTenantAccess | — | — |
| `/api/support/tickets/[id]/attachments` | POST | requireTenantAccess | — | — |
| `/api/system/diagnostics` | GET | requireSuperAdmin | — | — |
| `/api/system/diagnostics/data-freshness` | GET | requireSuperAdmin | — | — |
| `/api/system/diagnostics/tenants` | GET, POST | requireSuperAdmin | — | — |
| `/api/tags` | GET, POST, DELETE | requireTenantAccess | — | — |
| `/api/tags/apply` | POST | requireTenantRole, requireTenantTier | Business | — |
| `/api/tags/apply-bulk` | POST | requireTenantRole, requireTenantTier | Business | sí |
| `/api/tags/compliance` | GET | requireTenantRole | — | sí |
| `/api/templates/powerbi` | GET | — | — | — |
| `/api/templates/powerbi/[id]` | GET | — | — | — |
| `/api/tenant-logo/[tenantId]` | GET | — | — | — |
| `/api/tenants` | GET, POST, PUT, DELETE | requireSuperAdmin, requireTenantRole, requireTenantAccess, requireRequestIdentity | — | — |
| `/api/tenants/partner-link` | POST | requireTenantRole | — | — |
| `/api/unit-metrics/ingest` | POST | — | — | — |
| `/api/v1/anomalies` | GET | — | — | — |
| `/api/v1/budgets` | GET | — | — | — |
| `/api/v1/cost/summary` | GET | — | — | — |
| `/api/v1/cost/timeseries` | GET | — | — | — |
| `/api/v1/docs` | GET | — | — | — |
| `/api/v1/me` | GET | — | — | — |
| `/api/v1/openapi.json` | GET | — | — | — |
| `/api/v1/recommendations` | GET | — | — | — |
| `/api/v1/resources` | GET | — | — | — |
| `/api/webhooks/marketplace/azure` | POST | — | — | — |
| `/api/webhooks/marketplace/azure/activate` | POST | — | — | — |
| `/api/webhooks/paddle` | POST | — | — | — |

## Rutas sin guard de tenant ni CRON_SECRET

Requieren justificación explícita. Son públicas por diseño (pre-login, webhooks
firmados, API pública con su propia autenticación por API key, health checks) o
son un hallazgo. Contrastar contra `docs/lld/03-seguridad-y-rbac.md`.

- `/api/admin/config/markup/simulate`
- `/api/admin/configuration/markup`
- `/api/admin/configuration/markup/simulate`
- `/api/admin/integrations/mcp-keys`
- `/api/auth/sso/callback`
- `/api/auth/sso/logout`
- `/api/auth/sso/me`
- `/api/auth/sso/start`
- `/api/cleanup/networking-zombies`
- `/api/cleanup/orphan-backups`
- `/api/exports/powerbi-feed`
- `/api/governance/advisor`
- `/api/health`
- `/api/intelligence/azure-monitor`
- `/api/intelligence/executive-report/data`
- `/api/intelligence/executive-report/export-pdf`
- `/api/intelligence/executive-report/history`
- `/api/intelligence/executive-report/history/[id]`
- `/api/intelligence/executive-report/send-email`
- `/api/intelligence/network-perimeter`
- `/api/intelligence/network/internet`
- `/api/intelligence/network/loadbalancer`
- `/api/intelligence/seguridad/sentinel`
- `/api/intelligence/sentinel`
- `/api/intelligence/top-spend`
- `/api/leads`
- `/api/leads/demo`
- `/api/loadtest/probe`
- `/api/mcp`
- `/api/status`
- `/api/templates/powerbi`
- `/api/templates/powerbi/[id]`
- `/api/tenant-logo/[tenantId]`
- `/api/unit-metrics/ingest`
- `/api/v1/anomalies`
- `/api/v1/budgets`
- `/api/v1/cost/summary`
- `/api/v1/cost/timeseries`
- `/api/v1/docs`
- `/api/v1/me`
- `/api/v1/openapi.json`
- `/api/v1/recommendations`
- `/api/v1/resources`
- `/api/webhooks/marketplace/azure`
- `/api/webhooks/marketplace/azure/activate`
- `/api/webhooks/paddle`
