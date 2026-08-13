# Bulk Tagging Guide

## Overview
Bulk tagging allows selecting multiple resources and applying tags (Environment, CostCenter, Owner) in a single operation to both "Recursos Huérfanos" and "Fugas Financieras".

## Implementation

### Endpoint: `/api/tags/apply-bulk` (POST)
- **Location:** `src/app/api/tags/apply-bulk/route.ts`
- **Max resources:** 100 per request
- **RBAC:** Admin/Owner required
- **Tier:** Business+ required
- **Performance:** Parallel operation (1 request for N resources vs. N sequential requests)

### Request
```json
{
  "tenantId": "uuid",
  "resourceIds": ["/subscriptions/.../resources/..."],
  "tags": {
    "Environment": "Production",
    "CostCenter": "12345",
    "Owner": "user@example.com"
  }
}
```

### Response
```json
{
  "success": true,
  "summary": {
    "total": 42,
    "succeeded": 40,
    "failed": 2
  },
  "results": [
    { "resourceId": "...", "success": false, "error": "Unauthorized" }
  ]
}
```

## UI Components

### BulkTagModal
- **Location:** `src/components/BulkTagModal.tsx`
- **Usage:** Modal for entering tag values before applying
- **Props:**
  - `isOpen`: boolean
  - `resourceIds`: string[] (up to 100)
  - `resourceNames`: string[] (for preview)
  - `onClose`: callback
  - `onSuccess`: callback after completion
  - `t`: translation function

### Integration Points
1. **Orphaned Resources** (`/cleanup/backup-orphans`)
   - Checkboxes in table rows
   - Select-all checkbox in header
   - Blue highlight for selected rows
   - Bulk tag button shows when items selected

2. **Financial Leaks** (`/overview/financial-leaks`)
   - Uses ZombieResourcesTable component
   - Already has bulk tagging UI in native modal
   - Can be upgraded to use `/api/tags/apply-bulk` for better performance

## Workflow

### For Orphaned Resources
1. Open `/cleanup/backup-orphans`
2. Check boxes next to resources to tag (or select-all in header)
3. Click "Apply Tags" button
4. Fill in tag values in modal
5. Click "Apply Tags"
6. Wait for completion (usually <10s for 20 resources)
7. Results displayed, selected rows cleared

### For Financial Leaks
1. Open `/overview/financial-leaks`
2. Click on affected resources table
3. Select resources using checkboxes
4. Modal appears with tag fields
5. Enter tags and apply
6. Resources removed from list after successful tagging

## Error Handling
- Network errors: Toast notification, modal stays open
- Partial failures: Summary shows succeeded/failed counts
- Redis cache: Non-blocking (cache writes are async)
- Auth failures: Tenant role + tier validation before bulk operation

## Performance Notes
- Bulk endpoint scales to 100 resources
- Serial loop removed (was in ZombieResourcesTable)
- All resources tagged in parallel via Azure Resource Manager
- Each resource tag operation is idempotent (Merge operation)

## Future Improvements
- Async job for >100 resources with polling
- Bulk untag operation
- Tag templates/presets
- Batch scheduling (apply at specific time)
