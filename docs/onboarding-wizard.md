# Onboarding Wizard Documentation

## Overview

The **Linear Onboarding Wizard** is a guided step-by-step experience for new CSCloud FinOps SaaS tenants. It guides users through essential setup tasks with visual progress indicators and persistent storage per tenant.

The wizard is automatically launched after first login if `Tenants.is_onboarded = 0` and is accessible via `/{locale}/onboarding`.

---

## Architecture

### Database Schema

**OnboardingProgress** table stores progress per tenant:

```sql
CREATE TABLE OnboardingProgress (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL UNIQUE,
    step_welcome ENUM('pending','in_progress','completed','skipped'),
    step_azure_sp ENUM('pending','in_progress','completed','skipped'),
    step_first_sync ENUM('pending','in_progress','completed','skipped'),
    step_first_budget ENUM('pending','in_progress','completed','skipped'),
    step_notifications ENUM('pending','in_progress','completed','skipped'),
    completed_at DATETIME NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);
```

### API Endpoints

#### 1. **GET /api/onboarding/progress**
Retrieves current onboarding progress for the authenticated tenant.

**Response:**
```json
{
    "tenant_id": "tenant-123",
    "step_welcome": "completed",
    "step_azure_sp": "in_progress",
    "step_first_sync": "pending",
    "step_first_budget": "pending",
    "step_notifications": "pending",
    "completed_at": null,
    "percent_complete": 20
}
```

**Status codes:**
- `200`: Success (returns defaults for new tenants)
- `401`: Unauthorized (requires ADMIN role)
- `500`: Server error

#### 2. **PUT /api/onboarding/progress**
Updates a specific step's status.

**Request body:**
```json
{
    "step": "step_welcome",
    "status": "completed"
}
```

**Valid steps:**
- `step_welcome`
- `step_azure_sp`
- `step_first_sync`
- `step_first_budget`
- `step_notifications`

**Valid statuses:**
- `pending` — Not started
- `in_progress` — Currently active
- `completed` — Finished successfully
- `skipped` — User skipped the step

**Response:** Updated progress object with `percent_complete`

**Status codes:**
- `200`: Success
- `400`: Invalid step name or status
- `401`: Unauthorized
- `500`: Server error

#### 3. **POST /api/onboarding/finish**
Marks onboarding complete, sets `Tenants.is_onboarded = 1`, and fires `SignupEvents.onboarding_completed`.

**Request body:** (empty)

**Response:**
```json
{
    "success": true,
    "message": "Onboarding completed."
}
```

**Transaction behavior:**
- Marks all pending/in_progress steps as `completed`
- Preserves skipped steps
- Updates `is_onboarded = 1` on Tenants table
- Inserts SignupEvent `onboarding_completed`
- Rolls back on any error

**Status codes:**
- `200`: Success
- `401`: Unauthorized
- `500`: Server error

---

## Frontend Flow

### 5 Linear Steps

#### **Step 1: Welcome & Company Info**
- **Title:** "Welcome & Company Info"
- **Description:** "Confirm your company details and preferences"
- **Form fields:**
  - Company Name (text)
  - Primary Cloud Provider (select: Azure, AWS coming soon)
  - Currency (select: USD, EUR, GBP)
  - Timezone (select: UTC, EST, CST, PST)
- **Actions:** Start → Continue / Skip
- **Behavior:** Can be completed, skipped, or come back later

#### **Step 2: Connect Azure Subscription**
- **Title:** "Connect Azure Subscription"
- **Description:** "Provide your Service Principal credentials"
- **Form fields:**
  - Client ID (text, monospace)
  - Client Secret (password)
  - Azure Tenant ID (text, monospace)
- **Action button:** "Validate" (calls `/api/admin/diagnose-sp`)
- **Validation display:** Shows green checkmarks for required permissions or red error
- **Behavior:** Auto-advances to Step 3 on success, or allow skip

#### **Step 3: Run First Data Sync**
- **Title:** "Run First Data Sync"
- **Description:** "Sync your first set of cost data from Azure"
- **Action button:** "Run Sync" (calls `/api/admin/sync/trigger`)
- **During sync:** Shows spinner + "Syncing your data..." (up to 60s)
- **On complete:** Auto-advances to Step 4 or allow skip

#### **Step 4: Create Your First Budget**
- **Title:** "Create Your First Budget"
- **Description:** "Set up a budget to track spending"
- **Form fields:**
  - Budget Name (text)
  - Monthly Limit ($) (number, step=100)
  - Alert Threshold (%) (number, 0-100)
- **Action button:** "Create Budget" (calls `/api/intelligence/budgets`)
- **Behavior:** On success, auto-advance to Step 5 or allow skip

#### **Step 5: Set Up Notifications**
- **Title:** "Set Up Notifications"
- **Description:** "Configure how you want to receive alerts"
- **Action button:** "Configure" (opens `/admin/notifications` in new tab)
- **Explanation:** "Add at least one notification channel to receive budget alerts"
- **Behavior:** User manually completes in notifications page, then returns

### UI Components

**WizardLayout** (`src/components/onboarding/WizardLayout.tsx`)
- Full-page container
- Header with title + skip link
- Progress bar (%) with animated fill
- Content area

**WizardStep** (`src/components/onboarding/WizardStep.tsx`)
- Step card with status indicator
  - Green check: completed
  - Blue spinner: in_progress
  - Yellow warning: skipped
  - Gray dot: pending
- Title + description
- Action area (shows/hides based on active state)
- Dynamic button labels ("Start", "Continue", "Validate", etc.)

### Status Indicators

| Status | Icon | Color | Meaning |
|--------|------|-------|---------|
| `pending` | ⚪ Dot | Gray | Not yet started |
| `in_progress` | 🔄 Spinner | Blue | Currently working on |
| `completed` | ✅ Check | Green | Done successfully |
| `skipped` | ⚠️ Warning | Yellow | User skipped this step |

### Progress Percentage

Calculated as: `(completed + skipped) / 5 * 100`

All steps (completed or skipped) count toward 100%.

---

## Auto-Redirect from Homepage

**File:** `src/app/[locale]/page.tsx`

On mount, if:
- Tenant is not default
- `Tenants.is_onboarded = 0` or `false`
- User is authenticated

Then: Redirect to `/{locale}/onboarding`

**Implemented via:**
- `useRef` to prevent multiple redirects on re-render
- Single check on first mount
- No polling loop

---

## Existing Compatibility

### Preserved Features
- `/admin/onboarding` page remains unchanged (advanced setup form)
- All existing endpoints and tables untouched
- New wizard links to advanced setup as fallback

### Endpoint Reuse
- `/api/admin/diagnose-sp` — SP credential validation (already exists)
- `/api/admin/sync/trigger` — Sync trigger (minimal wrapper if needed)
- `/api/intelligence/budgets` — Budget creation (already exists)
- `/api/onboard/complete` — Completion endpoint (refactored for new finish endpoint)

---

## Customization

### Adding a New Step

1. Add a new step column to `OnboardingProgress`:
   ```sql
   ALTER TABLE OnboardingProgress ADD COLUMN step_custom ENUM('pending','in_progress','completed','skipped') DEFAULT 'pending';
   ```

2. Update `computePercent()` in API routes to include the new step.

3. Add a new `<WizardStep>` component in the page with appropriate form fields.

4. Call `updateStepStatus('step_custom', status)` when needed.

### Changing Step Order

- Reorder the `<WizardStep>` components in `/src/app/[locale]/onboarding/page.tsx`
- Update step numbers in the `stepNumber` prop
- No database changes needed

### Disabling the Wizard

Set environment variable `NEXT_PUBLIC_DISABLE_ONBOARDING_WIZARD=true` and modify the redirect check in `page.tsx`.

---

## Testing

### Unit Tests
**File:** `__tests__/unit/onboardingPercent.test.ts`

Tests the percentage calculation logic:
- All pending = 0%
- Mix of completed/pending = proportional %
- All completed/skipped = 100%

### Integration Tests
**File:** `__tests__/integration/api-onboarding.test.ts`

Tests the API endpoints:
- GET progress without auth → 401
- GET progress for nonexistent tenant → returns defaults
- PUT with invalid step → 400
- PUT with valid step → 200 + updated row
- POST finish → sets is_onboarded=1
- POST finish → fires SignupEvents.onboarding_completed
- POST finish with error → rollback transaction

**Run tests:**
```bash
npx vitest run __tests__/integration/api-onboarding.test.ts __tests__/unit/onboardingPercent.test.ts
```

---

## Error Handling

### User-Facing Errors
- Invalid SP credentials → Show error message + allow retry
- Sync failure → Allow skip + show error toast
- Budget creation failure → Allow retry or skip
- Network errors → Show generic error, allow retry

### Database Errors
- All transaction errors automatically rollback
- Error details logged server-side
- Generic 500 response sent to client

### Auth Errors
- Missing/invalid token → 401 Unauthorized
- Wrong tenant → 403 Forbidden
- Role mismatch → 403 Forbidden

---

## Performance Considerations

### Database Indexes
The `OnboardingProgress.tenant_id UNIQUE` index enables fast lookups.

### API Calls
- Progress fetch: Single query on page load
- Each step update: Single PUT request + INSERT IGNORE if needed
- Finish: Batched into single transaction

### Frontend
- No polling; updates only on user action
- No unnecessary re-renders (components are client-side)
- Lazy-loads progress data on mount

---

## Future Enhancements

1. **Multi-tenant workflows:** Allow team members to complete steps concurrently
2. **Step dependencies:** Mark some steps as dependent on others
3. **Conditional steps:** Show/hide steps based on user tier or cloud provider
4. **Email notifications:** Send completion summary email
5. **Onboarding analytics:** Track time spent per step, drop-off rates
6. **Video tutorials:** Embed step-by-step video guidance
7. **Expert assistance:** One-click scheduling for onboarding call

---

## Related Docs

- **API v1:** `docs/api-v1.md`
- **Signup Funnel:** `docs/signup-trial-funnel.md`
- **Notifications:** `docs/notifications.md`
- **Testing:** `docs/testing.md`
- **QA Checklist:** `docs/qa-checklist.md` (item 29)
