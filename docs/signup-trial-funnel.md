# Self-Service Signup + Free Trial Funnel

## Overview

This document describes the complete self-service signup and 14-day free trial funnel for FinOps SaaS. The funnel is built on MSAL (Microsoft Entra ID / Azure AD B2B) authentication, auto-creates tenants, tracks signup metrics, and manages trial lifecycle.

## Architecture

### 1. Signup Flow

```
User clicks "Start Free Trial" on /signup
    ↓
SignupPageClient stores plan in sessionStorage
    ↓
MSAL loginRedirect (Microsoft Entra ID)
    ↓
First login → Auto-creates Tenant + User (via /api/onboard)
    ↓
Tenant created with:
  - tier: Essential|Professional|Business|Enterprise
  - subscription_status: TRIAL (for pro/business) or PENDING_PAYMENT (for essential)
  - trial_ends_at: NOW + 14 days
  - is_onboarded: FALSE
```

### 2. Trial Lifecycle

```
Day 0:  Trial starts
  - Welcome email sent (fire-and-forget)
  - SignupEvents: trial_started
  
Day 12: Reminder email sent (if trial > 2 days left)
  - Only once per tenant (tracked via last_trial_reminder_at)
  - SignupEvents: no event (background task)
  
Day 14: Trial expires (via cron job)
  - subscription_status: TRIAL → EXPIRED
  - Trial expired email sent
  - SignupEvents: trial_expired
  - User sees non-dismissable red banner: "Your trial has expired"
  
Anytime: User can upgrade
  - subscription_status: TRIAL → ACTIVE (via payment processor)
  - SignupEvents: converted_to_paid
```

### 3. Trial Banner States

The `<TrialBanner />` component shows contextual messages based on tenant state:

| Status | Days Left | Banner | Color | Dismissible |
|--------|-----------|--------|-------|------------|
| TRIAL | > 7 | "X days left" + upgrade CTA | Blue (info) | Yes (24h) |
| TRIAL | 3-7 | "X days left" + upgrade CTA | Yellow (warning) | Yes (24h) |
| TRIAL | ≤ 2 | "X days left" + upgrade CTA | Red (critical) | Yes (24h) |
| EXPIRED | - | "Trial expired" + upgrade CTA | Red | No |
| PAST_DUE | - | "Payment failed" + update payment CTA | Yellow | No |

### 4. Database Schema

#### SignupEvents Table
```sql
CREATE TABLE SignupEvents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    event_type ENUM(
        'signup_started',
        'signup_completed',
        'trial_started',
        'onboarding_completed',
        'trial_extended',
        'trial_expired',
        'converted_to_paid',
        'churned'
    ) NOT NULL,
    plan VARCHAR(50),
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tenant_event (tenant_id, event_type),
    INDEX idx_event_date (event_type, created_at),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);
```

#### Tenants Table (additions)
```sql
ALTER TABLE Tenants ADD COLUMN last_trial_reminder_at DATETIME NULL;
-- Already has: trial_ends_at, subscription_status, is_onboarded
```

## API Endpoints

### POST /api/onboard (Existing, Enhanced)
**Auth**: Bearer token (JWT from MSAL)  
**Body**: `{ plan: 'pro' | 'business' | 'Essential' | 'enterprise' }`

**What it does**:
1. Verify Bearer token and extract tenant_id, email
2. Create/update Tenant with tier and trial dates (14 days for pro/business)
3. Insert/update User record
4. Insert SignupEvents record (`trial_started` or `signup_completed`)
5. Send welcome email async (fire-and-forget)

**Response**:
```json
{ "success": true, "message": "Onboarding completado exitosamente..." }
```

---

### POST /api/onboard/complete
**Auth**: Bearer token (JWT) + tenant_id in token  
**Body**: None required

**What it does**:
1. Update Tenant SET is_onboarded = TRUE
2. Insert SignupEvents record (`onboarding_completed`)

**Response**:
```json
{ "success": true, "message": "Onboarding marked as complete." }
```

---

### GET /api/cron/trial-expiry
**Auth**: Query param `?secret=$CRON_SECRET`  
**Called by**: Container Apps Job (`trial-expiry`, ver `cron_jobs` en `infra/terraform/environments/prod/terraform.tfvars`)  
**Frequency**: Daily (recommended: 00:00 UTC)

**What it does**:
1. Find `Tenants WHERE subscription_status='TRIAL' AND trial_ends_at < NOW()`
2. For each:
   - UPDATE status='EXPIRED'
   - INSERT SignupEvents `trial_expired`
   - Send "Your trial has ended" email
3. Find `Tenants WHERE trial_ends_at IN [NOW, NOW+2d]` and `last_trial_reminder_at < 24h ago`
4. For each:
   - Send trial reminder email
   - UPDATE last_trial_reminder_at = NOW

**Response**:
```json
{
  "success": true,
  "processed": 42,
  "expired": 3,
  "reminded": 39
}
```

---

### POST /api/superadmin/tenants/extend-trial
**Auth**: `requireSuperAdmin` (JWT + corporate domain + SUPERADMIN system_role)  
**Body**: `{ tenantId: "uuid", days: 14 }`

**What it does**:
1. Validate superadmin access
2. Find Tenant by tenant_id
3. If EXPIRED: set trial_ends_at = NOW + days, status = TRIAL
4. If TRIAL: set trial_ends_at = trial_ends_at + days
5. INSERT SignupEvents `trial_extended` with metadata `{ days, admin_email, was_expired }`

**Response**:
```json
{
  "success": true,
  "message": "Trial extended by 14 days",
  "tenant_id": "...",
  "new_trial_ends_at": "2026-07-13 12:34:56",
  "was_expired": false,
  "status_changed": "no change"
}
```

---

### GET /api/superadmin/funnel
**Auth**: `requireSuperAdmin`  
**Query**: None

**What it does**:
1. Query SignupEvents for last 30 days:
   - Total signups (signup_started, signup_completed, trial_started)
   - Active trials
   - Converted to paid
   - Conversion %
   - Churn %
2. Build funnel stages: signup_started → trial_started → onboarding_completed → converted_to_paid
3. Fetch recent 50 signups with status and days left

**Response**:
```json
{
  "kpis": {
    "signups_30d": 150,
    "trials_active": 45,
    "converted": 12,
    "conversion_pct": "8.00",
    "churn_pct": "2.00"
  },
  "funnel": [
    { "stage": "signup_started", "count": 150 },
    { "stage": "trial_started", "count": 140 },
    { "stage": "onboarding_completed", "count": 80 },
    { "stage": "converted_to_paid", "count": 12 }
  ],
  "recent_signups": [
    {
      "tenant_id": "...",
      "email": "user@example.com",
      "plan": "pro",
      "status": "TRIAL",
      "trial_days_left": 10,
      "created_at": "2026-06-29T12:34:56"
    }
  ]
}
```

## Components

### SignupPageClient (`src/components/SignupPageClient.tsx`)
Public, unauthenticated landing page.
- Hero: "Start your 14-day free trial"
- Plan selector (Essential, Professional, Business, Enterprise)
- Each plan card shows price, features, and "Start free trial" CTA
- Enterprise has "Contact sales" button
- Trust signals row (SOC2, Azure verified, ISO 27001)
- FAQ accordion (4 questions)
- Clicking CTA → stores plan in sessionStorage → MSAL loginRedirect

### TrialBanner (`src/components/TrialBanner.tsx`)
Sticky banner showing trial status.
- Blue (>7d), Yellow (3-7d), Red (≤2d), or none
- Dismissible for 24h (localStorage key: `trial-banner-dismissed`)
- For EXPIRED: non-dismissable red banner
- For PAST_DUE: non-dismissable yellow banner

### TrialStatusCard (`src/components/dashboard/TrialStatusCard.tsx`)
Dashboard widget showing trial countdown and upgrade CTA.
- Only renders if subscription_status === 'TRIAL'
- Shows "X days remaining" and link to /admin/billing

## Pages

### /signup (Public)
- Redirect from root `/signup/page.tsx` to locale-specific `/[locale]/signup`
- Renders `<SignupPageClient />`
- Server component wrapper (no 'use client' in parent, client component extracted)

### /[locale]/superadmin/funnel
- Superadmin-only analytics dashboard
- KPI cards (signups, active trials, converted, conversion %, churn %)
- Funnel visualization (4 stages)
- Recent signups table (last 50)

## Email Templates

### Welcome Email
Subject: "Welcome to FinOps SaaS — Your 14-day trial has started"  
Sent: On first login (onboard API)  
Content: CTA to /overview, list of trial benefits, support email

### Trial Reminder Email
Subject: "Only X day(s) left in your FinOps trial!"  
Sent: Day 12 of trial (cron job), max once per tenant  
Content: CTA to /pricing, benefits list, support email

### Trial Expired Email
Subject: "Your FinOps SaaS trial has ended"  
Sent: Day 14+ (cron job), on expiry  
Content: CTA to /pricing, upgrade benefits, sales/support emails

All templates:
- HTML branded with FinOps colors (blue #0054A6)
- Fire-and-forget (async, no blocking)
- Silently skipped if `AZURE_SENDER_EMAIL` not configured

## Configuration

### Environment Variables Required
```bash
# MSAL
AZURE_TENANT_ID=...
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...

# Email
AZURE_SENDER_EMAIL=noreply@cscloudsolutions.com

# Cron Secret
CRON_SECRET=your-secure-random-string
```

### Cron Setup

**Container Apps Job** (as deployed — `infra/terraform/environments/prod/terraform.tfvars`):
```hcl
cron_jobs = {
  trial-expiry = { cron = "0 22 * * *" } # 01:00 UTC del día siguiente
}
```
El schedule se expresa en la timezone del negocio (`cron_timezone_offset_hours = -3`);
el job hace el GET con el `CRON_SECRET` que lee de Key Vault.

**Local / manual**:
```bash
curl -s "http://localhost:3000/api/cron/trial-expiry?secret=$CRON_SECRET"
```

## Tracking

All events tracked in `SignupEvents` table:

| Event | Trigger | Metadata |
|-------|---------|----------|
| `signup_started` | User clicks "Start Free Trial" on /signup | `plan`, `ip`, `user_agent` |
| `signup_completed` | Manual trial creation (rare) | - |
| `trial_started` | POST /api/onboard (plan is pro/business) | `plan`, `ip` |
| `onboarding_completed` | POST /api/onboard/complete (or manual) | - |
| `trial_extended` | POST /api/superadmin/.../extend-trial | `days`, `admin_email`, `was_expired` |
| `trial_expired` | GET /api/cron/trial-expiry | `trial_ends_at` |
| `converted_to_paid` | Payment processor webhook | `paddle_subscription_id`, `amount` |
| `churned` | Manual admin action (future) | - |

## i18n

Namespace: `signup` (messages/en.json, messages/es.json, messages/pt-BR.json)

Keys:
- `signup.title` - "Start your 14-day free trial"
- `signup.subtitle` - "Connect your Azure subscription..."
- `signup.essential.name`, `.price`, `.monthlyPrice`, etc.
- `signup.professional`, `.business`, `.enterprise` (same structure)
- `signup.faq.title`, `.q1`, `.a1`, etc.

## Testing

### Unit Tests (`__tests__/unit/trialStatus.test.ts`)
Test `getTrialState()` helper:
- TRIAL with 5 days → severity='warning'
- TRIAL with 14 days → severity='info'
- TRIAL with 1 day → severity='critical'
- EXPIRED → expired=true
- ACTIVE → null state
- Null/missing values

### Integration Tests (`__tests__/integration/api-signup.test.ts`)
Mock database + auth, verify:
- POST /api/onboard without auth → 401
- POST /api/onboard with valid token → succeeds
- GET /api/cron/trial-expiry without secret → 401
- GET /api/cron/trial-expiry with secret → processes 0+ (empty mock)
- POST /api/superadmin/.../extend-trial without superadmin → 401
- POST /api/superadmin/.../extend-trial with superadmin → updates trial_ends_at
- GET /api/superadmin/funnel without auth → 401

## Future Enhancements

1. **Trial Extension Button**: Add "Request Extension" CTA in banner for admins
2. **Conversion Tracking**: Wire Paddle webhook to insert `converted_to_paid` event
3. **Churn Recovery**: Send "Come back" email 7 days after expiry for expired trials
4. **A/B Testing**: Track variant in metadata (e.g., `variant: "banner_blue_v1"`)
5. **SMS Reminders**: Optional SMS on day 12 (Twilio integration)
6. **Trial Lock-down**: Auto-disable features on day 13 (read-only mode)

## Troubleshooting

### Email not sending?
- Check `AZURE_SENDER_EMAIL` is configured
- Check Azure App has `Mail.Send` permission
- Check logs for MS Graph API errors (401, 403, 429)

### Trial not expiring?
- Verify cron secret matches `CRON_SECRET` env var
- Verify cron runs with correct frequency (daily)
- Check logs for SQL errors (connection, permissions)

### User doesn't see trial banner?
- Check localStorage: `trial-banner-dismissed` might be blocking
- Clear localStorage manually: `localStorage.clear()`
- Verify tenant.subscription_status === 'TRIAL' and trial_ends_at is in future

### Conversion not tracked?
- Manual upgrade: wire Paddle webhook to insert event
- Trial extend: automatically tracked via SignupEvents

---

**Last Updated**: 2026-06-29  
**Version**: 1.0
