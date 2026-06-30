# Pricing Unit Normalizer (Feature B)

## Tier asignado
**Todos los tiers** (Essential, Pro, Business, Enterprise) — infrastructure feature transparente.

## Qué resuelve
Azure billing reporta `UnitOfMeasure` en formatos heterogéneos:
- `1 Hour`, `100 Hours`, `1000 Hours`
- `1 GB`, `1 TB` (1000 GB), `1 GB/Month`
- `10K Transactions`, `1M Tokens`

Sumarlos sin normalizar produce KPIs incorrectos. Ahora todos los servicios pueden agregar en una **unidad base común** (Hour, GB, Transaction, Token, etc.).

## API pública

### Helper `src/lib/pricingUnits.ts`

```ts
import { normalizeUnit, preloadCache } from "@/lib/pricingUnits";

await preloadCache(); // opcional, ya lo hace init

const result = await normalizeUnit("100 Hours", 7.3);
// { baseUnit: "Hour", normalizedQty: Decimal(730), display: "Hours", category: "Time", inferred: false }
```

### Endpoint admin

`GET /api/admin/pricing-units` — lista los 45 UoMs seedeados.
`GET /api/admin/pricing-units?test=100%20Hours&qty=7.3` — prueba en vivo.
`POST /api/admin/pricing-units` — re-seed forzado + reset cache.

Auth: **super-admin only**.

## Schema

`migrations/20260629-003-pricing-units.sql`:
- `PricingUnits (uom_raw PK, block_size, base_unit, display_unit, category, updated_at)`
- 45 entradas iniciales (subset toolkit MS).

## Categorías incluidas
- **Time**: Hour, Minute, Second, Day, Month
- **Storage**: MB, GB, TB, PB (+ /Month, /Hour)
- **Transaction**: 1, 10K, 100K, 1M, 10M (Operations, Requests también)
- **AI**: Token (1K, 1M), Image
- **Compute**: vCPU/Hour, Core/Hour
- **Network**: GB Transferred
- **Other**: Units

## Cómo extender
1. Editar `scripts/seed-pricing-units.ts` (array `SEED`).
2. `npm run seed:pricing-units` (idempotente) o `POST /api/admin/pricing-units` desde la UI super-admin.
3. La caché se resetea automáticamente con `resetCache()`.

## Fallback
Si un UoM no está en la tabla, `normalizeUnit` lo **infiere** del string con regex:
- `"500 Widgets"` → `{ baseUnit: "Widget", normalizedQty: qty × 500, inferred: true }`
- Si el patrón no matchea, devuelve la qty sin escalar marcando `inferred: true`.

## Tests verificados (runtime)
| Input | Esperado | Resultado |
|---|---|---|
| `normalizeUnit("100 Hours", 7.3)` | `Hour 730` | ✅ |
| `normalizeUnit("1 TB", 1)` | `GB 1000` | ✅ |
| `normalizeUnit("10K Transactions", 5)` | `Transaction 50000` | ✅ |
| `normalizeUnit("1M Tokens", 2.5)` | `Token 2500000` | ✅ |
| `normalizeUnit("1 GB/Month", 800)` | `GB 800` | ✅ |

## Próxima integración (no incluida en B, futura tarea)
Integrar `normalizeUnit` en agregadores existentes (`costAggregator`, `intelligence/billing`) bajo feature flag para validar sin romper KPIs históricos. Hoy queda disponible como helper aislado para nuevos features (E Sustainability lo usa para emisiones por GB).

## Bug colateral arreglado
`src/modules/storage/migrations.ts` `splitStatements`: descartaba statements que **empezaban** con comentario `--`. Las migraciones 002, 003 (con header `-- ...`) se registraban como aplicadas pero su SQL nunca corría. Fix: filtrado por líneas, no por statement entero.
