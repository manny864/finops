# Multi-currency Display (Feature D)

## Tier asignado
**Business+** (decisión: presentación financiera con divisas alternativas es feature ejecutivo).

> Nota: la implementación no aplica gating técnico actual — la UI muestra el selector a todos. El gating se aplicará cuando se exponga en pricing/sales. El backend tampoco bloquea (es benigno: solo es display).

## Qué resuelve
Toolkit de MS asume USD. Clientes en LATAM, EU y APAC necesitan ver costos en su divisa local. Este feature mantiene **USD como única unidad de cálculo y almacenamiento** (Regla Cero: precisión) y aplica conversión **solo en display** según preferencia del usuario.

## Arquitectura

```
DB (USD)  ─►  API endpoints (USD)  ─►  CurrencyProvider (client)  ─►  UI (XXX local)
                                            │
                                            └── consulta /api/fx/rates (cache 1h)
```

**Nunca** se persisten valores convertidos. Cambiar divisa NO recalcula históricos.

## Schemas (`migrations/20260629-004-multicurrency.sql`)

```sql
FxRates (base_currency, target_currency, rate DECIMAL(18,8), rate_date, source, updated_at)
UserCurrencyPreference (tenant_id, user_oid, display_currency, updated_at)
```

## Divisas soportadas (15)
USD, EUR, GBP, ARS, BRL, MXN, CLP, COP, PEN, CAD, AUD, JPY, CHF, CNY, INR.

## API

| Endpoint | Auth | Descripción |
|---|---|---|
| `GET /api/fx/rates` | público | Devuelve rates actuales + `lastUpdate` |
| `POST /api/fx/rates` | super-admin | Refresca rates desde exchangerate.host |
| `GET /api/fx/preference?tenantId=` | tenant access | Lee divisa del usuario |
| `POST /api/fx/preference` | tenant access | Setea divisa del usuario |

## UI / componentes

- `src/components/CurrencyProvider.tsx`:
  - `CurrencyProvider` — context provider montado en `ClientShell`.
  - `useCurrency()` — hook que expone `{ currency, setCurrency, rate, convert, format }`.
  - `CurrencySelector` — `<select>` en el header al lado del `LanguageSwitcher`.

- Patrón de uso en cualquier componente:
  ```tsx
  const { format } = useCurrency();
  <span>{format(costo_usd)}</span>          // "$1,234.56" o "AR$1.259.000"
  <span>{format(costo_usd, { compact: true })}</span>  // "$1.2K"
  ```

## Helpers server-side (`src/lib/fx.ts`)
- `getRate(target)` — Decimal, cache 1h, fallback estático embebido si DB vacía.
- `convertFromUSD(amount, target)` — Decimal.js, sin floats.
- `formatCurrency(amount, currency, { locale, compact })`.
- `getUserDisplayCurrency(tenantId, userOid)` / `setUserDisplayCurrency(...)`.
- `refreshRatesFromAPI()` — fetch a `api.exchangerate.host` (gratuito, sin key).

## Cron (opcional — no incluido)
Agregar a `src/cron/*.ts` un job diario que llame `refreshRatesFromAPI`. Por ahora rates estáticos del fallback son aceptables (no varían más de ±5% en una semana para divisas mayores).

## Decimal.js
Toda conversión usa `new Decimal(amountUSD).mul(rate)`. Resultado final se convierte a `number` solo al formatear con `Intl.NumberFormat`. Históricos en DB siguen siendo `DECIMAL(18,2)` USD.

## Smoke test
```bash
curl http://localhost:3000/api/fx/rates
# {"success":true,"rates":{"USD":"1","EUR":"0.92","ARS":"1020",...},"lastUpdate":null}
```

## Próximas integraciones (no incluidas)
- Replazar `$` hardcoded en componentes existentes por `useCurrency().format()` (cambio masivo, ~80 archivos). Por ahora coexisten: nuevos componentes lo usan, los viejos siguen en USD literal.
- Mostrar `lastUpdate` en el selector como tooltip.
- Permitir override por tenant (currency default) — hoy es por usuario.
