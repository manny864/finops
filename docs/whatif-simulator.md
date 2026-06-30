# What-If Simulator — Save & Compare

Extiende el simulador de escenarios (`/intelligence/simulator`) con persistencia y comparación lado-a-lado.

## UI

`/intelligence/simulator` (tier Enterprise). Debajo del panel de simulación:

- **Tabla de escenarios guardados** — nombre, base, proyectado, Δ%, fecha, acciones.
- **Botón "Guardar actual"** — congela los inputs + resultado de la última simulación bajo un nombre + notas opcionales.
- **Checkboxes para seleccionar 2–4 escenarios** y botón **"Comparar"** que abre el modal lado-a-lado.

## Modelo

Tabla `WhatIfScenarios` (migración `20260629-006-whatif-scenarios.sql`):

| columna | tipo | uso |
|---|---|---|
| `id` | VARCHAR(36) | uuid |
| `tenant_id` | FK Tenants | RBAC |
| `user_email` | VARCHAR(255) | creador (para delete RBAC) |
| `name`, `notes` | VARCHAR(120) / TEXT | etiquetado humano |
| `inputs_json` | JSON | `{ computeScale, storageScale, networkIncrease, applyAhb }` |
| `base_cost`, `projected_cost`, `compute_cost`, `storage_cost`, `network_cost` | DECIMAL(14,4) | snapshot — los escenarios guardados NO se recalculan |
| `currency` | VARCHAR(8) | display |
| `created_at`, `updated_at` | TIMESTAMP | |

Decisión clave: **los escenarios son inmutables después de guardarse**. Si el baseCost del tenant cambia con el tiempo, los escenarios viejos siguen comparables entre sí. Para re-evaluar con un baseCost nuevo, se crea un escenario nuevo.

## API

### `POST /api/intelligence/simulator/scenarios`
Guarda. Roles permitidos: `ADMIN | OWNER | Colaborador`.

```json
{
  "tenantId": "acme-prod",
  "name": "Migración 2026Q3",
  "notes": "Plan de migración + AHB ON",
  "inputs": { "computeScale": 1.3, "storageScale": 1.0, "networkIncrease": 25, "applyAhb": true },
  "baseCost": 25000,
  "currency": "USD"
}
```

### `GET /api/intelligence/simulator/scenarios?tenantId=...`
Lista los últimos 100 del tenant (ADMIN/OWNER/Colaborador/Reader).

### `DELETE /api/intelligence/simulator/scenarios/{id}?tenantId=...`
Borra. Solo el creador o un ADMIN/OWNER pueden borrar.

### `POST /api/intelligence/simulator/compare`
```json
{ "tenantId": "acme-prod", "ids": ["uuid1", "uuid2", "uuid3"] }
```
Devuelve los 2-4 escenarios + un array `diffs` que compara cada escenario contra el primero (línea base).

## Motor de simulación

Extraído a `src/lib/simulator/engine.ts`:

- `runScenario(baseCost, inputs)` → `{ baseCost, projectedCost, delta, deltaPct, breakdown }`
- `parseInputs(raw)` → sanitiza + valida rangos (rechaza out-of-range).

Mix asumido (Azure-first baseline):
- 60% compute · `computeScale`
- 25% storage · `storageScale`
- 15% network · `(1 + networkIncrease/100)`
- AHB on → descuento global flat 18%.

Toda la matemática usa `toMoneyNumber` (cents-based) para evitar floats acumulativos.

## Tests

- `__tests__/unit/simulatorEngine.test.ts` — 12 tests: baseline, scaling, AHB, rangos, parseInputs.

## QA manual

1. Login Enterprise tenant → `/intelligence/simulator`.
2. Mover sliders → "Ejecutar Simulación".
3. Click **"Guardar actual"** → nombre + notas → guardar.
4. Repetir 2–3 con distintos sliders.
5. Marcar 2-4 con checkboxes → **"Comparar"** → ver modal con cards lado a lado, baseline marcado.
6. Borrar uno (icono trash) → confirmar → desaparece.
7. Logout → relogin → escenarios deben persistir.

## Roadmap

- Sharing entre usuarios del mismo tenant (campo `shared_with_tenant`).
- Export del comparador a PDF / PNG.
- Plantillas de escenarios pre-cargadas ("Lift & Shift", "Reservas 3yr", "Spot 50%").
