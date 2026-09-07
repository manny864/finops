# Revisión de performance de la infra — 2026-09-07

Lectura de `infra/terraform/` contra `environments/prod/terraform.tfvars` y el
código que corre encima. **No tuve acceso a métricas de Azure**, así que lo que
sigue separa lo que se puede afirmar leyendo la config de lo que hay que medir
antes de tocar. Donde hace falta un número real, digo cuál mirar.

## Resumen

La arquitectura está bien elegida: VNet injection en MySQL (sin private endpoint
que pagar), Managed Redis con `EnterpriseCluster` porque el cliente no es
cluster-aware, readiness probe antes de recibir tráfico, secretos por Key Vault,
el crontab en git. Nada de eso hay que rehacerlo.

Los problemas son de **dimensionamiento y de señal**, y se concentran en un solo
punto: **todo el trabajo pesado de fondo corre adentro de las mismas réplicas que
sirven al usuario, y el autoscaler no lo ve.**

| # | Hallazgo | Impacto | Confianza |
|---|---|---|---|
| P1 | La regla de escalado no puede ver la carga de los crons | Alto | Verificado en config |
| P2 | Los cron jobs bajan la imagen entera de la app para un `fetch` | Alto | Verificado en config |
| P3 | MySQL Burstable + pool de 10 con cola infinita | Alto | Necesita métrica |
| P4 | `anomaly-detection` corre 12× más seguido que su propio cache | Medio | Verificado, ya anotado en el tfvars |
| P5 | `min_replicas = 1` | Medio | Verificado en config |
| P6 | `cost-optimization.md` quedó desactualizado y subestima 4× | Medio | Verificado |

---

## P1 — El autoscaler mide concurrencia, y la carga real no es concurrente

```hcl
http_scale_rule { concurrent_requests = "40" }
min_replicas = 1
max_replicas = 5
```

Los 14 cron jobs **no corren la app**: hacen un `fetch` autenticado a
`/api/cron/*` sobre el mismo Container App que atiende a los usuarios. O sea que
el barrido de ARM, el backfill y los prewarms se ejecutan **dentro de las
réplicas web**.

Y llegan como **pocas peticiones muy largas**, no como muchas concurrentes.
Cuentas de la cadencia declarada:

| Job | Cadencia | Ejecuciones/hora |
|---|---|---|
| `power-schedules` | `*/2` | 30 |
| `anomaly-detection` | `*/5` | 12 |
| `status-snapshot` | `*/5` | 12 |
| `prewarm-dashboard` | `*/10` | 6 |
| `prewarm-databases` | `*/15` | 4 |
| `prewarm-compute` | `*/15` | 4 |
| `prewarm-mysql-finops` | `*/20` | 3 |

**71 invocaciones por hora, 24/7.** Y en el minuto `:00` de cada hora los siete
alinean: siete peticiones simultáneas, varias de ellas barridos de ARM que ya se
sabe que pasan los 240 s del ingress.

Siete concurrentes contra un umbral de 40 es **17%**. El scaler no agrega
réplica. Se queda en una, con el vCPU clavado, mientras el usuario que abre el
dashboard a las en punto espera detrás.

**Ese es el problema de fondo detrás de los 504.** Todo el andamiaje de
`async_poll` —`?status=1`, locks en Redis, `timeout_seconds` de 900— existe
porque los barridos superan los 240 s. Eso arregló el *reporte* (que Azure
dejara de marcar Failed una corrida que sí terminaba), no la *latencia*. La
latencia sigue ahí y ahora también la paga el usuario.

**Qué hacer, de menor a mayor:**

1. **Bajar `concurrent_requests` de 40 a ~10.** Una línea. 40 concurrentes sobre
   1 vCPU sirviendo SSR de Next.js no es un umbral realista ni para tráfico de
   usuario. Con 10, el scaler reacciona en la primera colisión de crons.
2. **Agregar una regla por CPU** junto a la de HTTP (Container Apps las evalúa
   en OR, escala con la que dispare primero). El módulo `containerapp` hoy sólo
   declara `http_scale_rule`; hay que sumarle un `custom_scale_rule` de tipo
   `cpu` con `type: Utilization`, `value: 70`.
3. **Lo correcto a mediano plazo:** que los `/api/cron/*` no compartan réplica
   con el usuario. Container Apps no permite dos ingress en la misma app, así
   que sería un segundo Container App con la misma imagen, sin ingress externo,
   al que apunten los jobs. Es un stamp más chico, no un rediseño. **No lo haría
   todavía** — primero 1 y 2, y medir.

---

## P2 — Cada cron baja la imagen completa de la app para correr 20 líneas

```hcl
image   = "${var.registry_server}/${var.image_name}:${var.image_tag}"   # finops:latest
cpu     = 1.0
memory  = "2Gi"
command = ["node", "-e", local.runner]
```

El `runner` es un `fetch` y un `console.log`. **No usa una sola línea de código
de la app.** Pero cada ejecución baja la imagen de producción de Next.js desde un
**ACR Basic**, que es el tier de menor throughput.

Lo dice el propio módulo, midiéndolo: `power-schedules` hace su trabajo en
**107 ms** y la ejecución logueó **a los 21 segundos**. El resto es pull y
arranque.

Son **~51.000 ejecuciones/mes**. A ~21 s y 1 vCPU son **~1.070.000 vCPU-s/mes**
contra un free grant de 180.000.

**Qué hacer:** apuntar los jobs a una imagen pública chica —`node:22-alpine` o
la de MCR— y bajar a `0.25` vCPU / `0.5Gi`. `fetch` es nativo desde Node 18, no
hace falta nada más. Elimina el pull de ACR (y su autenticación por managed
identity), reduce el arranque a un par de segundos y divide por cuatro el
consumo. Es un cambio de dos variables en el módulo `cronjobs`.

Ojo con la directiva del 2026-08-13 que estandarizó todos los jobs a 1.0/2Gi:
tenía sentido cuando se pensaba que los jobs corrían trabajo, y no lo tiene para
un `fetch`. Vale la pena anotarlo al cambiarla.

---

## P3 — MySQL Burstable, con un pool de 10 y cola infinita

```hcl
mysql_sku_name          = "B_Standard_B2s"   # Burstable
mysql_high_availability = false
```
```ts
connectionLimit: Number(process.env.DB_POOL_LIMIT || 10),
queueLimit: 0,   // cola sin límite
```

`DB_POOL_LIMIT` no está en el tfvars, así que corre con el default: **10
conexiones por réplica**. Con `max_replicas = 5` son 50 en el pico.

Dos cosas, y la segunda importa más que la primera:

**El tier es por créditos.** Burstable acumula crédito de CPU cuando está ocioso
y lo quema bajo carga; agotado, queda en su baseline. Un backfill de 13 meses
que hace upsert día por día, más 71 barridos por hora escribiendo snapshots, es
exactamente el perfil que lo agota. El propio `cost-optimization.md` ya tiene la
regla escrita: *MySQL >80% CPU sostenido → GP_Standard_D2ds_v4, +USD 70*.

**`queueLimit: 0` convierte la saturación en timeout.** Cuando las 10 conexiones
están ocupadas, la petición 11 espera **sin límite** en vez de fallar rápido.
Encadenado con el techo de 240 s del ingress, el síntoma que ve el usuario no es
"la base está ocupada" sino un **504 sin explicación** — el mismo 504 que se
viene tapando con `async_poll`.

**Qué hacer:**

1. **Medir antes de gastar.** En el portal, sobre el MySQL Flexible:
   `cpu_percent`, **`credits_remaining`** (la que decide si Burstable alcanza o
   no) y `active_connections`, en ventana de 7 días. Si `credits_remaining` toca
   cero en las corridas nocturnas, el SKU es el problema y el resto es ruido.
2. **Ponerle techo a la cola ya**, independientemente del SKU: `queueLimit` en
   un valor finito (p. ej. 20) hace que la saturación se vea como un error claro
   y no como un cuelgue de cuatro minutos.
3. Si la métrica confirma: `B_Standard_B2s` → `GP_Standard_D2ds_v4`. Eso además
   **habilita HA**, que hoy está en `false` — un evento de mantenimiento de Azure
   es corte, no failover.

---

## P4 — `anomaly-detection` corre cada 5 minutos sobre un cache de 6 horas

Ya está anotado en el tfvars, palabra por palabra: *"si las corridas lentas se
vuelven la norma, el problema es la cadencia y no el timeout: con un cache de
6h, cada 5 minutos es más de lo necesario."* Nadie lo cambió.

**8.640 ejecuciones/mes para refrescar algo que cambia 4 veces por día.** Y como
el `timeout_seconds` es 900 y dispara cada 300, puede haber **tres ejecuciones
simultáneas sondeando el mismo barrido**, cada una con 1 vCPU / 2 GiB
asignados.

`*/30` deja 1.440 al mes y sigue siendo 12× más frecuente que el cache. Es la
línea con mejor relación resultado/esfuerzo de toda esta lista.

---

## P5 — `min_replicas = 1`

No hay cold start (bien, no es scale-to-zero), pero sí un único punto por el que
pasa todo: cada deploy y cada reinicio de plataforma se atraviesa con una sola
réplica, y esa misma réplica es la que P1 deja saturada en el `:00`.

`cost-optimization.md` lo tiene tarifado en +USD 45. Yo lo pondría en 2 **después**
de hacer P1 y P2, no antes: si los crons dejan de competir, capaz alcanza con
una y el gasto no hace falta.

---

## P6 — El documento de costos ya no describe esta infra

`cost-optimization.md` es de la migración y quedó atrás en tres puntos que
cambian su conclusión:

| Dice | Es |
|---|---|
| Jobs a **0.25 vCPU**, ~10 s | **1.0 vCPU / 2 GiB**, ~21 s medidos |
| ~115.000 vCPU-s/mes, *"apenas por debajo del free grant (180.000)"* | ~1.070.000 vCPU-s/mes, **~6× por encima** |
| **Azure Cache for Redis Basic C0**, 250 MB, USD 16 | **Azure Managed Redis `Balanced_B3` con HA** — otro producto, otro orden de precio |

El total de *"~USD 210–280"* y el `monthly_budget_amount = 250` del tfvars salen
de esos supuestos. **No verifiqué la factura real** —no tengo acceso—, pero con
Managed Redis B3 + HA en lugar de un C0 el número no cierra ni de cerca. Vale la
pena mirar Cost Analysis del resource group antes que cualquier otra cosa de esta
lista: es gratis y probablemente cambie las prioridades.

Detalle no menor para este producto en particular: la plataforma que le vende
FinOps a otros tiene el presupuesto desalineado con su propia infra.

---

## Orden que yo seguiría

1. **Mirar Cost Analysis del RG y `credits_remaining` del MySQL.** Gratis, y
   define si esto es un problema de plata, de CPU o de las dos.
2. **P4** (`anomaly-detection` a `*/30`) y **P2** (imagen chica + 0.25 vCPU).
   Son dos cambios de variable, sin riesgo, y bajan la carga de fondo antes de
   tocar nada más.
3. **P1.1** (`concurrent_requests` a 10) y el `queueLimit` finito de **P3.2**.
4. Recién ahí, con la carga de fondo ya bajada, decidir sobre el SKU de MySQL,
   `min_replicas` y la regla de CPU. Puede que la mitad deje de hacer falta.

## Aparte: dos archivos que sobran en `environments/prod/`

`errored.tfstate` y `tfplan`, los dos del **28 de julio**. Están gitignoreados,
así que son locales. `errored.tfstate` es lo que Terraform deja cuando un apply
no pudo escribir el state — de la migración, y desde entonces los applies
funcionaron. No molestan, pero un `errored.tfstate` en el directorio es de las
cosas que asustan a las 3 de la mañana. Borrables.
