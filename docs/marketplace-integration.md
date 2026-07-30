# Marketplace Integration — Azure Marketplace

End-to-end SaaS Fulfillment for Azure Marketplace (CSP-style). It is the only
marketplace channel implemented; direct billing goes through Paddle.

## Architecture

```
Customer clicks "Get it now" in Marketplace
        │
        ▼
Marketplace POSTs token to our landing URL
  /marketplace/azure/landing?token=...
        │
        ▼
Landing SSR resolves the token via the real API
  POST /api/saas/subscriptions/resolve (Microsoft Fulfillment API)
        │
        ▼
"Activate" button → POST /api/webhooks/marketplace/azure/activate
        │
        ▼
Tenant row inserted with marketplace_source + subscription ID
        │
        ▼
Async lifecycle events:
  Microsoft POSTs JWT-signed events to /api/webhooks/marketplace/azure
```

## Schema

`Tenants` columns (already migrated):
- `marketplace_source ENUM('direct','azure_marketplace','aws_marketplace') DEFAULT 'direct'` —
  the third value is a legacy enum member kept only so the column definition stays
  stable; nothing writes it. Only `direct` and `azure_marketplace` occur.
- `marketplace_subscription_id VARCHAR(255)` — Azure subscription GUID
- `marketplace_plan_id VARCHAR(255)` — Azure plan ID

`MarketplaceEvents` — audit log of every webhook event received.

## Library API

`src/lib/marketplace/planMapping.ts`
- `azurePlanToTier(planId)` → `Essential | Professional | Business | Enterprise`
- `tierToAzurePlanId(tier, 'monthly'|'annual')`

`src/lib/marketplace/azure.ts`
- `getAadAccessToken()` — client_credentials with the AAD app registered in Partner Center, scoped to `20e940b3-4c77-4b0b-9a53-9e16a1b010a7/.default` (cached until 60s before expiry).
- `resolveSubscription(token)` — POST `/api/saas/subscriptions/resolve` with `x-ms-marketplace-token`.
- `activateSubscription(id, planId, quantity?)`, `getSubscription(id)`, `patchOperation(...)`.
- `verifyWebhookJwt(authHeader)` — verifies RS256 JWT against `login.microsoftonline.com/common/discovery/keys` and audience = our AAD app ID. Bypassable via `MARKETPLACE_SKIP_VERIFY=true` for tests.

## Setup — Azure (Partner Center)

1. Create a SaaS offer in **Partner Center → Marketplace offers**.
2. **Technical configuration**:
   - **Landing page URL:** `https://app.cscloudsolutions.com/marketplace/azure/landing`
   - **Connection webhook:** `https://app.cscloudsolutions.com/api/webhooks/marketplace/azure`
   - **AAD tenant ID** and **AAD App ID:** register an app in Azure AD, then add it here. Generate a client secret.
3. Plans (must match `planMapping.ts`):
   - `essential-monthly`, `essential-annual`
   - `professional-monthly`, `professional-annual`
   - `business-monthly`, `business-annual`
   - `enterprise-monthly`, `enterprise-annual`
4. Set environment variables:
   ```bash
   AZURE_MARKETPLACE_AAD_TENANT_ID=<your-aad-tenant>
   AZURE_MARKETPLACE_AAD_APP_ID=<aad-app-id>
   AZURE_MARKETPLACE_AAD_CLIENT_SECRET=<secret>
   ```

## Common

```bash
MARKETPLACE_SKIP_VERIFY=true   # local dev only: skip webhook JWT verification
```

## Webhook actions handled

| Action | Effect |
|---|---|
| `Suspended` | `subscription_status='PAST_DUE'` |
| `Unsubscribed` | `subscription_status='CANCELED'` |
| `Reinstated`, `Renew` | `subscription_status='ACTIVE'` |
| `ChangePlan` | Updates `tier` + `marketplace_plan_id` |
| `ChangeQuantity` | Stored in `marketplace_plan_id` suffix (future: dedicated column) |

## Security

- **Azure webhook auth:** Validates RS256 JWT against the live AAD JWKS endpoint. Audience must equal `AZURE_MARKETPLACE_AAD_APP_ID`.
- **Idempotency:** Tenant insertion is guarded by a uniqueness check on `(marketplace_subscription_id, marketplace_source)`. Webhooks for unknown subs return 200 (so Microsoft doesn't retry forever).
- **Confused-deputy protection:** The Azure activation flow also calls Microsoft's `activateSubscription` API which requires our AAD client_credentials — only our backend can mark a subscription as fulfilled.

## Limitations (MVP)

- No metered billing (defer until usage-based plans exist).
- Customer email is not stored in `Tenants` here — gathered during signup flow that follows `redirectUrl`.
