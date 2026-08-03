# Modelo de datos: tablas (generado)

> Generado por `scripts/generate-lld.mjs`. No editar a mano.

Total: **86** tablas. Migraciones aplicables: **61**.

`schema.sql` es el baseline de referencia y **no se ejecuta**; `migrations/` es la
fuente de verdad de todo cambio encima de él (ver `docs/lld/02-modelo-de-datos.md`).

| Tabla | En baseline | Creada por migración |
|---|---|---|
| `AcademyProgress` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `ActionLogs` | sí | `20260628-001-core-bootstrap.sql` |
| `AiCache` | sí | `20260628-001-core-bootstrap.sql` |
| `AICostSnapshots` | — | `20260726-002-ai-cost-snapshots.sql` |
| `AlertRules` | — | `20260628-001-core-bootstrap.sql` |
| `AllocationRules` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `Anomalies` | — | `20260704-004-create-anomalies.sql` |
| `AppServiceRecommendations` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `AuthTokens` | — | `20260725-004-local-auth.sql` |
| `AwsAccounts` | — | `20260629-007-aws-accounts.sql` |
| `BillingTransactions` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `Budgets` | sí | `20260628-001-core-bootstrap.sql` |
| `BusinessMetrics` | — | `20260701-002-business-metrics.sql` |
| `BusinessMetricsConfig` | — | `20260701-002-business-metrics.sql` |
| `CopilotUsage` | — | `20260715-001-create-copilot-usage.sql` |
| `cost_snapshots` | sí | `20260728-003-sincronizar-esquema-vps.sql` |
| `CostCategorySnapshots` | — | `20260704-003-cost-category-snapshots.sql` |
| `CostCenterBudgets` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `CostGroupResourceGroups` | — | `20260717-001-cost-groups-custom-rules.sql` |
| `CostGroups` | — | `20260710-001-create-cost-groups-table.sql` |
| `CostMeterSnapshots` | — | `20260704-001-cost-meter-snapshots.sql` |
| `CostSnapshots` | sí | `20260628-001-core-bootstrap.sql` |
| `DailySnapshots` | — | `20260702-001-daily-snapshots.sql` |
| `DataPipelineEvents` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `DataResidencyChanges` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `de` | — | `20260705-001-tenants-markup-percentage.sql` |
| `ExpiringCredentials` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `FocusExportSchedules` | — | `20260719-003-focus-export-schedules.sql` |
| `FocusLineItems` | — | `20260725-001-focus-line-items.sql` |
| `FxRates` | — | `20260629-004-multicurrency.sql` |
| `GlobalSettings` | sí | `20260628-001-core-bootstrap.sql` |
| `HARecommendations` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `LegalAcceptances` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `LoadTestRuns` | — | `20260714-001-create-load-test-alerts.sql` |
| `M365CopilotConfig` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `MACCCommitments` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `MarketplaceEvents` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `MaturityAssessments` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `MCPApiKeys` | — | `20260629-005-mcp-keys.sql` |
| `MfaChallenges` | — | `20260629-008-create-mfa-challenges.sql` |
| `no` | — | `20260730-001-platform-ai-usage.sql` |
| `NotificationChannels` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `NotificationLog` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `Notifications` | — | `20260714-004-create-notifications.sql` |
| `omitted` | — | `20260701-001-actionlogs-resource-type-details.sql` |
| `OnboardingProgress` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `OpenDataCommitmentEligibility` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `OpenDataPricingUnits` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `OpenDataRegions` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `OpenDataResourceTypes` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `OpenDataServices` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `OpenDataSyncState` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `PlatformAiUsage` | — | `20260730-001-platform-ai-usage.sql` |
| `PlatformIncidents` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `PlatformStatusSnapshots` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `PowerSchedules` | — | `20260702-003-power-schedules.sql` |
| `PricingUnits` | — | `20260629-003-pricing-units.sql` |
| `PublicApiKeys` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `recommendation_exemptions` | — | `20260731-003-recommendation-exemptions.sql` |
| `RecommendationActions` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `RecommendationsCache` | sí | `20260628-001-core-bootstrap.sql` |
| `RemediationRequests` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `SavingsHistory` | sí | `20260628-001-core-bootstrap.sql` |
| `SignupEvents` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `SqlDbRecommendations` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `SSOSessions` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `StorageRecommendations` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `SupportTicketAttachments` | — | `20260706-002-support-attachments.sql` |
| `SupportTicketMessages` | — | `20260706-001-create-support-tickets.sql` |
| `SupportTickets` | — | `20260706-001-create-support-tickets.sql` |
| `SystemAlerts` | — | `20260714-001-create-load-test-alerts.sql` |
| `SystemCronRuns` | — | `20260803-001-system-cron-runs.sql` |
| `TaggingPolicies` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `tenant_health` | sí | `20260628-001-core-bootstrap.sql` |
| `TenantDelegations` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `TenantMonthlyBudgets` | sí | `20260628-001-core-bootstrap.sql` |
| `TenantProviderTransitions` | — | `20260725-005-provider-archive.sql` |
| `Tenants` | sí | `20260628-001-core-bootstrap.sql` |
| `TenantSSO` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `TtlDeletions` | — | `20260718-001-ttl-policies-and-deletions.sql` |
| `TtlPolicies` | — | `20260718-001-ttl-policies-and-deletions.sql` |
| `UserCurrencyPreference` | — | `20260629-004-multicurrency.sql` |
| `UserDashboardPins` | — | `20260629-002-user-dashboard-pins.sql` |
| `Users` | sí | `20260628-001-core-bootstrap.sql` |
| `VmssRecommendations` | — | `20260728-003-sincronizar-esquema-vps.sql` |
| `WhatIfScenarios` | — | `20260629-006-whatif-scenarios.sql` |

## Migraciones, en orden de aplicación

- `migrations/20260628-001-core-bootstrap.sql`
- `migrations/20260629-001-alertrules-budget-id.sql`
- `migrations/20260629-002-user-dashboard-pins.sql`
- `migrations/20260629-003-pricing-units.sql`
- `migrations/20260629-004-multicurrency.sql`
- `migrations/20260629-005-mcp-keys.sql`
- `migrations/20260629-006-whatif-scenarios.sql`
- `migrations/20260629-007-aws-accounts.sql`
- `migrations/20260629-008-create-mfa-challenges.sql`
- `migrations/20260630-001-mfa-challenge-attempts.sql`
- `migrations/20260630-tenants-secret-nullable.sql`
- `migrations/20260701-001-actionlogs-resource-type-details.sql`
- `migrations/20260701-002-business-metrics.sql`
- `migrations/20260702-001-daily-snapshots.sql`
- `migrations/20260702-003-power-schedules.sql`
- `migrations/20260704-001-cost-meter-snapshots.sql`
- `migrations/20260704-002-cost-meter-region.sql`
- `migrations/20260704-003-cost-category-snapshots.sql`
- `migrations/20260704-004-create-anomalies.sql`
- `migrations/20260705-001-tenants-markup-percentage.sql`
- `migrations/20260705-002-create-budgets-table.sql`
- `migrations/20260705-003-ai-api-key-encrypted-widen.sql`
- `migrations/20260706-001-create-support-tickets.sql`
- `migrations/20260706-002-support-attachments.sql`
- `migrations/20260707-001-alertrules-credential-expiry.sql`
- `migrations/20260708-001-tenants-partner-link.sql`
- `migrations/20260709-001-tenants-sales-referrer.sql`
- `migrations/20260710-001-create-cost-groups-table.sql`
- `migrations/20260714-001-create-load-test-alerts.sql`
- `migrations/20260714-002-power-schedules-action-date.sql`
- `migrations/20260714-003-alertrules-reminder-frequency.sql`
- `migrations/20260714-004-create-notifications.sql`
- `migrations/20260714-005-anomalies-cron-dedup.sql`
- `migrations/20260715-001-create-copilot-usage.sql`
- `migrations/20260716-001-power-schedules-days-of-week.sql`
- `migrations/20260716-002-anomalies-top-contributors.sql`
- `migrations/20260717-001-cost-groups-custom-rules.sql`
- `migrations/20260718-001-ttl-policies-and-deletions.sql`
- `migrations/20260719-001-ai-config-controls.sql`
- `migrations/20260719-002-notifications-master-toggle.sql`
- `migrations/20260719-003-focus-export-schedules.sql`
- `migrations/20260720-001-users-avatar-stored-name.sql`
- `migrations/20260724-001-costsnapshots-focus-columns.sql`
- `migrations/20260725-001-focus-line-items.sql`
- `migrations/20260725-002-costsnapshots-billing-account-amortized.sql`
- `migrations/20260725-003-awsaccounts-last-assembly-id.sql`
- `migrations/20260725-004-local-auth.sql`
- `migrations/20260725-005-provider-archive.sql`
- `migrations/20260726-002-ai-cost-snapshots.sql`
- `migrations/20260727-001-drop-aws-tables.sql`
- `migrations/20260728-001-costsnapshots-allocation-tags.sql`
- `migrations/20260728-002-tenants-sync-status.sql`
- `migrations/20260728-003-sincronizar-esquema-vps.sql`
- `migrations/20260729-001-drop-local-auth.sql`
- `migrations/20260730-001-platform-ai-usage.sql`
- `migrations/20260731-001-tenant-timezone.sql`
- `migrations/20260731-002-eliminar-tenant-directorio-msa.sql`
- `migrations/20260731-003-recommendation-exemptions.sql`
- `migrations/20260801-001-copilot-usage-tokens.sql`
- `migrations/20260803-001-system-cron-runs.sql`
- `migrations/20260803-002-tenants-sales-commission.sql`
