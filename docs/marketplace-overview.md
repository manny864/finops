# Marketplace Integration Overview

## Summary

The FinOps SaaS Platform is available on **Azure Marketplace**, in addition to
direct billing via Paddle. This document gives the high-level view: why the
channel exists, how billing flows through it, and what is still pending outside
the code. The API-level detail lives in
[`marketplace-integration.md`](./marketplace-integration.md); the Partner Center
runbook in [`marketplace-azure.md`](./marketplace-azure.md).

Azure Marketplace is the **only** marketplace channel. A second one (AWS) was
scaffolded during the multi-cloud evaluation of July 2026 and removed with it on
2026-07-29 — landing page, webhook handlers and client library are gone. The only
residue is the third member of the `marketplace_source` enum, kept so the column
definition stays stable; nothing reads or writes it.

---

## Table of Contents

1. [Why a marketplace channel](#why-a-marketplace-channel)
2. [Billing flow](#billing-flow)
3. [Tenant sources](#tenant-sources)
4. [Implementation status](#implementation-status)
5. [Next steps](#next-steps)
6. [Key files](#key-files)

---

## Why a marketplace channel

- **Market penetration**: enterprise customers often prefer consuming SaaS from
  their cloud provider's marketplace.
- **Simplified procurement**: one bill, consolidated with the rest of their Azure
  spend — and, for customers with a MACC, spend that draws down an existing
  commitment.
- **Trust & compliance**: customers trust software listed in an official
  marketplace.
- **Frictionless onboarding**: automatic entitlement provisioning shortens the
  sales cycle.

The integration is **additive**: Paddle billing for direct customers continues
unchanged. A tenant can be sourced from:

1. **Direct (Paddle)** — traditional SaaS signup, customer manages the subscription.
2. **Azure Marketplace** — Microsoft bills the customer; we receive notifications.

### Tier alignment

Both channels offer the same tier structure:

- **Professional**: $299/month
- **Business**: $999/month
- **Enterprise**: custom pricing (contact sales)

Prices are in USD, auto-converted for local currency where applicable.

---

## Billing flow

```
┌─────────────────────────────────────────────────────────────────┐
│                          CUSTOMER                               │
└────────────────────┬────────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
   ┌─────────┐          ┌──────────────────┐
   │ DIRECT  │          │ AZURE            │
   │ (Paddle)│          │ MARKETPLACE      │
   └────┬────┘          └────────┬─────────┘
        │                        │
        │                        ▼
        │              ┌──────────────────────┐
        │              │ Microsoft SaaS       │
        │              │ Fulfillment API      │
        │              └──────────┬───────────┘
        │                         │
        └────────────┬────────────┘
                     │
            ┌────────▼─────────┐
            │ FINOPS APP       │
            │ Webhook Receiver │
            └────────┬─────────┘
                     │
            ┌────────▼────────┐
            │ Update Tenant   │
            │ Update Status   │
            │ Log Event       │
            └─────────────────┘
```

### Direct (Paddle) flow

1. Customer signs up at `finops.cscloudsolutions.com.ar`.
2. Selects tier and billing frequency.
3. Paddle collects payment; we store the subscription ID.
4. Tenant created with `marketplace_source='direct'`.

### Azure Marketplace flow

1. Customer finds the offer on Azure Marketplace.
2. Clicks "Get It Now" → redirected to the landing page with a token.
3. Token resolved against the Microsoft SaaS Fulfillment API.
4. Tenant auto-provisioned with `marketplace_source='azure_marketplace'`.
5. Microsoft POSTs JWT-signed webhooks for lifecycle events (suspend, renew,
   cancel, plan change).
6. We update tenant status and send email notifications.

---

## Tenant sources

Each tenant carries a `marketplace_source`:

```sql
-- migrations/20260728-003-sincronizar-esquema-vps.sql
ALTER TABLE Tenants ADD COLUMN marketplace_source
  ENUM('direct','azure_marketplace','aws_marketplace') DEFAULT 'direct';

ALTER TABLE Tenants ADD COLUMN marketplace_subscription_id VARCHAR(255) NULL;
ALTER TABLE Tenants ADD COLUMN marketplace_plan_id VARCHAR(255) NULL;
```

The third enum member is legacy (see the note in [Summary](#summary)); in practice
only `direct` and `azure_marketplace` occur.

### Data model

```
Tenant
├── marketplace_source: 'direct' | 'azure_marketplace'
├── marketplace_subscription_id: str (provided by the marketplace)
├── marketplace_plan_id: str (e.g. 'professional-monthly')
├── tier: 'Professional' | 'Business' | 'Enterprise'
└── subscription_status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | ...
```

### Billing portal integration

In `/admin/billing`:

- ✅ Paddle controls for direct customers.
- ❌ Self-service plan change disabled for marketplace customers — they change it
  in the Azure portal, which is what emits the `ChangePlan` webhook.
- ℹ️ Marketplace status badge with a link to the provider portal.

---

## Implementation status

### ✅ Completed

- [x] Database schema (marketplace columns + `MarketplaceEvents` table)
- [x] Landing page with real token resolution
- [x] Webhook handler with **RS256 JWT verification** against the live AAD JWKS
      endpoint, audience pinned to `AZURE_MARKETPLACE_AAD_APP_ID`
- [x] Offer metadata (`marketplace/azure/offer-listing.md`, `technical-config.md`)
- [x] Billing page UI (marketplace status display)
- [x] Integration tests (`__tests__/integration/api-marketplace.test.ts`)
- [x] Secrets in Key Vault (`AZURE_MARKETPLACE_AAD_APP_SECRET`)

### ⏳ Requires Partner Center setup (out of scope for code)

- [ ] Register with Microsoft Partner Center
- [ ] Create the Azure Marketplace offer
- [ ] Configure the Azure AD app and credentials in the offer's technical configuration
- [ ] Sandbox testing in the partner portal
- [ ] Submit for Microsoft review
- [ ] Publish the offer to production

### ⚠️ Production readiness notes

**Monitoring:**
- Application Insights already receives the app's traces; add an alert on webhook
  handler failures and on failed tenant provisioning.
- Every marketplace event is persisted in `MarketplaceEvents` for audit.

**Reconciliation:**
- Microsoft's payout report has to be reconciled against tenant counts and
  subscription statuses monthly — the webhook is the source of truth for state,
  not for money.

---

## Next steps

### For development

1. **Test locally:**
   ```bash
   npm run dev
   # http://localhost:3000/marketplace/azure/landing?token=test_token_xyz
   ```
   `MARKETPLACE_SKIP_VERIFY=true` skips webhook JWT verification — local only.

2. **Run the integration tests:**
   ```bash
   npx vitest run __tests__/integration/api-marketplace.test.ts
   ```

3. **Harden the handler:** retry logic for transient failures, plus the
   monitoring/alerting above.

### For product/sales

1. **Partner Center registration**: create the account, complete company
   verification, register organization details.
2. **Offer configuration**: use the metadata in `marketplace/azure/`; upload
   logos, screenshots and video; set pricing and support tiers.
3. **Sandbox testing**: full flow (purchase → landing → tenant creation →
   billing) plus the webhook lifecycle (suspend, renew, cancel, plan change).
4. **Launch**: publish to sandbox first, pilot with real marketplace-sourced
   subscriptions, then publish to production.

### For operations

1. **Credentials**: the AAD client secret lives in Azure Key Vault
   (`infraSecrets.ts`), not in the `.env`. Rotate on schedule.
2. **Monitoring**: dashboard for marketplace vs. direct signups; alert on webhook
   delivery failures; track provisioning latency and conversion.
3. **Billing reconciliation**: monthly, as above.

---

## Key files

| File | Purpose |
|------|---------|
| `marketplace/azure/offer-listing.md` | Azure Marketplace listing content |
| `marketplace/azure/technical-config.md` | Azure API integration guide |
| `docs/marketplace-azure.md` | Partner Center runbook |
| `docs/marketplace-integration.md` | API-level integration reference |
| `src/app/[locale]/marketplace/azure/landing/page.tsx` | Landing page (token → tenant) |
| `src/app/api/webhooks/marketplace/azure/route.ts` | Webhook handler (lifecycle events) |
| `src/app/api/webhooks/marketplace/azure/activate/route.ts` | Activation endpoint |
| `src/lib/marketplace/azure.ts` | Fulfillment API client + JWT verification |
| `src/lib/marketplace/planMapping.ts` | Plan ID ⇄ tier mapping |
| `__tests__/integration/api-marketplace.test.ts` | Integration tests |

---

## Support & questions

**Technical implementation:** see `marketplace/azure/technical-config.md` and the
examples in `__tests__/integration/api-marketplace.test.ts`.

**Marketplace questions:** Microsoft Partner Center — https://partner.microsoft.com/

**Internal:** contact the engineering team.
