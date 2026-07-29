# Optimización de costes — CS Cloud FinOps

## Prod, un stamp en West US 2

| Recurso | Config | USD/mes |
|---|---|---|
| Container App `web` | 1–5 réplicas, 1 vCPU / 2 GiB, min 1 | 45 – 90 |
| Container Apps Jobs (15) | ~23.000 ejecuciones/mes de ~10 s a 0.25 vCPU | 5 – 15 |
| MySQL Flexible B2s | 2 vCore burstable, 64 GB, backup 14 d | 55 |
| Azure Cache for Redis Basic C0 | 250 MB | 16 |
| Blob Storage ZRS | adjuntos + logos + backups | 3 – 8 |
| ACR Basic | 10 GB | 5 |
| Defender for Cloud | 5 planes | 15 – 40 |
| Key Vault + Log Analytics + App Insights | 5 GB gratis, cap 1 GB/día | 0 – 10 |
| **Total** | | **~210 – 280** |

Dev con `web_min_replicas = 0`, B1ms y sólo 2 crons: **~40**.

Contra los ~USD 25/mes del VPS actual (que además aloja m365saas), es
notoriamente más caro. Lo que se compra: el crontab en git, backups con PITR,
deploys sin downtime con rollback, sin host que parchear, y la base para la
residencia de datos. Con el crédito de Microsoft for Startups queda cubierto —
pero conviene saber qué apagar cuando el crédito termine (abajo).

### De dónde sale el número de los jobs

`power-schedules` cada 2 minutos son ~21.600 ejecuciones/mes; sumando
`prewarm-dashboard` (*/10), `anomaly-detection` y `status-snapshot` (*/5), son
~46.000 arranques de contenedor al mes. A 0.25 vCPU y ~10 s cada uno son
~115.000 vCPU-s, apenas por debajo del free grant mensual (180.000). Por eso los
jobs cuestan poco pese a ser muchos: lo que se paga es el tiempo de ejecución,
no la existencia del schedule.

Si `power-schedules` empieza a tardar más de ~30 s, ese cálculo cambia. Vale la
pena mirar la métrica antes de asumir que sigue siendo gratis.

## Reglas de la casa

- **Empezar chico y medir.** Ninguna reserva ni Savings Plan hasta tener un mes
  de facturación real.
- **Presupuesto por resource group**, no por suscripción: si conviven FinOps y
  m365saas en la misma suscripción, cada uno tiene su número. Alertas al 50 /
  75 / 90 / 100% real y al 100% proyectado.
- **Cap diario en Log Analytics.** Un loop de logs cuesta más que la app.
- **Tags obligatorios** (`Owner`, `CostCenter`, `Product`) para showback — el
  producto que le vende FinOps a otros debería practicarlo internamente.

## Escalado por síntoma

| Síntoma | Cambio | Delta USD/mes |
|---|---|---|
| El dashboard va lento con varios tenants | subir `web_max_replicas` | +20 por réplica activa |
| Deploys con corte molestan | `web_min_replicas = 2` | +45 |
| MySQL >80% CPU sostenido | B2s → GP_Standard_D2ds_v4 | +70 |
| Primer SLA contractual | `mysql_high_availability = true` (exige GP) | +125 |
| Redis se llena (evictions) | Basic C0 → C1, o Standard con réplica | +25 a +60 |
| Cliente europeo exige residencia | stamp `eu` + Front Door | +210 (stamp) +35 |
| Compliance pide red privada | `keyvault_private_endpoint_enabled = true` | +7 |

## Cuando se termine el crédito

En orden de "más ahorro por menos dolor":

1. **Defender for Cloud** → apagar (−15 a −40). Es lo primero que sobra si no
   hay alguien mirando las alertas.
2. **`web_min_replicas = 0`** fuera de horario laboral con un job que lo cambie
   (−20 a −30). Irónico y apropiado: es lo mismo que hace `power-schedules`
   para las VMs de los clientes.
3. **Reservas de MySQL a 1 año** (−38% sobre 55) y Savings Plan de Container
   Apps (−~15%).
4. **Bajar `appinsights_sampling_percentage`** si la ingesta creció.
5. **Redis Basic → sidecar** sólo si se vuelve a una sola réplica; recién ahí
   tiene sentido y cuesta la HA del cache.

## Trampas conocidas

- **ACR Basic da 10 GB.** La imagen es alpine (~200 MB), así que entran ~50
  tags — más margen que en un proyecto con imágenes pesadas, pero igual hay
  que purgar.
- **La retención de backups de MySQL se paga** más allá del 100% del storage
  aprovisionado. Con 64 GB y 14 días de retención sobre una base que crece por
  snapshots diarios de costo, esto se alcanza antes de lo que parece.
- **Los jobs corren la misma imagen que la app.** Si el pipeline no los
  actualiza, ejecutan código viejo contra una base ya migrada — peor que no
  correr. Está resuelto en `deploy.yml`, pero es la primera cosa a revisar si
  algo se comporta raro después de un deploy.
