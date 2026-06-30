# Audit Log System

## Overview

The audit log system tracks all user actions within the FinOps application, providing a comprehensive historical record for compliance, security, and operational auditing. This document explains the schema, API, and best practices for SOC2 readiness.

## Database Schema

### ActionLogs Table

```sql
CREATE TABLE ActionLogs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
)
```

**Columns:**
- `id`: Unique identifier for each log entry.
- `tenant_id`: The tenant (customer) ID performing the action.
- `user_email`: Email of the user who performed the action.
- `action_type`: Type of action (e.g., `CREATE`, `UPDATE`, `DELETE`, `READ`, `EXPORT`).
- `resource_id`: Identifier of the resource affected by the action.
- `status`: Result of the action (`SUCCESS`, `FAILURE`).
- `timestamp`: ISO 8601 datetime when the action occurred (UTC).

## API Endpoints

### 1. GET /api/admin/audit

Retrieve audit logs with filtering, pagination, and multiple export formats.

**Authentication:** Bearer token via `Authorization` header. User must have access to the tenant.

**Query Parameters:**
- `tenantId` (required): The tenant ID to fetch logs for.
- `user_email` (optional): Filter by user email (LIKE %x%).
- `action_type` (optional): Filter by action type (exact match).
- `status` (optional): Filter by status (exact match).
- `from` (optional): Filter by start date (ISO 8601).
- `to` (optional): Filter by end date (ISO 8601).
- `limit` (optional, default: 100, max: 1000): Number of results per page.
- `offset` (optional, default: 0): Number of results to skip.
- `format` (optional, default: json): Response format (`json`, `csv`, `ndjson`).

**Response (JSON):**
```json
{
  "logs": [
    {
      "id": 1,
      "timestamp": "2024-01-15T10:30:45Z",
      "user_email": "john.doe@example.com",
      "action_type": "CREATE",
      "resource_id": "subscription/abc123",
      "status": "SUCCESS"
    }
  ],
  "total": 250,
  "limit": 10,
  "offset": 0,
  "hasMore": true
}
```

**Examples:**

```bash
# Get first 10 logs as JSON
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:3000/api/admin/audit?tenantId=tenant-123&limit=10&offset=0"

# Filter by user and export as CSV
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:3000/api/admin/audit?tenantId=tenant-123&user_email=john&format=csv" \
  > audit.csv

# Filter by date range and status
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:3000/api/admin/audit?tenantId=tenant-123&from=2024-01-01&to=2024-01-31&status=FAILURE&format=json"

# Export as NDJSON (one JSON object per line)
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:3000/api/admin/audit?tenantId=tenant-123&format=ndjson" \
  > audit.ndjson
```

**Export Formats:**

- **JSON**: Standard JSON response with pagination metadata.
- **CSV**: RFC 4180 compliant CSV. Header: `id,timestamp,user_email,action_type,resource_id,status`. Commas, quotes, and newlines are properly escaped.
- **NDJSON**: Newline-delimited JSON (one log per line). Useful for streaming large datasets.

### 2. GET /api/admin/audit/export

Stream the complete audit log history for a tenant (no pagination limit, up to 100k rows).

**Authentication:** Bearer token. User must be an ADMIN or OWNER of the tenant.

**Query Parameters:**
Same as `/api/admin/audit`, but `format` is always `csv`. No `limit` or `offset` parameters.

**Response:** Streaming CSV with `Content-Disposition: attachment`.

**Examples:**

```bash
# Full export with filters
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:3000/api/admin/audit/export?tenantId=tenant-123&from=2024-01-01&to=2024-12-31" \
  > audit-full-2024.csv
```

## Use Cases

### SOC2 Compliance

**Export full audit history for a compliance period:**

```bash
# Export all logs for a 3-month audit period
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:3000/api/admin/audit/export?tenantId=tenant-123&from=2024-01-01&to=2024-03-31" \
  > compliance-audit-q1-2024.csv
```

The resulting CSV can be:
1. Parsed by compliance tools (OKTA, Drata, etc.)
2. Uploaded to audit repositories
3. Analyzed for security patterns (failed logins, privilege escalation, etc.)

### Security Incident Investigation

**Find all failed actions by a user:**

```bash
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:3000/api/admin/audit?tenantId=tenant-123&user_email=suspicious@example.com&status=FAILURE&format=json"
```

### Operational Monitoring

**Check recent DELETE operations:**

```bash
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:3000/api/admin/audit?tenantId=tenant-123&action_type=DELETE&from=2024-01-14&format=csv"
```

## CSV Format Details

The CSV format follows RFC 4180:
- Fields containing commas, quotes, or newlines are wrapped in double quotes.
- Literal quote characters inside quoted fields are escaped by doubling: `"` becomes `""`.

**Example:**
```
id,timestamp,user_email,action_type,resource_id,status
1,2024-01-15T10:30:45Z,john@example.com,CREATE,resource/123,SUCCESS
2,2024-01-15T10:35:12Z,"admin, support",UPDATE,"resource/456, sensitive",SUCCESS
3,2024-01-15T10:40:00Z,"user""quote"@example.com,DELETE,resource/789,FAILURE
```

## Pagination

For large datasets, use pagination with `limit` and `offset`:
- Default `limit`: 100 rows
- Maximum `limit`: 1000 rows
- Response includes `total` count and `hasMore` flag

**Example: Retrieve all logs page-by-page:**

```bash
for offset in {0..100..10}; do
  curl -H "Authorization: Bearer <TOKEN>" \
    "http://localhost:3000/api/admin/audit?tenantId=tenant-123&limit=10&offset=$offset"
done
```

## Retention Policy

⚠️ **Current policy:** Audit logs are retained indefinitely.

**Future improvements:**
- Implement automated archival after 90 days
- Add support for exporting to S3 or other cold storage
- Implement log rotation and compression

## Client-Side Usage (UI)

The audit trail page (`src/app/[locale]/admin/audit/page.tsx`) includes:

1. **Filters:**
   - Email search (LIKE %x%)
   - Action type dropdown
   - Status filter
   - Date range pickers (from/to)

2. **Pagination:**
   - Server-side pagination (10 rows per page by default)
   - Previous/Next buttons
   - Result count display

3. **Export Options:**
   - **CSV (página actual)**: Export current page as CSV
   - **CSV (filtrado completo)**: Export all filtered results (streaming, no pagination limit)
   - **JSON**: Export current page as JSON
   - **NDJSON**: Export current page as NDJSON

## Security Considerations

1. **Authentication:** All endpoints require valid Bearer token with tenant membership.
2. **Authorization:** Export endpoints (`/api/admin/audit/export`) require ADMIN or OWNER role.
3. **Data Protection:** Audit logs may contain sensitive information; ensure secure transmission and storage.
4. **PII Redaction:** User emails are logged but should be protected per your data retention policy.

## Testing

### Unit Tests
```bash
npx vitest run __tests__/unit/csvExport.test.ts
```

### Integration Tests
```bash
npx vitest run __tests__/integration/api-audit.test.ts
```

## Troubleshooting

**Q: Why are some logs missing from the export?**
A: Ensure the date range (`from`/`to`) covers the period you're interested in. The export is capped at 100k rows; for larger datasets, use multiple queries with smaller date ranges.

**Q: CSV file is corrupted when opened in Excel.**
A: Ensure the file encoding is UTF-8. If using Windows, try opening with LibreOffice Calc first, then save as Excel format.

**Q: User receives "Acceso denegado" when accessing audit page.**
A: The user must have ADMIN or OWNER role in the tenant. Check the `Users` table for the user's role assignment.

## API Reference

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/admin/audit` | GET | Tenant Access | Retrieve paginated logs with filters |
| `/api/admin/audit/export` | GET | Admin/Owner | Stream complete audit history |
