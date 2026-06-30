# FOCUS 1.1 Exporter

Export de billing del tenant en formato **FinOps Open Cost & Usage Specification 1.1** (https://focus.finops.org/).

## Para qué sirve

- Compatibilidad con FOCUS Validator, CCAF, OpenCost, Power BI, Vantage, CloudHealth y cualquier herramienta FinOps que consuma FOCUS.
- Diferenciador Enterprise: requisito frecuente en RFPs de clientes regulados que quieren "lock-in cero" sobre la representación de costos.
- Habilita consumo programático del SaaS desde pipelines de datos del cliente.

## UI

`/admin/focus-export` (visible para ADMIN/OWNER en tier Professional o superior).

Permite seleccionar:
- Rango de fechas (default últimos 30 días).
- Filtro opcional por `subscriptionId`.
- Formato: CSV (estándar FOCUS), JSON o NDJSON.

## API

```
GET /api/exports/focus
  ?tenantId=<id>            (requerido)
  &from=YYYY-MM-DD          (opcional, default −30d)
  &to=YYYY-MM-DD            (opcional, default hoy)
  &format=csv|json|ndjson   (opcional, default csv)
  &subscriptionId=<id>      (opcional)
  &limit=<n>                (opcional, default 100000, máx 500000)
```

### Auth (dos opciones)

1. **Sesión web** — `Authorization: Bearer <Entra ID JWT>` y rol `ADMIN` u `OWNER` en el tenant.
2. **Programática** — `Authorization: Bearer mcp_...` con una MCP API key emitida desde `/admin/mcp-keys` para el mismo `tenantId`.

### Respuesta

CSV/NDJSON: streaming con header FOCUS canónico en la primera línea (CSV).
JSON: objeto con `{ focusVersion: "1.1", tenantId, from, to, count, rows[] }`.

Cabecera adicional: `X-FOCUS-Version: 1.1`.

## Columnas emitidas (FOCUS 1.1)

47 columnas en orden canónico:

`AvailabilityZone, BilledCost, BillingAccountId, BillingAccountName, BillingCurrency, BillingPeriodEnd, BillingPeriodStart, ChargeCategory, ChargeClass, ChargeDescription, ChargeFrequency, ChargePeriodEnd, ChargePeriodStart, CommitmentDiscountCategory, CommitmentDiscountId, CommitmentDiscountName, CommitmentDiscountQuantity, CommitmentDiscountStatus, CommitmentDiscountType, CommitmentDiscountUnit, ConsumedQuantity, ConsumedUnit, ContractedCost, ContractedUnitPrice, EffectiveCost, InvoiceIssuerName, ListCost, ListUnitPrice, PricingCategory, PricingQuantity, PricingUnit, ProviderName, PublisherName, RegionId, RegionName, ResourceId, ResourceName, ResourceType, ServiceCategory, ServiceName, ServiceSubcategory, SkuId, SkuMeter, SkuPriceDetails, SkuPriceId, SubAccountId, SubAccountName, Tags`

Las columnas que el dataset interno no provee se emiten vacías (strings) o `0` (numéricas) — el archivo sigue siendo estructuralmente válido para los validadores.

## Origen de datos

Tabla `CostSnapshots` (ya tiene los campos shape FOCUS añadidos en la migración de `db.ts`).

## Tests

`__tests__/unit/focusExporter.test.ts` cubre:
- Lista canónica de columnas, sin duplicados, en orden spec.
- Mapper para rows Azure mínimos.
- Mapper para rows con shape FOCUS explícita (AWS).
- Inferencia de `ServiceCategory` por nombre de servicio.
- Normalización de tags JSON / raw.
- Manejo de fechas vacías/inválidas.
- Serialización CSV (header + escapado RFC 4180).
- Wrapper JSON con `focusVersion`.
- NDJSON line-delimited.

## QA manual

1. Login como ADMIN del tenant `acme-prod`.
2. Ir a `/admin/focus-export`.
3. Seleccionar último mes, formato CSV, descargar.
4. Abrir con: `head -1 focus-acme-prod-*.csv` → verificar header FOCUS.
5. Subir el CSV al [FOCUS Validator oficial](https://focus.finops.org/) (cuando esté disponible) — debe pasar validación estructural.
6. Probar acceso programático con MCP key:
   ```sh
   curl -H "Authorization: Bearer mcp_xxx" \
     "https://app.cscloudsolutions.io/api/exports/focus?tenantId=acme-prod&format=ndjson" \
     | head -5
   ```
7. Verificar header `X-FOCUS-Version: 1.1`.

## Roadmap

- Parquet output (vía `parquetjs`) cuando volúmenes > 100k filas/export sean comunes.
- Compresión gzip on-the-fly.
- Multi-cloud merge (Azure + AWS en el mismo export) cuando integración AWS esté lista.
- Cron job opcional para generar y subir al S3/Blob del cliente.
