# Forecasting ML upgrade

Extiende el motor de forecasting (`src/lib/forecasting.ts`) con métodos modernos y una endpoint para forecast por servicio.

## Antes vs. ahora

| | Antes | Ahora |
|---|---|---|
| Métodos | linear, EMA, Holt-Winters | + **damped Holt** + **ensemble** |
| Selección automática | `selectBestMethod` (3 métodos) | **`selectBestMethodExtended`** (5 métodos) |
| Granularidad | Total tenant | **Por servicio** vía `/api/intelligence/forecast/by-service` |
| Horizonte largo | Linear explota | **Damped Holt** evita explosión |
| Robustez a ruido | Cada método por separado | **Ensemble** pondera por MAPE inverso |

## Nuevos métodos

### `dampedHoltForecast(history, days, alpha=.3, beta=.1, phi=.85)`

Holt-Damped (Gardner-McKenzie 1985). Como Holt's linear pero con factor de damping `phi ∈ (0,1]`:

```
F_{t+h} = level + (φ + φ² + ... + φʰ) · trend
```

Cuando `phi → 1`, equivale a Holt lineal. Con `phi=0.85` (default) las proyecciones a 90 días saturan en vez de explotar, lo que tracking empíricamente mejor el gasto Azure post-onboarding.

### `ensembleForecast(history, days)`

Combina linear + EMA + damped Holt (+ Holt-Winters si hay ≥14 días) con pesos inversamente proporcionales al MAPE de backtest de cada método. Implementa el resultado clásico de Bates-Granger / Stock-Watson: en series ruidosas, el ensemble bate al mejor método individual ~70% de las veces.

### `selectBestMethodExtended(history)`

Mismo backtest 80/20 que `selectBestMethod` pero incluye también `damped_holt` y `ensemble`. Devuelve el método con menor MAPE.

## API: `/api/intelligence/forecast`

Acepta `method` extendido:

```
GET /api/intelligence/forecast?tenantId=...
  &method=damped_holt|ensemble|auto|...
  &days=30
  &withConfidence=true
  &withBacktest=true
```

`auto` ahora usa `selectBestMethodExtended`.

`withConfidence` solo aplica a `linear|ema|holt_winters` (los residuos no están definidos canónicamente para damped/ensemble). Para esos métodos devuelve `lower=[]`, `upper=[]`.

## API nueva: `/api/intelligence/forecast/by-service`

```
GET /api/intelligence/forecast/by-service?tenantId=...
  &days=30          (1..90)
  &method=auto      (cualquier método soportado)
  &topN=10          (1..50)
```

Devuelve:

```jsonc
{
  "success": true,
  "tenantId": "...",
  "days": 30,
  "method": "auto",
  "services": [
    {
      "serviceName": "Virtual Machines",
      "history": [{ "date": "2026-06-01", "value": "1234.50" }, ...],
      "forecast": [{ "date": "2026-07-01", "value": "1289.30", "method": "ensemble" }, ...],
      "methodUsed": "ensemble",
      "historyTotal": 38420.00,
      "forecastTotal": 41200.00
    },
    ...,
    { "serviceName": "Other", ... }   // top N+1..ALL agregados
  ]
}
```

Usa los últimos 60 días para construir series por servicio, rankea por gasto total, mantiene los top N y agrega el resto en una serie sintética "Other".

## Tests

`__tests__/unit/forecastingMl.test.ts` — 13 tests:
- Damped Holt: validación de inputs, no-negatividad, dampening real vs. extrapolación lineal, etiquetado.
- Ensemble: validación, etiquetado, no-negatividad, comportamiento estable en series planas.
- selectBestMethodExtended: fallback en historiales cortos, métodos válidos en series largas, no lanza en ruido.

## QA manual

1. Login Pro tenant → `/intelligence/forecast` (cuando exista UI consumiendo `damped_holt`).
2. Llamar la API:
   ```sh
   curl "https://<host>/api/intelligence/forecast?tenantId=acme&method=damped_holt&days=60&withBacktest=true" \
     -H "Authorization: Bearer <token>"
   ```
3. Verificar `method_used: "damped_holt"` y que los valores forecast no crecen linealmente.
4. Por servicio:
   ```sh
   curl "https://<host>/api/intelligence/forecast/by-service?tenantId=acme&method=auto&days=30&topN=5" \
     -H "Authorization: Bearer <token>"
   ```
5. Verificar 5 services + "Other"; cada uno con su `methodUsed` y `forecastTotal`.

## Roadmap

- Persistir forecasts diarios en `ForecastAccuracy` y comparar predicted vs. actual para mostrar MAPE real "en vivo" (no solo backtest).
- Confidence intervals propios para damped Holt usando residuos del modelo.
- Externalizar Prophet/LightGBM en un sidecar Python si el tamaño justifica (requiere infra).
- Multi-seasonalidad (weekly + monthly) en Holt-Winters via TBATS.
