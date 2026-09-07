# Objetivos de performance — qué modificar exactamente

Derivado de [`revision-performance-2026-09-07.md`](./revision-performance-2026-09-07.md).
Cada objetivo dice el archivo y la línea, el valor actual, el valor objetivo, qué
se gana y cómo se verifica. En tres olas: primero medir, después bajar carga de
fondo, y sólo al final gastar plata.

**Nada de esto está aplicado.** `infra/terraform/**` no se toca sin instrucción
explícita.

---

## Ola 0 — Medir (gratis, sin cambios)

### O0.1 · Saber si Burstable alcanza

Portal → `cscs-finops-prod-wus2-mysql` → Metrics, ventana **7 días**:

| Métrica | Qué decide |
|---|---|
| `credits_remaining` | **La que importa.** Si toca 0 en las corridas nocturnas, el SKU es el techo y O3.1 deja de ser opcional |
| `cpu_percent` | >80% sostenido = la regla ya escrita en `cost-optimization.md` |
| `active_connections` | Contra el `max_connections` del SKU. Si se acerca, O2.2 es urgente |

### O0.2 · Saber cuánto cuesta de verdad

Portal → Cost Analysis del RG `cscs-finops-prod-westus2-rg`, mes en curso,
agrupado por servicio.

Buscás una cosa: **cuánto pesa Redis**. `cost-optimization.md` lo presupuestó
como "Basic C0, USD 16" y corre **Managed Redis `Balanced_B3` con HA**, que es
otro producto. Si es lo que sospecho, el `monthly_budget_amount = 250` no
describe nada y conviene reordenar esta lista antes de seguir.

**Salida de la ola 0:** dos números. Sin ellos, O3.1 y O3.2 son adivinanza.

---

## Ola 1 — Bajar la carga de fondo (barato, sin riesgo)

Objetivo medible de la ola: **que los cron jobs vuelvan a entrar en el free grant
mensual** (180.000 vCPU-s / 360.000 GiB-s).

Hoy: ~51.400 ejecuciones/mes × ~21 s × 1.0 vCPU ≈ **1.070.000 vCPU-s**, casi 6×
por encima.

### O1.1 · `anomaly-detection` cada 30 min, no cada 5

**`infra/terraform/environments/prod/terraform.tfvars:204`**

```diff
-  anomaly-detection = { cron = "*/5 * * * *",  timeout_seconds = 900, async_poll = true }
+  anomaly-detection = { cron = "*/30 * * * *", timeout_seconds = 900, async_poll = true }
```

El cache es de 6 h. Cada 30 min sigue siendo **12× más frecuente** que el dato.
Ya está anotado en el propio tfvars ("con un cache de 6h, cada 5 minutos es más
de lo necesario") y nunca se cambió.

- **Gana:** 8.640 → 1.440 ejecuciones/mes. Y elimina el solapamiento: hoy
  dispara cada 300 s con `timeout_seconds = 900`, así que puede haber **tres
  ejecuciones sondeando el mismo barrido**, cada una con 1 vCPU / 2 GiB.
- **Verificación:** en `/superadmin/health`, `anomaly-detection` pasa de ~288 a
  ~48 corridas/día y ninguna queda en `warning` por lock.
- **Riesgo:** ninguno. El lock en Redis ya garantiza un solo barrido.

### O1.2 · Los crons dejan de bajar la imagen de la app

Hoy cada job baja la imagen de producción de Next.js desde **ACR Basic** para
correr un `fetch` de 20 líneas. El módulo lo mide solo: `power-schedules`
trabaja **107 ms** y la ejecución loguea **a los 21 s**.

El `Dockerfile` ya arranca en `FROM node:22-alpine AS base` — los jobs necesitan
esa base, no la etapa `runner`. `fetch` y `AbortSignal.timeout` son nativos.

**Paso 1 — subir el tag, ANTES del apply** (si no existe, los jobs no arrancan):

```bash
az acr import --name cscsfinopsprodglobalcr \
  --source docker.io/library/node:22-alpine --image finops:cron
```

`az acr import` y **no** `docker pull && docker push`. Tres motivos, y el
tercero es el que muerde:

1. Copia el manifiesto del lado del servidor: no necesita docker local.
2. No gasta el rate limit de pulls anónimos de Docker Hub (100 cada 6 h — con
   ~70 pulls/hora lo tocaríamos).
3. **Conserva el manifest list multi-arch.** Un `docker pull` desde una Mac trae
   el binario **ARM64**, y Container Apps corre **amd64**: los 14 jobs
   arrancarían y morirían con `exec format error`. Si hubiera que hacerlo con
   docker sí o sí, va con `--platform linux/amd64` explícito.

Queda en el mismo ACR, así que no cambia la autenticación por managed identity.

**Paso 2 — tres variables nuevas en `infra/terraform/modules/cronjobs/variables.tf`:**

```hcl
variable "runner_image_tag" {
  description = "Tag de la imagen de los jobs. No corren la app: sólo node + fetch."
  type        = string
  default     = "cron"
}
variable "runner_cpu"    { type = number, default = 0.25 }
variable "runner_memory" { type = string, default = "0.5Gi" }
```

**Paso 3 — `infra/terraform/modules/cronjobs/main.tf:288-290`:**

```diff
-      image  = "${var.registry_server}/${var.image_name}:${var.image_tag}"
-      cpu    = 1.0
-      memory = "2Gi"
+      image  = "${var.registry_server}/${var.image_name}:${var.runner_image_tag}"
+      cpu    = var.runner_cpu
+      memory = var.runner_memory
```

- **Gana:** el arranque baja de ~21 s a unos pocos segundos, y el consumo se
  divide por cuatro. Con O1.1: ~44.000 ejecuciones × ~5 s × 0.25 vCPU ≈
  **55.000 vCPU-s/mes** — dentro del free grant, que es el objetivo de la ola.
- **Verificación:** en el portal, la duración de una ejecución de
  `cron-power-schedules` baja de ~21 s a <5 s. Y el `ms` del log JSON no cambia
  (el trabajo siempre fueron 107 ms).
- **Riesgo:** bajo, pero **el orden importa**: si el tag `finops:cron` no está
  en ACR cuando corre el apply, los 14 jobs fallan al arrancar. Rollback =
  `runner_image_tag = "latest"`, `runner_cpu = 1.0`, `runner_memory = "2Gi"`.
- **Anotar de paso:** esto contradice la directiva del 2026-08-13 que
  estandarizó los jobs a 1.0/2Gi. Tenía sentido cuando se creía que los jobs
  corrían trabajo; para un `fetch`, no.

---

## Ola 2 — Arreglar la señal (barato, riesgo bajo)

### O2.1 · Que el autoscaler reaccione antes

**`infra/terraform/environments/prod/terraform.tfvars:71`**

```diff
-    concurrent_requests_per_replica = 40
+    concurrent_requests_per_replica = 10
```

En el `:00` de cada hora coinciden siete crons. Siete concurrentes contra un
umbral de 40 es **17%**: el scaler no agrega réplica y el usuario que abre el
dashboard espera detrás de los barridos de ARM. Con 10, la primera colisión ya
dispara la segunda réplica.

40 concurrentes sobre 1 vCPU sirviendo SSR de Next.js no es un umbral realista
ni siquiera para tráfico de usuario.

- **Verificación:** la métrica `Replicas` del Container App deja de ser una
  línea plana en 1 y muestra picos en el `:00`.
- **Riesgo:** más réplicas activas = más costo (≈ +USD 20 por réplica activa
  según `cost-optimization.md`). Es el costo de que el dashboard no se frene.
  Rollback = volver a 40.

### O2.2 · Que la saturación de base falle rápido, no cuelgue

**`src/modules/storage/db.ts:16`**

```diff
-    queueLimit: 0,
+    // Finito a propósito: con 0 la petición 11 espera sin límite, choca contra
+    // el techo de ~240 s del ingress y el usuario ve un 504 sin explicación en
+    // vez de un error de base. Ver revision-performance-2026-09-07.md.
+    queueLimit: Number(process.env.DB_QUEUE_LIMIT || 20),
```

`DB_POOL_LIMIT` no está en el tfvars, así que el pool corre con el default de
**10 conexiones por réplica**.

- **Gana:** la saturación se ve como lo que es. Es la causa que se viene tapando
  con `async_poll`: eso arregló el *reporte* (que Azure dejara de marcar Failed
  una corrida que sí terminaba), no la *latencia*.
- **Verificación:** bajo carga aparece `ER_CON_COUNT_ERROR` / queue limit en los
  logs en vez de 504 mudos. Que aparezca **es** el resultado: información donde
  antes había un cuelgue.
- **Riesgo:** bajo. Cambia un cuelgue por un error explícito. Es código de app,
  no infra: entra por deploy normal y no necesita `terraform apply`.

### O2.3 · Regla de escalado por CPU

**`infra/terraform/modules/containerapp/main.tf`**, junto al `http_scale_rule`
de la línea 85:

```hcl
custom_scale_rule {
  name             = "cpu-utilization"
  custom_rule_type = "cpu"
  metadata = {
    type  = "Utilization"
    value = "70"
  }
}
```

Container Apps evalúa las reglas en OR: escala con la que dispare primero. Es la
que ve la carga que O2.1 sólo aproxima — un barrido pesado clava el vCPU sin
subir la concurrencia.

- **Verificación:** con O2.1 aplicado, comparar si los picos de `Replicas`
  coinciden con los de `CPU`. Si el CPU sube y las réplicas no, esta regla es la
  que faltaba.
- **Riesgo:** bajo, pero **hacerlo después de O2.1 y medir en el medio**. Dos
  reglas nuevas a la vez y no se sabe cuál sirvió.

---

## Ola 3 — Gastar (sólo si la ola 0 lo justifica)

### O3.1 · MySQL a General Purpose

**`terraform.tfvars:32` y `:35`**

```diff
-    mysql_sku_name          = "B_Standard_B2s"
-    mysql_high_availability = false
+    mysql_sku_name          = "GP_Standard_D2ds_v4"
+    mysql_high_availability = true
```

**Condición de disparo:** que O0.1 muestre `credits_remaining` tocando 0, o
`cpu_percent` >80% sostenido. Si no, no.

- **Gana:** se acaba el modelo de créditos, y **habilita HA** — hoy en `false`,
  o sea que un mantenimiento de Azure es corte, no failover.
- **Costo:** +USD 70 el SKU, +USD 125 con HA (números de `cost-optimization.md`,
  que conviene rehacer con O0.2 en la mano).
- **Riesgo:** el cambio de SKU reinicia el servidor. Ventana de mantenimiento.
  Los dos van juntos: Burstable **no soporta** `high_availability` — ponerlo en
  `true` sin subir el SKU falla el apply.

### O3.2 · `min_replicas = 2`

**`terraform.tfvars:69`**

```diff
-    web_min_replicas                = 1
+    web_min_replicas                = 2
```

**Condición de disparo:** que después de las olas 1 y 2 la métrica `Replicas`
siga mostrando saturación con una sola, o que un corte durante un deploy moleste
de verdad.

Deliberadamente último: si los crons dejan de competir por el vCPU, puede que
una réplica alcance y estos USD 45/mes no hagan falta. Gastarlos antes de medir
es tapar el síntoma de O1 y O2.

---

## Lo que NO hay que hacer todavía

- **Separar los `/api/cron/*` en un Container App propio sin ingress externo.**
  Es la solución estructural de P1 y probablemente el destino final, pero es un
  componente nuevo que mantener. Primero O2.1 + O2.3 y medir: puede que con la
  carga de fondo de la ola 1 ya baja, alcance.
- **Front Door.** Está en `false` a propósito; Cloudflare ya hace WAF/TLS/CDN.
  Recién con el segundo stamp.
- **ACR Standard.** Con O1.2 los pulls bajan a los del deploy nada más, y Basic
  sobra. Si se hace O1.2 primero, este objetivo se cae solo.

## Aparte, 30 segundos

`rm infra/terraform/environments/prod/errored.tfstate infra/terraform/environments/prod/tfplan`

Los dos del 28 de julio, gitignoreados, restos de la migración. Un
`errored.tfstate` en el directorio es de las cosas que asustan a las 3 de la
mañana sin motivo.
