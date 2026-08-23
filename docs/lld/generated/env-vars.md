# Variables de entorno (generado)

> Generado por `scripts/generate-lld.mjs`. No editar a mano.

Declaradas en `.env.example`: **73**.

Una variable con 0 usos está declarada pero no la lee nadie: o es de build/infra
(la consume el Dockerfile, Terraform o Next en tiempo de build), o quedó huérfana.

| Variable | Usos en src/ | Ejemplo de consumidor |
|---|---|---|
| `AI_PROVIDER` | 0 | — |
| `ANOMALY_DETECTION_HEALTHCHECK_URL` | 0 | — |
| `AZURE_CLIENT_ID` | 8 | `src/app/api/admin/report/invoicing/email/route.ts`, `src/app/api/leads/demo/route.ts` |
| `AZURE_CLIENT_SECRET` | 6 | `src/app/api/admin/report/invoicing/email/route.ts`, `src/app/api/leads/demo/route.ts` |
| `AZURE_KEYVAULT_CACHE_TTL_SECONDS` | 1 | `src/lib/secrets/keyvault.ts` |
| `AZURE_KEYVAULT_CLIENT_ID` | 1 | `src/lib/secrets/keyvault.ts` |
| `AZURE_KEYVAULT_CLIENT_SECRET` | 1 | `src/lib/secrets/keyvault.ts` |
| `AZURE_KEYVAULT_ENABLED` | 1 | `src/lib/secrets/keyvault.ts` |
| `AZURE_KEYVAULT_STALE_TTL_SECONDS` | 1 | `src/lib/secrets/keyvault.ts` |
| `AZURE_KEYVAULT_TENANT_ID` | 1 | `src/lib/secrets/keyvault.ts` |
| `AZURE_KEYVAULT_URL` | 1 | `src/lib/secrets/keyvault.ts` |
| `AZURE_MARKETPLACE_AAD_APP_ID` | 2 | `src/app/[locale]/marketplace/azure/landing/page.tsx`, `src/lib/marketplace/azure.ts` |
| `AZURE_MARKETPLACE_AAD_APP_SECRET` | 0 | — |
| `AZURE_MARKETPLACE_AAD_TENANT_ID` | 1 | `src/lib/marketplace/azure.ts` |
| `AZURE_MARKETPLACE_OFFER_ID` | 0 | — |
| `AZURE_RECIPIENT_EMAIL` | 2 | `src/app/api/leads/route.ts`, `src/lib/billingAlerts.ts` |
| `AZURE_SENDER_EMAIL` | 4 | `src/app/api/admin/report/invoicing/email/route.ts`, `src/app/api/leads/demo/route.ts` |
| `AZURE_STORAGE_CONNECTION_STRING` | 1 | `src/lib/azureBlobStorage.ts` |
| `AZURE_TENANT_ID` | 5 | `src/app/api/admin/report/invoicing/email/route.ts`, `src/app/api/leads/demo/route.ts` |
| `BACKUP_AZURE_SAS_URL` | 0 | — |
| `BACKUP_HEALTHCHECK_URL` | 0 | — |
| `COST_SYNC_STALENESS_HEALTHCHECK_URL` | 0 | — |
| `CREDENTIAL_EXPIRY_ALERTS_HEALTHCHECK_URL` | 0 | — |
| `CRON_SECRET` | 37 | `src/app/api/admin/config/account-status/sync-now/route.ts`, `src/app/api/cron/anomaly-detection/route.ts` |
| `CRON_SYNC_GAP_PACE_MS` | 1 | `src/app/api/cron/sync/route.ts` |
| `CRON_SYNC_PACE_BUDGET_MS` | 1 | `src/app/api/cron/sync/route.ts` |
| `CRON_SYNC_TENANT_PACE_MS` | 1 | `src/app/api/cron/sync/route.ts` |
| `CRON_SYNC_TENANT_TIMEOUT_MS` | 1 | `src/app/api/cron/sync/route.ts` |
| `DB_HOST` | 1 | `src/modules/storage/db.ts` |
| `DB_NAME` | 1 | `src/modules/storage/db.ts` |
| `DB_PASSWORD` | 2 | `src/instrumentation.ts`, `src/modules/storage/db.ts` |
| `DB_PORT` | 1 | `src/modules/storage/db.ts` |
| `DB_USER` | 1 | `src/modules/storage/db.ts` |
| `FOCUS_EXPORT_DAILY_HEALTHCHECK_URL` | 0 | — |
| `GAP_BACKFILL_PACE_MS` | 1 | `src/lib/historicalGapBackfill.ts` |
| `GEMINI_API_KEY` | 3 | `src/app/api/cron/status-snapshot/route.ts`, `src/app/api/status/route.ts` |
| `HISTORICAL_GAP_BACKFILL_HEALTHCHECK_URL` | 0 | — |
| `MFA_ENCRYPTION_KEY` | 3 | `src/lib/mfaCrypto.ts`, `src/lib/secretCrypto.ts` |
| `NEXT_PUBLIC_CLIENT_ID` | 5 | `src/components/AdminConsentButton.tsx`, `src/components/AuthProvider.tsx` |
| `NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY` | 1 | `src/components/PricingPage.tsx` |
| `NEXT_PUBLIC_PADDLE_BUSINESS_YEARLY` | 1 | `src/components/PricingPage.tsx` |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | 1 | `src/components/PricingPage.tsx` |
| `NEXT_PUBLIC_PADDLE_PRO_MONTHLY` | 1 | `src/components/PricingPage.tsx` |
| `NEXT_PUBLIC_PADDLE_PRO_YEARLY` | 1 | `src/components/PricingPage.tsx` |
| `NEXT_PUBLIC_SSO_ENABLED` | 0 | — |
| `OPEN_DATA_HEALTHCHECK_URL` | 0 | — |
| `PADDLE_API_KEY` | 9 | `src/app/api/admin/tenants/paddle-checkout-link/route.ts`, `src/app/api/billing/portal/route.ts` |
| `PADDLE_WEBHOOK_SECRET` | 1 | `src/app/api/webhooks/paddle/route.ts` |
| `PARTNER_MPN_ID` | 2 | `src/lib/partner/pal.ts`, `src/services/superAdminPartnerCenter.service.ts` |
| `POWER_SCHEDULES_HEALTHCHECK_URL` | 0 | — |
| `PREWARM_HEALTHCHECK_URL` | 0 | — |
| `REDIS_HOST` | 1 | `src/lib/redis.ts` |
| `REDIS_PASSWORD` | 1 | `src/lib/redis.ts` |
| `REDIS_PORT` | 1 | `src/lib/redis.ts` |
| `SMTP_FROM` | 0 | — |
| `SMTP_HOST` | 0 | — |
| `SMTP_PASSWORD` | 0 | — |
| `SMTP_PORT` | 0 | — |
| `SMTP_SECURE` | 0 | — |
| `SMTP_USER` | 0 | — |
| `SSO_SESSION_SECRET` | 3 | `src/app/api/auth/sso/callback/route.ts`, `src/app/api/auth/sso/start/route.ts` |
| `STATUS_SNAPSHOT_HEALTHCHECK_URL` | 0 | — |
| `SUBSCRIPTION_EXPIRY_HEALTHCHECK_URL` | 0 | — |
| `SUPPORT_ATTACHMENTS_CLEANUP_HEALTHCHECK_URL` | 0 | — |
| `SYNC_HEALTHCHECK_URL` | 0 | — |
| `TRIAL_EXPIRY_HEALTHCHECK_URL` | 0 | — |
| `TTL_EXPIRY_ALERTS_HEALTHCHECK_URL` | 0 | — |
| `WEBAUTHN_ORIGINS` | 1 | `src/lib/webauthnConfig.ts` |
| `WEBAUTHN_RP_ID` | 1 | `src/lib/webauthnConfig.ts` |
| `WEBAUTHN_RP_NAME` | 1 | `src/lib/webauthnConfig.ts` |
| `WORKOS_API_KEY` | 1 | `src/lib/workosClient.ts` |
| `WORKOS_CLIENT_ID` | 3 | `src/app/api/auth/sso/callback/route.ts`, `src/app/api/auth/sso/start/route.ts` |
| `WORKOS_REDIRECT_URI` | 1 | `src/app/api/auth/sso/start/route.ts` |
