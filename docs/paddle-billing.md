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

### adjustment.created / adjustment.updated
**When:** Paddle creates an adjustment (refund, chargeback or credit) for a transaction (`created`, for every adjustment), or a pending refund is approved or rejected (`updated`). Paddle Billing has **no** `transaction.refunded` event (that was Paddle Classic): refunds arrive as adjustments. In sandbox Paddle approves every pending refund each ten minutes.
**Processing:**
- Only a `refund` or `chargeback` that is `approved` and `type = full` reverts the commissions of `transaction_id` (`PENDING`, `DUE` and `APPROVED` become `REVERSED`; `PAID` is never touched).
- Credits, pending or rejected refunds, chargeback warnings and reversals do nothing.
- A **partial** refund (approved) reduces the commissions of that charge in the same proportion (`ajustarComisionesPorReembolsoParcial`): the commission base is the charge's pre-tax subtotal, so the new base is `base - adjustment.totals.subtotal` and the amount is recomputed with the row's %. If the base reaches zero the commission becomes `REVERSED`. An already `PAID` commission is not touched: it gets a note in `Commissions.notes` ("descontar de la liquidación siguiente") and is counted in `pagadasARevisar`. Idempotent per adjustment: each row keeps the `[adj_...]` mark of the adjustments it already applied; two different adjustments on the same charge add up.
- Idempotent: `created` and `updated` of the same adjustment revert the same rows once.
- A **full** `refund` or `chargeback` that is `approved` also runs `aplicarReembolsoAprobado` (`src/services/refunds.service.ts`): the charge is marked `refunded` in `BillingTransactions`; if it credited a marketplace module, that `TenantAddons` row becomes `cancelled` (and, if the module was recurring, its Paddle subscription is canceled immediately, otherwise it would bill and re-credit next month); if it is the **latest charge of the tenant's plan**, `access_until` is set to now and the subscription is canceled in Paddle (the `subscription.canceled` that follows leaves the state and the history entry). An earlier charge of the plan only gets marked: it was already used. If Paddle cannot cancel (network / 5xx) the webhook answers 500 and Paddle retries; everything is idempotent.
- A `refund` that is `rejected` puts the charge back to `completed` so it can be requested again.

### Requesting a refund from the platform

`GET/POST /api/billing/refunds` (`RefundsDialog`: *Billing > Refunds* for the tenant's Admin/Owner, *Tenants > Refunds* for the SuperAdmin).
- **Prorated (default)**: what is refunded is the part of the period that was **not used**. Days used = days from the payment (`billed_at`) to the request, rounding **up** (any fraction of a day counts as a used day); the period is the transaction's `billing_period` (renewals/first charge of a subscription) or, for a one-time pass (`billing_period` is `null`), the pass validity (`TenantAddons.starts_at`..`expires_at`). Each transaction line (`details.line_items[]`, tax included) refunds `floor(total × unused days / period days)`, sent as a `partial` adjustment with `items[].amount` in minor units (`tax_mode: internal`). If the period cannot be determined or is fully used, an Admin/Owner cannot refund it (the dialog says why); nothing is invented. Example: monthly charge, request on day 3 → 27/30 of the charge.
- **Total**: the whole charge, `type: full`. **Only a SuperAdmin** (corporate domain + `SUPERADMIN` role) can ask for it (checkbox in the dialog).
- **Window**: an Admin/Owner can request only within `VENTANA_REEMBOLSO_DIAS` (**7**) days of the charge; the SuperAdmin has no window. The window is a default chosen by us; the terms say refunds are not given for partial months except where the law requires.
- The charge must belong to the tenant, be `completed`, and have no refund in progress (the status moves `completed` → `refund_pending` atomically before calling Paddle; Paddle also refuses a second refund on a transaction with one pending).
- It calls `POST /adjustments` (`action: refund`) and records `REFUND_REQUESTED` in `AuditTrailLogs`. **The effects are NOT applied here: they arrive with the approved adjustment webhook**, so refunds made in the Paddle dashboard are covered the same way.
- Because what is refunded is the unused time, an approved prorated refund **ends the service** exactly like a total one (access cut, module switched off, subscription canceled). A partial refund made by hand in the Paddle dashboard (the charge is still `completed`) only adjusts commissions.
- While a refund is `refund_pending`, the commissions of that charge are **held out of payout runs** (`payoutRuns.service`): otherwise a commission could be paid and the refund approved afterwards, and a `PAID` commission cannot be reverted with an UPDATE. If Paddle rejects the refund the charge goes back to `completed` and the commission enters the next run.
- **The runtime API key needs `adjustment.write`** (in addition to `price.read`, `subscription.read`, `subscription.write` and `transaction.write`).
- Live accounts: most refunds are created `pending_approval` and Paddle reviews them; sandbox approves every ten minutes.

### Commissions and cancellations

`recordTenantLifecycleTransition` is the single point for a tenant's cancellation, and now every `CANCELED` / `EXPIRED` transition calls `cancelarComisionesPorChurn` (it cancels the sales-rep installments that are not yet due; due and paid ones stay). Before, only `subscription.canceled` from Paddle did it, so a cancellation from the panel (`/api/billing`, `/api/billing/subscription`), the Azure Marketplace webhook or the expiry cron left installments alive. A cancellation *request* (end of period) takes effect, for commissions, when the cancellation really happens: until then the customer still has the service and the already-paid charges keep their commission.

### Cancelling a subscription

`POST /api/admin/billing/cancel-subscription` now asks Paddle to cancel at the end of the billing period (`next_billing_period`) **before** marking `Tenants.cancel_at_period_end`. It used to only set the flag: the customer saw "will be canceled" while Paddle kept billing. If Paddle rejects it, the error is shown and nothing is marked.

### Cancellations that need a SuperAdmin's approval

A cancellation requested by the customer runs **on its own** only when the tenant has a Paddle subscription and Paddle accepts the cancellation (`cancelTenantSubscription`). Otherwise nothing would execute it, so a **request** is created (`CancellationRequests`, migration `20261013-035`, one `PENDING` per tenant) instead of just setting a flag nobody sees:

| `reason_code` | When |
|---|---|
| `no-paddle-subscription` | manual sign-up or Enterprise tenant, no Paddle subscription |
| `azure-marketplace` | `marketplace_source = azure_marketplace` (billed by Microsoft) |
| `paddle-rejected` | Paddle rejected the cancellation or did not answer (the detail is stored) |

- **The customer's request is never lost or answered with an error**: the response is `{ success: true, pendingApproval: true }`, the billing screen shows "Cancellation under review" and the subscription stays active; nothing is cut until someone approves.
- **The SuperAdmin is notified by email** (`INTERNAL_CANCELLATION_ALERT_EMAIL`, else `AZURE_RECIPIENT_EMAIL`) with the tenant, plan, who asked and why it is not automatic. Reminder every `DIAS_ENTRE_RECORDATORIOS` (3) days while it is still pending, sent by the daily `subscription-expiry` cron (no cron of its own). It is **never approved automatically**.
- **Superadmin > Tenants > Cancellations** (`CancellationRequestsDialog`, `GET /api/superadmin/cancellation-requests`, `POST .../{id}`): lists them (pending first, with the not-yet-due sales-rep installments the cancellation would cancel).
  - **Reject**: a reason is required and is emailed to the customer; nothing else changes.
  - **Approve**: *with a Paddle subscription* it cancels at the end of the period in Paddle (if Paddle rejects it again, the request goes back to `PENDING` and the error is shown; `skipPaddle` is the way out when the SuperAdmin already cancelled it by hand in Paddle) and the `subscription.canceled` that follows records the cancellation. *Without one*, nothing else will emit the cancellation, so it is recorded right there (`CANCELED`, which also cuts the sales-rep installments not yet due) and `effectiveDate` fixes until when the tenant keeps access; the date is **required** if the tenant has no access date, because without it the cancellation would leave it without service at once.
  - The request is taken with an `UPDATE ... WHERE status = 'PENDING'` before anything runs, so two SuperAdmins cannot execute it twice; if the execution fails it goes back to `PENDING`.
  - Audit: `CANCELLATION_REQUEST_CREATED` / `_APPROVED` / `_REJECTED` in `AuditTrailLogs`; the customer gets an email with the outcome.

### Marketplace module subscriptions are not the plan

`subscription.canceled` and `subscription.past_due` of a module (`custom_data.addon_key`) only affect that module: cancel → its recurring `TenantAddons` row becomes `cancelled`; past_due → nothing. They no longer cancel/suspend the tenant, cut its churn commissions or notify a cancellation.

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

## Enterprise (deals a medida)

Enterprise no tiene precio fijo: cada cliente tiene un Price a medida, creado a mano en Paddle (Catálogo > Precios), que se cobra
con un enlace que genera un SuperAdmin (Superadmin > Tenants > "Cobrar vía Paddle").

**El enlace** es el `checkout.url` de una transacción creada por API (`POST /transactions` con
`custom_data: { tenant_id, tier: "Enterprise" }`): el *default payment link* de la cuenta más `?_ptxn=<transacción>`. Lo arma
`generatePaddleCheckoutLink` (`src/services/superAdminTenants.service.ts`). Requisitos en Paddle (sandbox y live se configuran
por separado):

- Un **default payment link** en Paddle > Checkout > Checkout configuration. Si falta, la API contesta
  `transaction_default_checkout_url_not_set` y el panel muestra ese motivo. La página tiene que incluir Paddle.js; la página
  hospedada por Paddle (`https://<cuenta>.sandbox.paddle.io/pay/hsc_…`) lo hace y acepta `_ptxn`.
- El precio tiene que ser **recurrente**: el tier lo activa `subscription.created`. Un precio de pago único sólo genera
  `transaction.completed`, que no cambia el tier (queda registrado el cobro y no se activa nada).

No sirven los enlaces armados a mano (`https://buy.paddle.com/checkout?price_id=…&custom_data=…`): `buy.paddle.com/checkout` es
el marco del checkout que maneja Paddle.js y su código sólo lee `action`, `payload` y `retain_enabled`; la pantalla queda en
blanco. Hasta el 2026-10-12 la app generaba justamente ese enlace —sin llamar a Paddle— y además con `custom_data` como
`{ tenantId }`, mientras el webhook lee `tenant_id`: aunque hubiera abierto un checkout, el pago no habría activado a nadie.

**El tier en el webhook (`resolveTier`)** sale del precio pagado: si es uno de los cuatro de plan, ese tier; si no, Enterprise
sólo cuando `custom_data.tier` es `Enterprise` **y** el precio es el que un SuperAdmin registró para ese tenant
(`TenantSubscriptions.paddle_price_id`, que el panel escribe antes de pedirle el enlace a Paddle).

`custom_data` no es de fiar cuando viene de un checkout abierto con Paddle.js: lo elige quien lo abre
([doc de Paddle](https://developer.paddle.com/build/transactions/custom-data)). Con el código anterior, que daba prioridad a
`custom_data.tier`, nada impedía pagar el plan Professional con `customData: { tenant_id, tier: "Enterprise" }` desde la consola
del navegador y quedar Enterprise. Lo mismo vale para `tenant_id`, `addon_key`, `months` y `addon_type`; ver "Security
Considerations".

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
6. **`custom_data` del comprador:** un checkout abierto con Paddle.js lleva el `customData` que elija quien lo abre. Ninguna
   decisión de dinero o de acceso puede depender sólo de él: el tier sale del precio pagado o de un registro del servidor
   (`resolveTier`). **Abierto:** `tenant_id` (se puede pagar a nombre de otro tenant y pisar su suscripción) y
   `addon_key`/`months`/`addon_type` (`purchaseAddon` acredita el módulo que diga `custom_data` sin comprobar que el precio
   pagado sea el de ese módulo) siguen saliendo de `custom_data`. La salida es crear la transacción en el servidor, para el
   usuario autenticado, y abrir el checkout con `transactionId`.

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
