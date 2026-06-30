# Status Page Documentation

## Overview

The CSCloudSolutions FinOps platform includes a public status page accessible at:
- `/es/status` (Spanish locale)
- `/en/status` (English locale)
- `/status` (Redirects to default locale `/es/status`)

The status page displays real-time health information about all platform components and recent incidents.

## Endpoints

### 1. GET `/api/status` (Public)

Returns the current platform status with component health checks.

**Response:**
```json
{
  "status": "operational|degraded|down",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "components": [
    {
      "name": "API",
      "status": "operational|degraded|down",
      "latency_ms": 12
    },
    {
      "name": "Database",
      "status": "operational|degraded|down",
      "latency_ms": 5
    },
    {
      "name": "Azure Sync",
      "status": "operational|degraded|down"
    },
    {
      "name": "AI Provider",
      "status": "operational|degraded|down"
    },
    {
      "name": "Paddle Billing",
      "status": "operational|degraded|down"
    }
  ],
  "uptime_30d_pct": 99.95,
  "incidents_last_30d": 0,
  "version": "b4debae"
}
```

**CORS:** Enabled (`Access-Control-Allow-Origin: *`)  
**Cache:** 30 seconds (`Cache-Control: public, max-age=30`)

**Component Checks:**
- **API**: Trivially operational if endpoint responds
- **Database**: Health check with `SELECT 1`
  - `latency > 500ms` → degraded
  - Error → down
- **Azure Sync**: Ratio of tenants with `sync_status='OK'`
  - Ratio < 0.5 → degraded
  - Ratio ≥ 0.5 → operational
- **AI Provider**: Check if `GEMINI_API_KEY` is valid
  - Empty or "placeholder" → degraded
- **Paddle Billing**: Check if `PADDLE_API_KEY` is valid
  - Empty or "placeholder" → degraded

### 2. GET `/api/status/incidents` (Public)

Returns recent incidents from the last 30 days.

**Response:**
```json
{
  "incidents": [
    {
      "id": 1,
      "title": "Database migration",
      "severity": "major|minor|critical",
      "status": "investigating|identified|monitoring|resolved",
      "startedAt": "2025-01-15T10:00:00Z",
      "resolvedAt": "2025-01-15T12:00:00Z",
      "description": "Planned maintenance"
    }
  ]
}
```

**CORS:** Enabled  
**Cache:** 60 seconds

### 3. POST `/api/status/incidents` (Requires Superadmin)

Create a new incident report.

**Request:**
```json
{
  "title": "Service name issue",
  "severity": "minor|major|critical",
  "description": "Optional detailed description"
}
```

**Response:**
```json
{
  "id": 123,
  "title": "Service name issue",
  "severity": "major",
  "status": "investigating",
  "startedAt": "2025-01-15T10:30:00.000Z"
}
```

**Auth:** Bearer token from Azure AD (superadmin only)

### 4. PATCH `/api/status/incidents/:id` (Requires Superadmin)

Update incident status.

**Request:**
```json
{
  "status": "investigating|identified|monitoring|resolved",
  "resolved_at": "2025-01-15T12:00:00Z"  // optional
}
```

**Response:**
```json
{
  "success": true,
  "incidentId": 123,
  "status": "resolved"
}
```

### 5. GET `/api/cron/status-snapshot` (Requires Secret)

Capture a status snapshot for historical tracking.

**Query Parameters:**
- `secret`: Matches `CRON_SECRET` environment variable

**Response:**
```json
{
  "success": true,
  "overall_status": "operational|degraded|down",
  "uptime_30d_pct": 99.95
}
```

**Invocation:**

#### Vercel Cron Jobs (vercel.json)
```json
{
  "crons": [
    {
      "path": "/api/cron/status-snapshot?secret=YOUR_SECRET",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

#### GitHub Actions (`.github/workflows/status-snapshot.yml`)
```yaml
name: Status Snapshot
on:
  schedule:
    - cron: "*/5 * * * *"

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - name: Capture status snapshot
        run: |
          curl -X GET "https://your-domain.com/api/cron/status-snapshot?secret=${{ secrets.CRON_SECRET }}" \
            -H "Content-Type: application/json"
```

#### VPS Crontab
```bash
*/5 * * * * curl -s "https://your-domain.com/api/cron/status-snapshot?secret=YOUR_SECRET" > /dev/null 2>&1
```

## Database Tables

### PlatformStatusSnapshots
Stores historical status data every interval (default: 5 minutes).

```sql
CREATE TABLE PlatformStatusSnapshots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    overall_status ENUM('operational','degraded','down') NOT NULL,
    db_latency_ms INT,
    azure_sync_ratio DECIMAL(5,4),
    components_json JSON,
    captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_captured (captured_at)
);
```

### PlatformIncidents
Manual incident records created by superadmins.

```sql
CREATE TABLE PlatformIncidents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    severity ENUM('minor','major','critical') NOT NULL,
    status ENUM('investigating','identified','monitoring','resolved') NOT NULL,
    started_at DATETIME NOT NULL,
    resolved_at DATETIME NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_started (started_at)
);
```

## Environment Variables

```bash
# API health check secret for cron jobs
CRON_SECRET="your-secure-random-secret"

# External provider keys (for component health checks)
GEMINI_API_KEY="your-gemini-key"
PADDLE_API_KEY="your-paddle-key"

# Optional: Override API base URL for server-side fetches
NEXT_PUBLIC_API_BASE_URL="https://your-domain.com"
```

## Example cURL Commands

### Get current status
```bash
curl https://your-domain.com/api/status \
  -H "Accept: application/json"
```

### Get incidents
```bash
curl https://your-domain.com/api/status/incidents \
  -H "Accept: application/json"
```

### Create incident (with superadmin token)
```bash
curl -X POST https://your-domain.com/api/status/incidents \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "API Latency Issues",
    "severity": "major",
    "description": "Slow responses from API tier"
  }'
```

### Update incident (with superadmin token)
```bash
curl -X PATCH https://your-domain.com/api/status/incidents/123 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "resolved",
    "resolved_at": "2025-01-15T12:00:00Z"
  }'
```

### Capture snapshot (with cron secret)
```bash
curl https://your-domain.com/api/cron/status-snapshot?secret=YOUR_SECRET
```

## Features

- ✅ **Public endpoint** - No authentication required for status checks
- ✅ **CORS enabled** - Can be accessed from any domain
- ✅ **Cached responses** - Optimized for high traffic
- ✅ **Component health checks** - Database, Azure Sync, AI, Billing
- ✅ **Incident tracking** - Manual incident creation and status tracking
- ✅ **30-day uptime tracking** - Historical performance data
- ✅ **Beautiful UI** - Tailwind CSS styling, no external libraries
- ✅ **Server-side rendering** - Fast, no JavaScript required (with auto-refresh meta tag)

## Security

- Status endpoint is **completely public** - No sensitive data exposed
- Cron secret is **required** for snapshot endpoint - Set strong value in `CRON_SECRET`
- Incident creation/updates **require superadmin** authentication via Azure AD
- All database queries use prepared statements to prevent injection
