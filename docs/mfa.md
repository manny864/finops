# Two-Factor Authentication (2FA/MFA)

## Overview

The FinOps SaaS implements TOTP-based (Time-based One-Time Password) two-factor authentication for enhanced security. This adds a second verification layer for sensitive operations like approving spend, deleting tenants, or changing billing settings.

## Key Principles

- **Optional per user** - Each user can independently enable/disable 2FA
- **Sensitive operations only** - Not all operations require 2FA, only those marked as sensitive
- **Works with all auth methods** - Compatible with MSAL (Entra ID), SAML (WorkOS), and any future auth providers
- **Recovery codes** - Users get 10 one-time recovery codes that never expire, for emergency access

## How It Works

### Enrollment

1. User navigates to **Admin → Security Settings**
2. Clicks "Enable 2FA"
3. System generates:
   - A unique TOTP secret (Base32 encoded)
   - A QR code for scanning
   - 10 recovery codes for emergency access
4. User scans QR with authenticator app (Google Authenticator, Microsoft Authenticator, Authy, etc.)
5. User enters the 6-digit code from their app to verify
6. System enables MFA and stores the encrypted secret + hashed recovery codes

### Sensitive Operations Flow

When a user attempts a sensitive operation (e.g., delete tenant, cancel subscription):

1. **Client** requests to initiate the operation with `POST /api/mfa/challenge`
2. **Server** checks if user has MFA enabled
   - If **enabled**: Creates a challenge (5-minute expiry), returns `challenge_id`
   - If **not enabled**: Returns 412 Precondition Failed with code `mfa_required`
3. **Client** shows MFA prompt modal
4. **User** enters 6-digit TOTP code or recovery code
5. **Client** calls `POST /api/mfa/verify-challenge` with challenge_id + code
6. **Server** validates code and marks challenge as consumed
7. **Client** retries original request with `X-MFA-Challenge-Id` header
8. **Server** middleware (`requireMfaChallenge`) verifies the header, then proceeds

### Enforcement wiring (opt-in, live)

MFA is **opt-in per user**, so enforcement is gated by the user's own `mfa_enabled`
flag via the helper `enforceMfaIfEnabled(request, email, tenantId, operation, payload)`
in `src/lib/requireMfaChallenge.ts`:

- If the acting user does **not** have 2FA enabled → the operation proceeds normally.
- If the user **has** 2FA enabled → a freshly verified challenge (matching `operation`
  and `payload` hash, consumed < 60s ago) is required, otherwise the route returns 403.

Server routes wired (each captures the caller identity from its existing auth guard and
passes `identity.email` / `identity.tenantId` — the challenge creator, not the target tenant):

| Operation | Route | Guard | Payload bound |
|-----------|-------|-------|---------------|
| `delete_tenant` | `POST/DELETE /api/admin/tenants/delete` | `requireSuperAdmin` | `{ tenantId }` (target) |
| `change_plan` | `PATCH /api/billing/subscription` | `requireTenantRole(['Admin'])` | `{ tenantId }` |
| `cancel_subscription` | `DELETE /api/billing/subscription` | `requireTenantRole(['Admin'])` | `{ tenantId }` |
| `change_billing_config` | `POST /api/admin/billing-markup` | `requireTenantAccess(allowSuperAdmin)` | `{ tenantId }` |

Client side, the reusable hook `useMfaChallenge()` (`src/hooks/useMfaChallenge.tsx`)
orchestrates the flow: it checks `/api/mfa/status`, returns `{ challengeId: null }` when
2FA is off (proceed), or opens `MfaPromptModal` and resolves `{ challengeId }` after the
user verifies. Callers attach `X-MFA-Challenge-Id: <challengeId>` to the operation request.
Wired into: `DeleteTenantModal`, `admin/billing/page.tsx` (upgrade + cancel), `PartnerMarkup`.


### Security Details

- **Secret storage**: TOTP secrets encrypted with AES-256-GCM, key from `MFA_ENCRYPTION_KEY` env
- **Recovery codes**: Bcrypt-hashed (10 rounds), one hash per code
- **Challenge expiry**: 5 minutes from creation
- **Verification window**: ±30 seconds (standard for TOTP)
- **Recovery code burn**: Once used, a recovery code is removed from the list and cannot be reused

## API Endpoints

### POST /api/mfa/enroll/start
Requires auth. Initiates 2FA enrollment.

**Response:**
```json
{
  "qrCodeDataUrl": "data:image/png;base64,...",
  "manualSecret": "JBSWY3DPEHPK3PXP",
  "recoveryCodes": ["ABC1234567", "DEF7890123", ...]
}
```

### POST /api/mfa/enroll/verify
Requires auth. Verifies TOTP token and enables MFA.

**Body:**
```json
{
  "token": "123456"
}
```

**Response:**
```json
{
  "enabled": true
}
```

### POST /api/mfa/disable
Requires auth. Disables MFA (requires valid TOTP token or recovery code).

**Body:**
```json
{
  "token": "123456"
}
```
or
```json
{
  "recoveryCode": "ABC1234567"
}
```

### POST /api/mfa/challenge
Requires auth. Initiates an MFA challenge for a sensitive operation.

**Body:**
```json
{
  "operation": "delete_tenant",
  "payload": { "tenant_id": "xyz" }
}
```

**Success Response (MFA enabled):**
```json
{
  "challenge_id": "uuid"
}
```

**Error Response (MFA not enabled):**
```json
{
  "error": {
    "code": "mfa_required",
    "message": "MFA is required for this operation"
  },
  "mfa_enrollment_required": true
}
```

### POST /api/mfa/verify-challenge
Requires auth. Verifies an MFA challenge.

**Body:**
```json
{
  "challenge_id": "uuid",
  "token": "123456"
}
```
or
```json
{
  "challenge_id": "uuid",
  "recovery_code": "ABC1234567"
}
```

**Response:**
```json
{
  "verified": true
}
```

## Using MFA in Sensitive Operations

To protect a sensitive endpoint with MFA:

1. **Call challenge endpoint first:**
```typescript
const res = await fetch('/api/mfa/challenge', {
  method: 'POST',
  body: JSON.stringify({
    operation: 'delete_tenant',
    payload: { tenant_id: '...' }
  })
});

if (res.status === 412) {
  // User doesn't have MFA, prompt enrollment
  return;
}

const { challenge_id } = await res.json();
```

2. **Show MFA prompt (use MfaPromptModal component):**
```tsx
<MfaPromptModal
  open={showMfa}
  operation="delete_tenant"
  payload={{ tenant_id: '...' }}
  onVerified={(challengeId) => {
    // Now retry original request with MFA header
    retryDeleteTenant(challengeId);
  }}
  onCancel={() => setShowMfa(false)}
/>
```

3. **Retry operation with challenge header:**
```typescript
const response = await fetch('/api/admin/tenants/xyz/delete', {
  method: 'DELETE',
  headers: {
    'X-MFA-Challenge-Id': challengeId
  }
});
```

4. **Protect endpoint with requireMfaChallenge:**
```typescript
import { requireMfaChallenge } from '@/lib/requireMfaChallenge';

export async function DELETE(request: NextRequest) {
  const identity = await requireRequestIdentity(request);
  
  const tenantId = 'xyz';
  
  // Check MFA challenge
  await requireMfaChallenge(
    request,
    identity.email,
    identity.tenantId,
    'delete_tenant',
    { tenant_id: tenantId }
  );
  
  // Safe to proceed - MFA was verified
  // ...
}
```

## Recovery Flow

If a user loses access to their authenticator app:

1. They can use any of their recovery codes
2. Recovery codes are shown only once during enrollment (must download)
3. Each code can only be used once
4. After using all 10 codes, user must disable MFA and re-enable to get new codes
5. Admins can force disable MFA for a user (audit logged)

## Environment Configuration

Required in `.env.development` and `.env.production`:

```env
# 32 bytes hex (64 characters)
MFA_ENCRYPTION_KEY=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
```

Generate a secure key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Database Schema

### Users table additions
- `mfa_enabled` (BOOLEAN) - Whether MFA is active for this user
- `mfa_secret_encrypted` (TEXT) - AES-256-GCM encrypted TOTP secret + IV + auth tag (JSON)
- `mfa_recovery_codes_hash` (JSON) - Array of bcrypt hashes of recovery codes
- `mfa_last_used_at` (DATETIME) - Timestamp of last successful MFA verification

### MfaChallenges table
- `id` (VARCHAR 64) - Challenge UUID
- `user_email` (VARCHAR 255) - User's email
- `tenant_id` (VARCHAR 255) - Tenant ID
- `operation` (VARCHAR 100) - Operation name (e.g., 'delete_tenant')
- `payload_hash` (CHAR 64) - SHA256 hash of operation payload
- `expires_at` (DATETIME) - Challenge expiration time
- `consumed_at` (DATETIME NULL) - When challenge was verified (NULL if not yet verified)
- `created_at` (TIMESTAMP) - Creation timestamp

## Testing

```bash
# Unit tests
npm run test -- __tests__/unit/mfa.test.ts

# Integration tests
npm run test -- __tests__/integration/api-mfa.test.ts

# All tests
npm run test
```

## Roadmap

- [ ] Admin force-disable MFA for users (with audit trail)
- [ ] MFA enforcement policies (per-tenant or global)
- [ ] Backup codes management UI
- [ ] SMS-based 2FA (future)
- [ ] WebAuthn/FIDO2 support (future)
