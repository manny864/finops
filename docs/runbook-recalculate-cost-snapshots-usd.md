# Runbook: recalcular CostSnapshots contaminados por moneda (PreTaxCost → CostUSD)

## Contexto

Hasta el fix de 2026-07-09 (ver `docs/dashboard-improvements-2026-07-09.md`),
todas las queries a Azure Cost Management de la plataforma agregaban
**`PreTaxCost`**, que Azure devuelve en la **moneda de facturación de la
suscripción** (ARS, EUR, etc. — no necesariamente USD). La plataforma
guardaba ese valor en las columnas `cost_usd` / `total_cost_usd` con la
columna `currency` hardcodeada a `'USD'` en el `INSERT`, sin conversión real.

Resultado: para cualquier tenant **no facturado en dólares** (caso detectado:
`rpa365`, facturación en ARS), todos los montos históricos persistidos en
`CostSnapshots`, `CostMeterSnapshots`, `CostCategorySnapshots` y la tabla
legacy `cost_snapshots` están inflados/distorsionados por el tipo de cambio.

El fix de código (`src/lib/azureCostColumn.ts` + `billingService.ts` +
rutas API) ya corrige los cálculos **de acá en adelante**. Este runbook cubre
la limpieza del **histórico ya persistido**.

## Qué hace el script

`scripts/recalculate-cost-snapshots-usd.ts`:

1. Por cada tenant (activo, o uno específico con `--tenant=`), vuelve a
   consultar Azure Cost Management para la ventana histórica completa (hasta
   13 meses — límite de la Query API) usando **`CostUSD`**, con degradación
   automática a `PreTaxCost` si la oferta comercial del tenant no expone esa
   columna (recordado en Redis 7 días, mismo mecanismo que el resto de la
   plataforma).
2. **Borra** las filas existentes de ese tenant en la ventana recalculada en
   `CostSnapshots`, `CostMeterSnapshots`, `CostCategorySnapshots` y
   `cost_snapshots`.
3. **Inserta** las filas corregidas.

Es **idempotente**: correrlo dos veces sobre el mismo tenant/ventana no
duplica nada (vuelve a borrar e insertar los mismos valores corregidos).

## Cómo correrlo

**Siempre en el VPS** (donde están las credenciales Azure reales por tenant
y la base de datos de producción) — nunca en un entorno de desarrollo local.

### 1. Dry-run primero (obligatorio)

No modifica la base de datos. Muestra, por tenant, el total actual en DB
contra el total recalculado desde Azure para la misma ventana:

```bash
cd ~/cscloud/finops
docker compose exec finops-app npx tsx scripts/recalculate-cost-snapshots-usd.ts --dry-run
```

O para un tenant puntual (recomendado para validar primero con `rpa365`):

```bash
docker compose exec finops-app npx tsx scripts/recalculate-cost-snapshots-usd.ts --dry-run --tenant=<tenantId-de-rpa365>
```

**Cómo leer el output:**
```
=== Tenant <id> (rpa365) — ventana 2025-06-10 a 2026-07-08 ===
  DB actual  — chargeback: $58432.10 (412 filas), meter: $12044.50 (89), category: $9200.00 (34), legacy: $61200.00 (30)
  Recalculado — chargeback: $412.30 (412 filas), meter: $85.10 (89), category: $65.00 (34), legacy: $432.10 (30)
  Delta (chargeback): 99.3% (estaba inflado — probable contaminación por moneda)
  [DRY RUN] No se modifica la base de datos.
```

- Si el delta es **grande y positivo** (DB actual >> recalculado): confirma
  contaminación por moneda — el tenant factura en una moneda distinta a USD.
- Si el delta es **~0%**: el tenant ya facturaba en USD, no hay nada que
  corregir (aplicar el script igual es inofensivo — no cambiará los montos
  de forma significativa).

### 2. Aplicar (tenant por tenant, empezando por los confirmados)

```bash
docker compose exec finops-app npx tsx scripts/recalculate-cost-snapshots-usd.ts --tenant=<tenantId>
```

### 3. Aplicar a todos los tenants activos

Una vez validado con 1-2 tenants de prueba:

```bash
docker compose exec finops-app npx tsx scripts/recalculate-cost-snapshots-usd.ts
```

Corre **secuencial** (no concurrente) tenant por tenant — cada uno ya hace
varias queries chunked (≤350 días) a Cost Management por dentro; paralelizar
tenants amplificaría el rate limiting (429) de la API. Para muchos tenants,
puede tardar varios minutos; es seguro dejarlo correr en background
(`nohup ... &` o una sesión `screen`/`tmux`).

### Ventana más corta (opcional)

Si 13 meses es demasiado para una primera pasada:

```bash
docker compose exec finops-app npx tsx scripts/recalculate-cost-snapshots-usd.ts --months=3
```

## Qué NO corrige este script

- **Ofertas que no soportan `CostUSD`** (algunos contratos EA/legacy):
  degradan automáticamente a `PreTaxCost` — el histórico de esos tenants
  específicos queda en moneda de facturación igual que antes (limitación de
  la API de Azure, no de la plataforma). El log del script avisa cuándo pasa
  esto (`"CostUSD no soportado... degradando a PreTaxCost"`).
- **Datos más allá de 13 meses atrás**: fuera del alcance de la Query API de
  Azure; esos días quedan con el valor viejo (contaminado) hasta que salgan
  de cualquier ventana de reporte relevante (13 meses).
- **Reportes ya generados/exportados** (PDF, CSV descargados antes del fix):
  no se re-generan automáticamente.

## Verificación post-recálculo

Repetir el dry-run sobre el mismo tenant — el delta debería ser ~0% ahora
(DB actual y recalculado deberían coincidir, ya que ambos vienen de la misma
fuente corregida):

```bash
docker compose exec finops-app npx tsx scripts/recalculate-cost-snapshots-usd.ts --dry-run --tenant=<tenantId>
```

También verificar visualmente en `/intelligence/cost-projection` (Gastos y
Proyección) y el dashboard que los montos ahora sean razonables.
