# Data Residency

## Overview

CSCloud Solutions provides data residency selection for Enterprise customers. This feature allows tenants to declare their preferred region for data storage, supporting compliance with regulations like GDPR, CCPA, and regional data protection laws.

## Current Implementation

**Important: This is currently a logical/declared residency system, NOT physical isolation.**

### What is Implemented

- **Per-Tenant Region Preference:** Each tenant can declare their preferred region (EU, US, LATAM, APAC, or Global)
- **Audit Logging:** All region changes are logged in the `DataResidencyChanges` table with:
  - Changed by (user email/OID)
  - From/to region
  - Optional reason
  - Timestamp
- **Locking Mechanism:** Tenants can permanently lock their region selection (requires support unlock)
- **ActionLogs Integration:** Region changes are recorded in ActionLogs for compliance auditing
- **Admin UI:** Enterprise customers can manage their region preference via `/admin/data-residency`

### Current Data Flow

```
Tenant Select Region
        ↓
PUT /api/admin/data-residency
        ↓
Validate Region + Auth
        ↓
Update Tenants.data_residency
        ↓
Record in DataResidencyChanges (audit)
        ↓
Insert ActionLogs entry
        ↓
Single MySQL Pool (All regions route here today)
```

## Supported Regions

| Region | Compliance | Subprocessor Locations |
|--------|-----------|----------------------|
| **EU** | GDPR, NIS2 | Azure (Netherlands), AWS (Frankfurt), Google Cloud (Belgium) |
| **US** | CCPA, HIPAA (BAs) | AWS (us-east-1), Azure (East US 2), Google Cloud (South Carolina) |
| **LATAM** | LGPD (Brazil), local laws | AWS (São Paulo), Azure (Brazil South) |
| **APAC** | PDPA (Thailand), local | AWS (Singapore), Azure (Singapore), Google Cloud (Tokyo) |
| **GLOBAL** | Default multi-region | All major cloud providers |

## Database Schema

### Tenants Table (New Columns)

```sql
ALTER TABLE Tenants 
ADD COLUMN data_residency ENUM('EU','US','LATAM','APAC','GLOBAL') DEFAULT 'GLOBAL',
ADD COLUMN data_residency_locked_at DATETIME NULL;
```

### DataResidencyChanges Table

```sql
CREATE TABLE DataResidencyChanges (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    changed_by VARCHAR(255) NOT NULL,
    from_region VARCHAR(20),
    to_region VARCHAR(20) NOT NULL,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tenant (tenant_id)
);
```

## API Endpoints

### GET /api/admin/data-residency

Fetch current residency info for a tenant.

**Query Parameters:**
- `tenantId` (required): Tenant ID

**Authentication:** Requires tenant access

**Response:**
```json
{
  "region": "EU",
  "locked_at": null,
  "can_change": true,
  "available_regions": ["EU", "US", "LATAM", "APAC", "GLOBAL"]
}
```

### PUT /api/admin/data-residency

Update tenant's data residency region.

**Query Parameters:**
- `lock` (optional, boolean): If `true`, also lock the region after change

**Authentication:** Requires OWNER role for the tenant

**Request Body:**
```json
{
  "tenantId": "tenant-id",
  "region": "EU",
  "reason": "GDPR compliance requirement"
}
```

**Responses:**
- `200 OK`: Region updated
- `400 Bad Request`: Invalid region or missing parameters
- `401/403 Unauthorized`: Auth failure
- `423 Locked`: Region is locked

### POST /api/admin/data-residency/lock

Lock a tenant's region permanently.

**Authentication:** Requires SUPERADMIN role

**Request Body:**
```json
{
  "tenantId": "tenant-id"
}
```

### POST /api/admin/data-residency/unlock

Unlock a tenant's region (CSCloudSolutions support only).

**Authentication:** Requires SUPERADMIN role

**Request Body:**
```json
{
  "tenantId": "tenant-id"
}
```

## Pool Abstraction (`regionPool.ts`)

The `regionPool` module provides an abstraction layer for future multi-region routing:

```typescript
import { getTenantPool, resolveTenantPool } from '@/modules/storage/regionPool';

// Get pool for a specific region
const pool = getTenantPool('EU');

// Resolve tenant's declared region and get appropriate pool
const { pool, region } = await resolveTenantPool('tenant-id');
```

### Future Multi-Region Routing

When we scale to true multi-region deployments:

1. Replace pool references in `POOL_BY_REGION` map:
   ```typescript
   import poolEu from "./db-eu";
   import poolUs from "./db-us";
   const POOL_BY_REGION = {
       EU: poolEu,
       US: poolUs,
       // ...
   };
   ```

2. Update all queries to use `resolveTenantPool(tenantId)` instead of the global pool
3. No UI or API changes required—the abstraction handles routing

## Compliance & Audit Trail

### What We Track

- **Region Declaration:** Stored in `Tenants.data_residency`
- **Change History:** Logged in `DataResidencyChanges` with timestamp, user, and reason
- **Locking:** Timestamp in `Tenants.data_residency_locked_at` prevents accidental changes
- **System Events:** ActionLogs records (type: `DATA_RESIDENCY_CHANGED`, `DATA_RESIDENCY_LOCKED`, `DATA_RESIDENCY_UNLOCKED`)

### Export Compliance Data

Tenants can request a compliance report showing:
1. Current declared region
2. Region change history (CSV export from `DataResidencyChanges`)
3. Subprocessor locations by region
4. DPA status for each subprocessor

## Roadmap

### Q1 2026 (Current)
- ✅ Declared region storage
- ✅ Audit logging & locking
- ✅ Admin UI
- ✅ API endpoints

### Q2 2026
- [ ] Multi-region database deployment (EU, US, LATAM, APAC)
- [ ] Region-based routing (replacing single pool)
- [ ] Per-region backup policies
- [ ] Data residency compliance reports

### Q3 2026+
- [ ] True data localization (encrypt in-transit between regions)
- [ ] Regional authentication endpoints
- [ ] Granular RBAC by region
- [ ] DLP (Data Loss Prevention) policies per region

## Security Considerations

1. **Region Locking:** Once locked, only CSCloudSolutions support (SUPERADMIN) can unlock
2. **Audit Trail:** All changes logged with user identity and timestamp
3. **Validation:** Region values strictly validated against enum on both API and DB
4. **RBAC:** Only tenant OWNER role can change region
5. **Transaction Safety:** Region changes use database transactions to ensure consistency

## Limitations (Current State)

⚠️ **Physical vs. Logical Isolation:**

- Today: All regions use the same MySQL deployment
- Declared region is a **compliance/audit signal**, not a **technical guarantee**
- Subprocessor selection happens at deployment time, not per-tenant
- True geographic isolation requires separate database clusters (planned Q2 2026)

## Tenant Communication

### For Marketing/Sales
"We respect your data residency preferences. Select your preferred region (EU/US/LATAM/APAC) for regulatory compliance. As we scale, data will be routed to your chosen region."

### For Support/Documentation
"Data residency selection is available for Enterprise customers. Your declared region is audited and locked once confirmed. Contact support to manage region settings."

## Testing

### Unit Tests
```bash
npm test -- __tests__/unit/regionPool.test.ts
```

Tests verify:
- `getTenantPool()` returns correct pool for each region
- Fallback to GLOBAL for undefined/invalid regions
- Case-insensitive region codes

### Integration Tests
```bash
npm test -- __tests__/integration/api-data-residency.test.ts
```

Tests verify:
- GET returns current region + lock status
- PUT validates region enum + rejects locked tenants
- Lock/unlock operations with proper auth
- Audit log creation

## References

- [Data Residency Admin Page](/admin/data-residency)
- [Subprocessors List](/legal/subprocessors)
- [Data Processing Agreement](/legal/dpa)
- [Security & Trust](/legal/security)
