# Legal & Compliance (DPA/SOC2/Trust Center)

## Overview

This document describes the legal and compliance features added to the FinOps SaaS platform to support Enterprise customers requiring GDPR compliance, DPA signatures, and SOC 2 evidence.

## Architecture

### Public Legal Pages

All legal pages are **public** (no authentication required) and reachable at:

- `/{locale}/legal/privacy` - Privacy Policy
- `/{locale}/legal/terms` - Terms of Service
- `/{locale}/legal/dpa` - Data Processing Agreement (GDPR Art. 28)
- `/{locale}/legal/security` - Security & Trust Center
- `/{locale}/legal/subprocessors` - Subprocessor List

**Locale-agnostic redirects** exist at:
- `/legal/privacy` → `/es/legal/privacy` (default locale)
- `/legal/terms` → `/es/legal/terms`
- `/legal/dpa` → `/es/legal/dpa`
- `/legal/security` → `/es/legal/security`
- `/legal/subprocessors` → `/es/legal/subprocessors`

### Components

#### PublicFooter (`src/components/PublicFooter.tsx`)

A footer component displayed on:
- All authenticated pages (via ClientShell)
- Legal pages
- Pricing/signup pages

Links:
- Privacy Policy
- Terms of Service
- DPA
- Security & Trust Center
- Subprocessors
- Status Page

#### CookieConsent (`src/components/CookieConsent.tsx`)

A client-side banner component that:
1. Shows on first visit (checks `localStorage.cookie_consent_v1`)
2. Allows users to accept all cookies or essential-only
3. Persists choice to localStorage
4. Never shows again until localStorage is cleared

## Database Schema

### LegalAcceptances Table

```sql
CREATE TABLE IF NOT EXISTS LegalAcceptances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    document_type ENUM('dpa','terms','privacy') NOT NULL,
    document_version VARCHAR(50) NOT NULL,
    accepted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    user_agent TEXT,
    UNIQUE KEY uq_tenant_doc (tenant_id, document_type, document_version),
    INDEX idx_tenant (tenant_id)
);
```

**Purpose**: Tracks which legal documents have been signed/accepted by which tenants.

**Key features**:
- Unique constraint ensures one acceptance record per tenant/document/version combo
- IP address and user agent captured for audit trail
- Timestamps for compliance records

## API Endpoints

### POST /api/legal/sign

Sign a legal document. Requires tenant role (Owner/Admin).

**Request**:
```json
{
  "documentType": "dpa",
  "tenantId": "tenant-123"
}
```

**Response** (200):
```json
{
  "accepted_at": "2026-06-29T15:30:00Z",
  "documentType": "dpa",
  "documentVersion": "1.0-2026-06-29"
}
```

**Errors**:
- 400: Invalid documentType or missing tenantId
- 401: No authorization header
- 403: User lacks required role

### GET /api/legal/sign

Check if a legal document has been signed. Requires tenant access.

**Query params**:
- `tenantId`: Tenant ID (required)
- `documentType`: Document type - `dpa`, `terms`, or `privacy` (required)

**Response** (200):
```json
{
  "accepted": true,
  "accepted_at": "2026-06-29T15:30:00Z",
  "documentType": "dpa",
  "documentVersion": "1.0-2026-06-29"
}
```

Or:
```json
{
  "accepted": false,
  "documentType": "dpa",
  "documentVersion": "1.0-2026-06-29"
}
```

### POST /api/admin/compliance/request-soc2

Request a SOC 2 Type II audit report. Requires tenant admin/owner role.

**Request**:
```json
{
  "tenantId": "tenant-123",
  "company_name": "Acme Corp"
}
```

**Response** (200):
```json
{
  "success": true,
  "message": "SOC 2 report request submitted",
  "requested_at": "2026-06-29T15:30:00Z",
  "tenantId": "tenant-123"
}
```

## Admin Pages

### /[locale]/admin/compliance

Admin compliance dashboard showing:

1. **Document Acceptance Status**: Shows current versions and acceptance status for DPA, Terms, Privacy Policy
2. **Download Documents**: Links to audit logs, subprocessor list, etc.
3. **Request SOC 2 Report**: Form to request SOC 2 Type II audit report
4. **Compliance Roadmap**: Shows status of GDPR ✓, SOC 2 (Q4 2026), ISO 27001 (2026)

## Legal Document Versions

Managed via `src/lib/legalVersions.ts`:

```typescript
export const LEGAL_VERSIONS = {
  privacy: "1.0-2026-06-29",
  terms: "1.0-2026-06-29",
  dpa: "1.0-2026-06-29",
};
```

### Version Bump Process

1. Update version string in `legalVersions.ts`
2. Update actual document content in corresponding page component
3. Commit change
4. Existing acceptances remain valid; only new acceptances require new version
5. To force re-acceptance, bump version and notify customers

### Acceptance Flow

1. Customer views `/[locale]/legal/dpa` page
2. If Enterprise tier, shows "Sign DPA" button
3. Customer clicks button → calls `POST /api/legal/sign`
4. Backend validates auth, stores acceptance with IP/UA
5. Page shows "✓ Signed by john@acme.com on 2026-06-29"
6. Next login, admin sees acceptance status in `/admin/compliance`

## Content Guidelines

### Placeholder Content

All legal documents contain `[LEGAL REVIEW PENDING]` banners prominently displayed. This content **is not binding** and must be reviewed by qualified legal counsel before production use.

### Key Sections Per Document

**Privacy Policy**:
- Data Collection (Azure cost data, user emails, tenant IDs)
- How We Use It (service delivery, platform improvement, security)
- Subprocessors (list + links)
- Data Retention (90d telemetry, indefinite billing, 7y audit logs)
- GDPR Rights (Art. 15-22: access, rectification, erasure, etc.)
- International Transfers (SCCs + supplementary measures)
- Contact (privacy@cscloudsolutions.com.ar)

**Terms of Service**:
- Acceptance
- Service Description
- Acceptable Use
- IP Rights
- Warranties (AS-IS)
- Liability Limitation
- Indemnification
- Trial & Subscription Terms
- Termination
- Governing Law (Argentina / Buenos Aires)

**DPA**:
- Definitions (Controller/Processor/Personal Data)
- Subject Matter & Duration
- Data Subject Categories & Personal Data Categories
- Subprocessors (with 30-day objection period)
- Data Subject Rights (assistance)
- Security Measures (encryption, RBAC, monitoring, audit logs)
- Audit Rights
- Return/Deletion of Data
- Annex 1: Subprocessor Table
- Annex 2: Technical & Organizational Measures (TOMs)

**Security & Trust Center**:
- Compliance Badges (GDPR ✓, SOC 2 in progress, Azure certified, ISO 27001 planned)
- Encryption (TLS 1.2+ transit, AES-256 rest)
- Access Control (RBAC, MSAL, SAML SSO)
- Infrastructure (Azure primary, geo-redundant DB, RTO < 4h)
- Audit & Monitoring (7-year logs, real-time monitoring, annual pen tests)
- Subprocessors
- Incident Response (2h investigation, 72h notification)
- Download Documents section
- FAQ

**Subprocessors**:
- Table: Name, Purpose, Locations, DPA status
- Detailed cards for each processor
- Change Notification Policy (30-day advance, right to object)
- Contact & Related Documents links

## Testing

### Integration Tests

Located in `__tests__/integration/api-legal.test.ts`:

```bash
npm run test -- api-legal.test.ts
```

Tests cover:
- Database schema and constraints
- Version format validation
- Acceptance record storage and retrieval
- Unique constraint enforcement
- Authentication requirements

### Manual Testing Checklist

1. **Legal Pages Accessible**:
   - [ ] Navigate to `/legal/privacy` → redirects to `/es/legal/privacy`
   - [ ] All legal pages render without errors
   - [ ] Footer appears on all pages with correct links
   - [ ] Each page has legal review banner

2. **Cookie Consent**:
   - [ ] Banner appears on first visit
   - [ ] Clicking "Accept All" / "Essential Only" persists to localStorage
   - [ ] Banner does not reappear after acceptance
   - [ ] Can clear localStorage and banner reappears

3. **DPA Signing (Authenticated)**:
   - [ ] Admin user navigates to `/admin/compliance`
   - [ ] Views DPA acceptance status
   - [ ] Clicks "View DPA"
   - [ ] DPA page has "Sign DPA" button
   - [ ] Clicking button calls `/api/legal/sign` (success)
   - [ ] Button changes to show signed date + user
   - [ ] Refresh page → status persists

4. **API Endpoints**:
   - [ ] POST `/api/legal/sign` without auth → 401
   - [ ] POST with invalid documentType → 400
   - [ ] POST with valid auth + documentType → 200 + acceptance_at
   - [ ] GET `/api/legal/sign?tenantId=X&documentType=dpa` → returns acceptance status

## Compliance Roadmap

### ✓ Completed

- GDPR Privacy Policy + DPA + Data Subject Rights
- Cookie Consent Banner
- Subprocessor Tracking
- Audit Logs (7-year retention)
- Public Trust Center
- Admin Compliance Dashboard

### Q4 2026 (In Progress)

- SOC 2 Type II Audit
- Pen Testing Report
- Incident Response Playbook

### 2026 (Planned)

- ISO 27001 Certification

## Support

For questions regarding legal compliance, contact:
- **Privacy Officer**: privacy@cscloudsolutions.com.ar
- **Support**: support@cscloudsolutions.com.ar

## References

- GDPR Articles 28-32 (Data Processing, Security)
- Standard Contractual Clauses (SCCs)
- SOC 2 Trust Service Principles (AICPA)
- ISO 27001:2022 Information Security Management
