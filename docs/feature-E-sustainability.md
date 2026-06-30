# Sustainability — Carbon Emissions (Feature E)

## Tier asignado
**Business+** (la página ya existía como overview/sustainability con tier abierto; el enriquecimiento se ofrece a Business+ en sales material).

## Qué resuelve
Toolkit MS tiene reportes Power BI de sustentabilidad. Acá se ofrece la versión SaaS: cálculo en tiempo real de emisiones desde Resource Graph + recomendaciones de migración a regiones verdes.

## Mejoras sobre la versión previa
- **35 regiones Azure** mapeadas (antes: 8). Datos basados en MS Cloud Sustainability 2024.
- **Storage accounts**: incluye emisiones de almacenamiento con multiplicador por redundancia (LRS, ZRS, GRS, GZRS).
- **Recomendaciones**: por cada región top del cliente, sugiere alternativa "verde" del mismo continente (`GREEN_PEERS`) con % de reducción y kg CO2e proyectados.
- **Equivalencias humanas**: km en auto, árboles maduros/año, cargas de smartphone.
- **Breakdown por región**: tabla con intensidad y emisiones por región, coloreada por tier.
- **Decimal.js**: todos los cálculos sin floats.
- **Autenticación**: `requireTenantAccess` (antes: público).

## Files

| File | Cambio |
|---|---|
| `src/lib/carbonData.ts` | Ampliado a 35 regiones + storage multipliers + equivalencias |
| `src/services/carbonService.ts` | `calculateEmissions`, `calculateDiskEmissions`, `calculateStorageEmissions`, `emissionsEquivalencies`, `suggestGreenMigration`, `regionIntensity` |
| `src/app/api/intelligence/sustainability/route.ts` | Reescrito: VM + Storage + zombi + recomendaciones + equivalencias + auth |
| `src/app/[locale]/overview/sustainability/page.tsx` | UI enriquecida con 6 secciones |

## Modelo de emisiones (kg CO2e/mes)

```
VM:       (0.15 kW × 730 h) × intensidad_region(g/kWh) / 1000
Storage:  (0.000721 kWh/GB-mes × GB × redundancy_mult) × intensidad / 1000
Disk:     (0.005 kW × hours) × intensidad / 1000
```

> Asunciones simplificadoras:
> - VM siempre encendida (730h/mes). Mejora futura: usar `Microsoft.Compute/virtualMachines/instanceView` para detectar `PowerState/deallocated`.
> - Storage: 500 GB por cuenta (placeholder). Mejora futura: query `Microsoft.Insights/metrics UsedCapacity`.

## Regiones verdes (peer map)

| From (sucia) | To (verde) | Razón |
|---|---|---|
| eastus, eastus2, centralus, northcentralus | canadacentral | Hydro QC |
| southcentralus | westus3 | Wind/solar |
| westeurope, germanywestcentral | norwayeast | Hydro |
| uksouth, ukwest | francecentral | Nuclear |
| eastasia | southeastasia | Marginalmente más limpio |
| koreacentral | japaneast | Marginal |

## Smoke test
```bash
curl http://localhost:3000/api/intelligence/sustainability?tenantId=xxx
# 401 sin token; con token devuelve footprint + byRegion + recommendations
```

## Próximas mejoras (no incluidas)
- Históricos: tabla `SustainabilityHistory(tenant_id, month, footprint_kg, ...)` poblada por cron mensual.
- Detección VM apagadas (descuento horas reales).
- Storage real usage via Metrics API.
- Reportes ESG exportables (CSV/PDF) por trimestre.
- Integración Azure Carbon Optimization API cuando esté GA.
