# Marketplace Integrations — Azure & AWS

End-to-end SaaS Fulfillment for both Azure Marketplace (CSP-style) and AWS Marketplace.

## Architecture

```
Customer clicks "Get it now" in Marketplace
        │
        ▼
Marketplace POSTs token to our landing URL
  - Azure:  /marketplace/azure/landing?token=...
  - AWS:    /marketplace/aws/landing?x-amzn-marketplace-token=...
        │
        ▼
Landing SSR resolves the token via real APIs
  - Azure:  POST /api/saas/subscriptions/resolve (Microsoft Fulfillment API)
  - AWS:    ResolveCustomer (Metering Service) + GetEntitlements
        │
        ▼
"Activate" button → POST /api/webhooks/marketplace/{azure,aws}/activate
        │
        ▼
Tenant row inserted with marketplace_source + subscription ID
        │
        ▼
Async lifecycle events:
  - Azure: Microsoft POSTs JWT-signed events to /api/webhooks/marketplace/azure
  - AWS:   SNS NotificationTopic → /api/webhooks/marketplace/aws
```

## Schema

`Tenants` columns (already migrated):
- `marketplace_source ENUM('direct','azure_marketplace','aws_marketplace') DEFAULT 'direct'`
- `marketplace_subscription_id VARCHAR(255)` — Azure subscription GUID or AWS CustomerIdentifier
- `marketplace_plan_id VARCHAR(255)` — Azure plan ID or AWS Dimension

`MarketplaceEvents` — audit log of every webhook event received.

## Library API

`src/lib/marketplace/planMapping.ts`
- `azurePlanToTier(planId)` → `Essential | Professional | Business | Enterprise`
- `awsDimensionToTier(dimension)` → ditto
- `tierToAzurePlanId(tier, 'monthly'|'annual')`

`src/lib/marketplace/azure.ts`
- `getAadAccessToken()` — client_credentials with the AAD app registered in Partner Center, scoped to `20e940b3-4c77-4b0b-9a53-9e16a1b010a7/.default` (cached until 60s before expiry).
- `resolveSubscription(token)` — POST `/api/saas/subscriptions/resolve` with `x-ms-marketplace-token`.
- `activateSubscription(id, planId, quantity?)`, `getSubscription(id)`, `patchOperation(...)`.
- `verifyWebhookJwt(authHeader)` — verifies RS256 JWT against `login.microsoftonline.com/common/discovery/keys` and audience = our AAD app ID. Bypassable via `MARKETPLACE_SKIP_VERIFY=true` for tests.

`src/lib/marketplace/aws.ts`
- `resolveCustomer(token)` — Marketplace Metering Service `ResolveCustomer`.
- `getEntitlements(customerId, productCode?)` — Marketplace Entitlement Service.
- `verifySnsMessage(msg)` — fetches Amazon signing cert (only allowed from `sns.<region>.amazonaws.com` HTTPS), verifies RSA-SHA1 (v1) or RSA-SHA256 (v2) signature over the canonical string of signed fields.
- `confirmSubscription(msg)` — auto-fetches `SubscribeURL` for `SubscriptionConfirmation` messages.

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

## Setup — AWS Marketplace

1. **AWS Marketplace Management Portal** → register a SaaS Product.
2. **Fulfillment URL:** `https://app.cscloudsolutions.com/marketplace/aws/landing`
3. Create an **SNS topic** subscribed to AWS Marketplace **entitlement notifications**. Subscribe our webhook as HTTPS endpoint: `https://app.cscloudsolutions.com/api/webhooks/marketplace/aws`. Our handler auto-confirms the `SubscriptionConfirmation` callback.
4. Dimensions in the product listing (must match `planMapping.ts`):
   - `finops-essential-monthly`, `finops-professional-monthly`, `finops-business-monthly`, `finops-enterprise-monthly`
5. Set environment variables:
   ```bash
   AWS_MARKETPLACE_PRODUCT_CODE=<assigned-by-marketplace>
   AWS_MARKETPLACE_REGION=us-east-1   # SaaS product registry is global, but APIs are us-east-1
   # Re-uses platform AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
   ```

## Common

```bash
MARKETPLACE_SKIP_VERIFY=true   # local dev only: skip JWT/SNS signature verification
```

## Webhook actions handled

### Azure
| Action | Effect |
|---|---|
| `Suspended` | `subscription_status='PAST_DUE'` |
| `Unsubscribed` | `subscription_status='CANCELED'` |
| `Reinstated`, `Renew` | `subscription_status='ACTIVE'` |
| `ChangePlan` | Updates `tier` + `marketplace_plan_id` |
| `ChangeQuantity` | Stored in `marketplace_plan_id` suffix (future: dedicated column) |

### AWS
| Action | Effect |
|---|---|
| `subscribe-success` | `subscription_status='ACTIVE'`, refresh tier |
| `subscribe-fail` | `subscription_status='PAYMENT_FAILED'` |
| `unsubscribe-pending` | `subscription_status='PENDING_CANCELLATION'` |
| `unsubscribe-success` | `subscription_status='CANCELED'` |

## Security

- **Azure webhook auth:** Validates RS256 JWT against the live AAD JWKS endpoint. Audience must equal `AZURE_MARKETPLACE_AAD_APP_ID`.
- **AWS webhook auth:** Validates SNS message signature against the Amazon signing cert. Cert URL host is restricted to `sns.<region>.amazonaws.com` over HTTPS — prevents fake-cert attacks.
- **Idempotency:** Tenant insertion is guarded by a uniqueness check on `(marketplace_subscription_id, marketplace_source)`. Webhooks for unknown subs return 200 (so SNS/Azure don't retry forever).
- **Confused-deputy protection:** The Azure activation flow also calls Microsoft's `activateSubscription` API which requires our AAD client_credentials — only our backend can mark a subscription as fulfilled.

## Limitations (MVP)

- No metered billing (defer until usage-based plans exist).
- AWS Marketplace private offers not handled differently from public.
- AWS quantity-tier dimensions not supported (single dimension per customer).
- Customer email is not stored in `Tenants` here — gathered during signup flow that follows `redirectUrl`.
