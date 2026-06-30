# Paddle Billing Implementation Guide

## Overview

This FinOps SaaS implements end-to-end Paddle Billing integration with the following architecture:

### Key Components

1. **Client-side Checkout** (`@/components/PricingPage.tsx`)
   - Uses `@paddle/paddle-js` library
   - Opens Paddle checkout overlay via `paddle.Checkout.open()`
   - Passes `customData` with `tenant_id` for webhook association

2. **Webhook Handler** (`/api/webhooks/paddle/route.ts`)
   - Verifies HMAC signatures (SHA-256)
   - Enforces 5-minute replay window
   - Handles 6 event types (see Event Types below)
   - Single source of truth for subscription state

3. **REST API Endpoints**
   - `POST /api/checkout` - Returns price IDs for client-side checkout
   - `PATCH /api/billing/subscription` - Upgrade/downgrade with proration
   - `DELETE /api/billing/subscription` - Cancel subscription
   - `GET /api/billing/portal` - Links to Paddle management portal
   - `GET /api/billing/invoices` - Transaction history

4. **Database Schema**
   - **Tenants table columns:**
     - `paddle_subscription_id` (VARCHAR) - Paddle subscription identifier
     - `subscription_status` (ENUM) - TRIAL, ACTIVE, PAST_DUE, CANCELED, EXPIRED
     - `tier` (ENUM) - Essential, Professional, Business, Enterprise
     - `trial_ends_at` (DATETIME) - Trial expiration if applicable
   
   - **BillingTransactions table:**
     - Logs all completed and failed transactions
     - Indexed by tenant_id and billed_at for performance
     - Stores raw Paddle event JSON for audit trails

## Event Lifecycle

```
New Customer → Checkout → subscription.created (TRIAL) 
     ↓
Trial Period 
     ↓
transaction.completed (first payment)
     ↓
subscription.updated (ACTIVE)
     ↓
[Customer optionally upgrades/downgrades via subscription.updated]
     ↓
[Payment fails] → transaction.payment_failed → subscription.past_due (PAST_DUE)
     ↓
Customer cancels → subscription.canceled (CANCELED)
```

### Status Meanings

| Status | Meaning | Action |
|--------|---------|--------|
| **TRIAL** | Free trial active | Show trial countdown, prompt upgrade before end |
| **ACTIVE** | Paid subscription active | Full feature access |
| **PAST_DUE** | Payment failed | Show payment warning, limit features if configured |
| **CANCELED** | Subscription ended | Downgrade to Essential or block (per policy) |
| **EXPIRED** | Legacy status (not used) | Reserved for future enhancements |

## Supported Event Types

### subscription.created
**When:** Customer completes first checkout
**Processing:**
- Saves `paddle_subscription_id`
- Maps price ID → tier (Essential/Professional/Business)
- Sets status based on subscription mode (TRIAL or ACTIVE)
- Saves `trial_ends_at` if trialing

### subscription.updated
**When:** Plan changed (upgrade/downgrade), trial ended, or any subscription property updated
**Processing:**
- Re-maps tier from items[0].price.id (handles plan changes)
- Updates subscription_status if changed
- Updates `trial_ends_at` if changed

### subscription.canceled
**When:** Subscription explicitly canceled
**Processing:**
- Sets status = CANCELED

### subscription.past_due
**When:** Payment failed repeatedly, customer in dunning process
**Processing:**
- Sets status = PAST_DUE
- May trigger notification to customer via `notifyTenant()` (optional)

### transaction.completed
**When:** Payment processed successfully
**Processing:**
- Inserts row into BillingTransactions
- Amount converted from cents (Paddle) to dollars
- Stored for invoice history and audit trails

### transaction.payment_failed
**When:** Payment attempt fails (insufficient funds, expired card, etc.)
**Processing:**
- Inserts row into BillingTransactions with status = "payment_failed"
- Raw event stored for troubleshooting

## Price ID to Tier Mapping

The `@/lib/paddleTierMap.ts` helper module manages bidirectional conversion:

```typescript
// Environment variables (in .env.development or .env.production)
NEXT_PUBLIC_PADDLE_ESSENTIAL_MONTHLY="pri_01kve6d9kntj6w2m0t9rtkm3dq"
NEXT_PUBLIC_PADDLE_ESSENTIAL_YEARLY="pri_01kve6cdjyy4q6axv6zkqm4apq"
NEXT_PUBLIC_PADDLE_PRO_MONTHLY="pri_01kve6af8g1bvznqnr53aq5c6a"
NEXT_PUBLIC_PADDLE_PRO_YEARLY="pri_01kve69aa3fmn1rdheqtkrs6n4"
NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY="pri_01kve67ce9j9b9697hm7jb58s7"
NEXT_PUBLIC_PADDLE_BUSINESS_YEARLY="pri_01kve668pq08yjhfjc8sfkd2wf"

// Usage
import { priceIdToTier, tierToPriceId } from "@/lib/paddleTierMap";

priceIdToTier("pri_01kve6af8g1bvznqnr53aq5c6a") // → "Professional"
tierToPriceId("Professional", "monthly") // → "pri_01kve6af8g1bvznqnr53aq5c6a"
```

## Proration Modes

When upgrading or downgrading, you can choose:

| Mode | Behavior |
|------|----------|
| **prorated_immediately** | Charge/credit the difference now, next billing cycles normal |
| **prorated_next_billing_period** | Change plan, apply charges at next renewal |
| **do_not_bill** | Change plan with no immediate charge (credit scenarios) |

Example: Upgrade from Essential ($10/month) to Professional ($30/month) mid-cycle:
- **Immediately:** Charge $20 prorated days immediately
- **Next Period:** Charge full $30 at next renewal
- **Do Not Bill:** No charge now, Professional price starts at renewal

## Sandbox vs. Production

### Switching Environments

Configuration is entirely environment-driven:

**.env.development (Sandbox)**
```
PADDLE_API_KEY="pdl_sdbx_apikey_01kve6..."   # Sandbox key (starts with pdl_sdbx_)
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN="test_..."
NEXT_PUBLIC_PADDLE_ESSENTIAL_MONTHLY="pri_01kve6d9..."  # Sandbox prices
```

**.env.production (Production)**
```
PADDLE_API_KEY="pdl_live_apikey_01kvd..."    # Live key (starts with pdl_live_)
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN="live_..."
NEXT_PUBLIC_PADDLE_ESSENTIAL_MONTHLY="pri_01kvdp..."   # Live prices
```

**DO NOT** mix sandbox and production credentials.

### Testing Locally

Use the Paddle CLI to forward webhooks from Paddle to your local dev server:

```bash
# Install Paddle CLI
brew install paddle-cli  # macOS
# or download from https://github.com/PaddleHQ/paddle-cli

# Forward webhooks
paddle webhooks forward --api-key=pdl_sdbx_... --endpoint http://localhost:3000/api/webhooks/paddle
```

### Testing Webhook Signature

```typescript
import crypto from "crypto";

const secret = process.env.PADDLE_WEBHOOK_SECRET;
const timestamp = Math.floor(Date.now() / 1000);
const body = JSON.stringify({ event_type: "subscription.created", data: {} });

const payloadToSign = `${timestamp}:${body}`;
const h1 = crypto.createHmac("sha256", secret).update(payloadToSign).digest("hex");

const signatureHeader = `ts=${timestamp};h1=${h1}`;
console.log(signatureHeader);  // Use in Postman or curl
```

## API Usage Examples

### 1. Client-side Checkout

```typescript
// In PricingPage component
const openCheckout = (priceId: string, tenantId: string) => {
  if (!paddle) return;
  
  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customData: { tenant_id: tenantId },
  });
};
```

### 2. Upgrade Subscription

```typescript
const response = await fetch(`/api/billing/subscription?tenantId=${tenantId}`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    newTier: "Professional",
    billing: "yearly",
    prorationBillingMode: "prorated_immediately"
  })
});
```

### 3. Get Invoice History

```typescript
const response = await fetch(`/api/billing/invoices?tenantId=${tenantId}&limit=20`, {
  headers: { Authorization: `Bearer ${token}` }
});

const data = await response.json();
// Returns: { invoices: [...], count: number }
```

### 4. Access Paddle Management Portal

```typescript
const response = await fetch(`/api/billing/portal?tenantId=${tenantId}`, {
  headers: { Authorization: `Bearer ${token}` }
});

const { managementUrls } = await response.json();
window.open(managementUrls.update_payment_method, "_blank");
```

## Debugging Tips

### Enable Verbose Logging

The webhook handler logs all events to console:
```
[Webhooks] Processing event subscription.created for Tenant ID: abc-123
[Webhooks] Subscription created for tenant abc-123: tier=Professional, status=ACTIVE
```

### Check Raw Event

All transaction events are stored in `BillingTransactions.raw_event`:
```sql
SELECT raw_event FROM BillingTransactions WHERE tenant_id = 'abc-123' ORDER BY created_at DESC LIMIT 1\G
```

### Validate Webhook Signature Locally

```bash
# Using curl with Paddle test webhook
curl -X POST http://localhost:3000/api/webhooks/paddle \
  -H "paddle-signature: ts=1234567890;h1=abcd1234..." \
  -H "Content-Type: application/json" \
  -d '{"event_type":"subscription.created","data":{...}}'
```

### Common Issues

**Issue:** Webhook always returns 401 (Invalid signature)
- ✅ Verify `PADDLE_WEBHOOK_SECRET` env var matches Paddle dashboard
- ✅ Ensure timestamp is within 5 minutes
- ✅ Check that `custom_data.tenant_id` is present (not required for 200 OK, but required for DB update)

**Issue:** Subscription status not updating after checkout
- ✅ Verify Paddle webhook delivery status in Paddle dashboard
- ✅ Check logs for errors during webhook processing
- ✅ Ensure `paddle_subscription_id` table column exists

**Issue:** Proration showing as null after upgrade
- ✅ Paddle may not return `next_transaction` if billing cycles aligned
- ✅ This is normal; no proration needed in that case

## Security Considerations

1. **HMAC Verification:** All webhooks must pass signature verification before processing
2. **Replay Window:** 5-minute window prevents replay attacks
3. **Database:** BillingTransactions.raw_event stores full payload for audit
4. **Auth:** All endpoints require `requireTenantRole` with OWNER permission (billing-sensitive)
5. **API Keys:** Production keys never committed; use env-based secrets only

## Performance Notes

- Webhook processing is near-instant (< 100ms for happy path)
- Invoice queries use `idx_tenant_date` index
- No background jobs required; webhooks are synchronous
- Subscription state consistency guaranteed by single DB write per event

## Migration from Old System

If migrating from `subscription_id` (generic) to `paddle_subscription_id`:

```sql
-- Backup first!
ALTER TABLE Tenants 
RENAME COLUMN subscription_id TO subscription_id_legacy;

ALTER TABLE Tenants 
ADD COLUMN paddle_subscription_id VARCHAR(255);

-- Data migration if needed (populate from old column)
UPDATE Tenants SET paddle_subscription_id = subscription_id_legacy 
WHERE subscription_id_legacy IS NOT NULL;
```

## Testing Checklist

- [ ] Webhook signature verification (valid, invalid, stale)
- [ ] subscription.created with TRIAL status
- [ ] subscription.updated with tier change
- [ ] subscription.canceled
- [ ] subscription.past_due
- [ ] transaction.completed (with amount conversion)
- [ ] transaction.payment_failed
- [ ] Upgrade endpoint with different proration modes
- [ ] Downgrade endpoint
- [ ] Cancel endpoint
- [ ] Invoice history returns correctly
- [ ] Paddle portal URL redirects work
- [ ] Client checkout overlay opens
- [ ] Email notifications on payment failure (if enabled)
