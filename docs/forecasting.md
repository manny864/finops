# ML Forecasting Guide

## Overview

The FinOps SaaS now includes intelligent cost forecasting with multiple methods:

- **Linear**: Simple least-squares regression. Fast, interpretable. Best for stable/growing trends.
- **EMA (Exponential Moving Average)**: Smooths noise by emphasizing recent data. Good for volatile series.
- **Holt-Winters**: Triple exponential smoothing capturing level, trend, AND seasonality. Best for weekly/seasonal patterns (e.g., cloud costs spike on weekdays).

All calculations use **Decimal.js** for precision (no float rounding errors on money).

---

## Quick Start

### GET `/api/intelligence/forecast`

**Backwards compatible.** If called with just `tenantId`, returns simple combined historical + forecast data.

**Advanced usage:**

```bash
GET /api/intelligence/forecast?tenantId=abc&method=holt_winters&days=30&withConfidence=true&withBacktest=true
```

**Query Parameters:**

| Param | Type | Default | Max | Notes |
|-------|------|---------|-----|-------|
| `tenantId` | string | **required** | - | Tenant ID |
| `method` | linear\|ema\|holt_winters\|auto | auto | - | `auto` picks best via backtest |
| `days` | number | 30 | 90 | Forecast horizon |
| `withConfidence` | boolean | true | - | Return lower/upper 95% CI bands |
| `withBacktest` | boolean | false | - | Return RMSE/MAPE metrics |

**Response (advanced mode):**

```json
{
  "method_used": "holt_winters",
  "forecast": [
    {
      "date": "2024-02-01",
      "value": "5234.50",
      "lower": "4800.00",
      "upper": "5669.00",
      "method": "holt_winters"
    }
  ],
  "metrics": {
    "rmse": "245.67",
    "mape": "8.2",
    "history_points": 28,
    "forecast_horizon_days": 30
  },
  "anomalies": [
    {
      "date": "2024-01-28",
      "value": "8000.00",
      "z_score": "2.5",
      "is_anomaly": true
    }
  ],
  "backtest": {
    "rmse": "245.67",
    "mape": "8.2",
    "mae": "198.40",
    "method": "holt_winters"
  }
}
```

### POST `/api/intelligence/forecast`

Month-end projection. Accepts optional `method` parameter (default: `holt_winters`).

```bash
POST /api/intelligence/forecast
Content-Type: application/json

{
  "tenantId": "abc",
  "monthlyBudget": 10000,
  "method": "auto"
}
```

**Response:**

```json
{
  "success": true,
  "method_used": "holt_winters",
  "projectedEndOfMonthCost": 8500.00,
  "isBreachPredicted": true,
  "breachDate": "2024-02-15",
  "chartData": [
    {
      "day": 1,
      "actualSpend": 250.00,
      "forecastedSpend": null,
      "budgetLimit": 10000
    },
    {
      "day": 2,
      "actualSpend": 500.00,
      "forecastedSpend": null,
      "budgetLimit": 10000
    },
    {
      "day": 31,
      "actualSpend": null,
      "forecastedSpend": 8500.00,
      "budgetLimit": 10000
    }
  ],
  "budgetLimit": 10000
}
```

---

## Methods Explained

### Linear Regression

**When to use:**
- Growing or steady cost trend
- Few anomalies
- Simple interpretation needed

**Formula:**
```
y = mx + b
```

**Pros:**
- Fast
- Easy to explain
- Good baseline

**Cons:**
- Ignores seasonality
- Sensitive to outliers
- Assumes constant slope

### EMA (Exponential Moving Average)

**When to use:**
- Noisy data
- Recent values more important
- No strong seasonality

**Formula:**
```
ema_t = α * value_t + (1 - α) * ema_{t-1}
```

Default α (alpha) = 0.3. Higher α = faster response to changes.

**Pros:**
- Smooths noise effectively
- Responds to trend changes
- Simple, fast

**Cons:**
- Flattens to constant after training
- No seasonality capture
- Requires tuning α

### Holt-Winters (Triple Exponential Smoothing)

**When to use:**
- Weekly/seasonal patterns (e.g., cloud costs spike Mon-Fri)
- Medium+ history (≥14 days recommended)
- Complex trend + noise

**Formula:**
```
Level:      L_t = α * (Y_t / S_{t-season}) + (1-α) * (L_{t-1} + T_{t-1})
Trend:      T_t = β * (L_t - L_{t-1}) + (1-β) * T_{t-1}
Seasonal:   S_t = γ * (Y_t / L_t) + (1-γ) * S_{t-season}
Forecast:   F_{t+h} = (L_t + h*T_t) * S_{t+h-season}
```

Defaults: α=0.3, β=0.1, γ=0.3, season=7 (weekly).

**Pros:**
- Captures seasonality (weekly patterns)
- Handles level + trend + noise
- More accurate for complex series

**Cons:**
- Requires more data (2*season minimum)
- More parameters to tune
- Heavier computation

**Fallback:** If history < 2*season, automatically falls back to EMA.

---

## Auto Method Selection

`method=auto` backtests all three on the last 20% of history and picks the one with **lowest MAPE** (Mean Absolute Percentage Error).

**Logic:**
```
train_set = history[0:80%]
test_set = history[80:%]

for method in [linear, ema, holt_winters]:
    forecast = method(train_set)
    mape = calc_mape(forecast, test_set)

return method_with_lowest_mape
```

**When to use:** General-purpose forecasting when you don't know the pattern beforehand.

---

## Confidence Intervals

95% confidence bands are calculated as:

```
lower = forecast - 1.96 * σ_residual
upper = forecast + 1.96 * σ_residual
```

Where σ_residual is the standard deviation of past prediction errors.

**Interpretation:**
- True value is ~95% likely to fall within [lower, upper]
- Bands widen with longer horizons (more uncertainty)
- Useful for risk analysis (e.g., "90% sure cost won't exceed $X")

---

## Anomaly Detection

Points with `|z_score| > 2` (or configurable threshold) are flagged.

```
z_score = (value - forecast_mean) / forecast_std
```

**Use case:** Alert operators to unexpected spikes (e.g., accidental resource scaling).

---

## Backtest Metrics

### RMSE (Root Mean Squared Error)

```
RMSE = sqrt(Σ(y - ŷ)² / n)
```

- Lower is better
- In original units (dollars)
- Penalizes large errors more

### MAPE (Mean Absolute Percentage Error)

```
MAPE = (1/n) * Σ(|y - ŷ| / |y|) * 100
```

- Lower is better
- Percentage scale (e.g., "5% error")
- Normalized across different cost magnitudes

### MAE (Mean Absolute Error)

```
MAE = (1/n) * Σ|y - ŷ|
```

- Average absolute error
- Same units as RMSE but linear penalty

---

## Usage Examples

### Example 1: Weekly Forecast with Confidence

```typescript
// Fetch 30-day forecast with confidence bands
const res = await fetch(
  '/api/intelligence/forecast?tenantId=abc&method=holt_winters&days=30&withConfidence=true'
);
const data = await res.json();

// Extract forecast points
data.forecast.forEach((point) => {
  console.log(`${point.date}: $${point.value} (±$${point.upper - point.lower}/2)`);
});
```

### Example 2: Month-End Projection

```typescript
// Predict end-of-month cost
const res = await fetch('/api/intelligence/forecast', {
  method: 'POST',
  body: JSON.stringify({
    tenantId: 'abc',
    monthlyBudget: 10000,
    method: 'auto',
  }),
});
const data = await res.json();

if (data.isBreachPredicted) {
  console.warn(`Budget breach predicted on ${data.breachDate}`);
}
```

### Example 3: Anomaly Detection

```typescript
// Get forecast + recent anomalies
const res = await fetch(
  '/api/intelligence/forecast?tenantId=abc&method=holt_winters&days=7'
);
const data = await res.json();

const spikes = data.anomalies.filter((a) => a.is_anomaly);
if (spikes.length > 0) {
  console.warn('Anomalies detected:', spikes);
}
```

---

## Configuration & Tuning

### Environment Variables

None required. All defaults are embedded in the library.

### Tuning Holt-Winters

Edit `/src/lib/forecasting.ts` to adjust:

```typescript
// In holtWintersForecast() call, change these:
alpha: 0.3,   // Level smoothing (0.1-0.5 typical)
beta: 0.1,    // Trend smoothing (0.01-0.3 typical)
gamma: 0.3,   // Seasonal smoothing (0.1-0.5 typical)
season: 7     // Cycle length in days (weekly=7, monthly≈30)
```

Higher values = more responsive to recent changes.

---

## Troubleshooting

### Issue: Always returns 401

→ Check `requireTenantAccess` auth middleware. Ensure token + tenant ID are valid.

### Issue: Method falls back to EMA when using Holt-Winters

→ History too short. Holt-Winters needs ≥ 2*season days (default 14 days). Add more historical data or switch to `method=linear`.

### Issue: Forecast seems flat/constant

→ EMA and Holt-Winters hold constant after training (extrapolation stops). This is by design. Use `method=linear` if you want continuous slope.

### Issue: Confidence bands too wide

→ High residual variance = uncertain data. Collect cleaner history or use more aggressive smoothing (higher alpha).

### Issue: Anomaly threshold too loose/strict

→ Adjust threshold in `detectAnomalies()` call (default=2 sigma). 2.5 is stricter, 1.5 is looser.

---

## References

- Holt-Winters: https://en.wikipedia.org/wiki/Exponential_smoothing
- EMA: https://en.wikipedia.org/wiki/Exponential_smoothing#Simple_exponential_smoothing
- MAPE: https://en.wikipedia.org/wiki/Mean_absolute_percentage_error
- Decimal.js: https://mikemcl.github.io/decimal.js/

---

## Next Steps

1. Integrate forecast UI widget on `/intelligence/billing` dashboard
2. Monitor backtest MAPE in production (alert if > 15%)
3. Collect user feedback on method selection
4. Consider external ML services (AWS Forecast, Azure AutoML) for complex scenarios
