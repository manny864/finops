# FinOps SaaS REST API v1

Versioned, key-authenticated REST API for programmatic access to FinOps data.

## Overview

The FinOps REST API provides read-only access to cost analysis, budgets, recommendations, and anomaly data. All requests require authentication via API keys (`pak_xxx` format).

- **Base URL**: `https://finops.cscloudsolutions.com.ar/api/v1` (production)
- **Versions**: Currently v1 (future versions available at `/api/v2`, `/api/v3`, etc.)
- **Response Format**: JSON with consistent envelope structure
- **Rate Limits**: Per-key, configurable (default 60 req/min)

## Authentication

### API Key Header

```bash
curl -H "X-API-Key: pak_live_xxx..." https://finops.cscloudsolutions.com.ar/api/v1/me
```

### Bearer Token

```bash
curl -H "Authorization: Bearer pak_live_xxx..." https://finops.cscloudsolutions.com.ar/api/v1/me
```

## Scopes

Each API key is assigned one or more scopes controlling what data it can access:

| Scope | Access |
| --- | --- |
| `read:cost` | Cost summary, timeseries, historical data |
| `read:resources` | Azure resource list and details |
| `read:budgets` | Tenant budgets and spend tracking |
| `read:recommendations` | Cost optimization recommendations |
| `read:anomalies` | Cost anomaly detection results |

Example: Create a key with only `read:cost` scope to expose cost data to a BI tool, without access to infrastructure details.

## Response Format

All responses follow this structure:

### Success (2xx)

```json
{
  "data": { /* endpoint-specific data */ },
  "meta": {
    "request_id": "uuid",
    "rate_limit": {
      "limit": 60,
      "remaining": 59,
      "reset": "2024-06-29T21:00:00Z"
    }
  }
}
```

### Error (4xx, 5xx)

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Invalid or missing API key",
    "request_id": "uuid"
  }
}
```

## Rate Limits

Rate limits are per API key. Each request decrements the remaining count for the current minute. When exhausted:

- **Response**: `429 Too Many Requests`
- **Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

Example:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 2024-06-29T21:15:00Z
```

To increase limits, update the API key in Admin → API Pública.

## Endpoints

### `GET /me`

Get current API key info.

**Scopes**: None (public)

**Query Parameters**: None

**Example**:

```bash
curl -H "X-API-Key: pak_live_xxx..." https://finops.cscloudsolutions.com.ar/api/v1/me
```

**Response**:

```json
{
  "data": {
    "tenant_id": "tenant-abc",
    "key_name": "Production API",
    "scopes": ["read:cost", "read:resources"],
    "rate_limit_per_min": 60
  },
  "meta": { /* ... */ }
}
```

### `GET /cost/summary`

Aggregate cost data for a date range.

**Scopes**: `read:cost`

**Query Parameters**:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `from` | date (ISO 8601) | ✓ | Start date |
| `to` | date (ISO 8601) | ✓ | End date |
| `groupBy` | string | | Grouping: `service`, `resourceGroup`, `region` (default: `service`) |

**Example**:

```bash
curl "https://finops.cscloudsolutions.com.ar/api/v1/cost/summary?from=2024-06-01&to=2024-06-30&groupBy=service" \
  -H "X-API-Key: pak_live_xxx..."
```

**Response**:

```json
{
  "data": {
    "total_cost_usd": "15250.75",
    "average_daily_usd": "507.69",
    "period_start": "2024-06-01",
    "period_end": "2024-06-30",
    "group_by": "service",
    "breakdown": [
      { "key": "Compute", "cost_usd": "8000.00" },
      { "key": "Storage", "cost_usd": "4200.50" },
      { "key": "Database", "cost_usd": "3050.25" }
    ]
  },
  "meta": { /* ... */ }
}
```

### `GET /cost/timeseries`

Cost data as a timeseries.

**Scopes**: `read:cost`

**Query Parameters**:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `from` | date (ISO 8601) | ✓ | Start date |
| `to` | date (ISO 8601) | ✓ | End date |
| `granularity` | string | | `daily` or `monthly` (default: `daily`) |

**Example**:

```bash
curl "https://finops.cscloudsolutions.com.ar/api/v1/cost/timeseries?from=2024-06-01&to=2024-06-30&granularity=daily" \
  -H "X-API-Key: pak_live_xxx..."
```

### `GET /resources`

List Azure resources.

**Scopes**: `read:resources`

**Query Parameters**:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | string | | Filter by resource type |
| `limit` | integer | 100 | Max 1000 |
| `offset` | integer | 0 | For pagination |

### `GET /budgets`

List tenant budgets.

**Scopes**: `read:budgets`

**Query Parameters**: None

### `GET /recommendations`

List cost optimization recommendations.

**Scopes**: `read:recommendations`

**Query Parameters**: None

### `GET /anomalies`

List detected cost anomalies.

**Scopes**: `read:anomalies`

**Query Parameters**:

| Parameter | Type | Description |
| --- | --- | --- |
| `from` | date | Start date |
| `to` | date | End date |
| `severity` | string | `low`, `medium`, `high` |

## Interactive Documentation

Browse all endpoints with examples at: `/api/v1/docs` (Swagger UI)

Download OpenAPI spec: `/api/v1/openapi.json`

## Error Codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `unauthorized` | 401 | Missing or invalid API key |
| `insufficient_scope` | 403 | Key lacks required scope |
| `rate_limit_exceeded` | 429 | Too many requests |
| `invalid_request` | 400 | Missing or invalid parameters |
| `data_unavailable` | 503 | Requested data not available (e.g., Azure credentials not configured) |
| `internal_error` | 500 | Server error |

## Versioning

- Current version: **1.0.0**
- All endpoints live under `/api/v1`
- Future versions (v2, v3, etc.) will coexist
- **Deprecation policy**: At least 6 months notice before removing any version

## Rate Limiting Strategy

Choose rate limits per use case:

- **Dashboards**: 60 req/min (typical)
- **High-frequency polling**: 300 req/min
- **Batch jobs**: 1000 req/min (contact support)

## Precision Notes

All monetary values use **decimal strings** (e.g., `"1234.56"`) to maintain precision across JSON. Parse as strings or use arbitrary-precision libraries.

## Contact

For API issues or feature requests, contact **soporte@cscloudsolutions.com.ar**.
