variable "name_base" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "environment_id" {
  type = string
}

variable "identity_id" {
  type = string
}

variable "registry_server" {
  type = string
}

variable "image_name" {
  type    = string
  default = "finops"
}

variable "app_url" {
  description = "URL de la app web a la que pegan los jobs."
  type        = string
}

variable "cron_secret_id" {
  description = "ID del secret CRON_SECRET en Key Vault."
  type        = string
}

variable "timezone_offset_hours" {
  description = "Huso en el que están escritas las expresiones cron. Argentina = -3 (sin DST desde 2009)."
  type        = number
  default     = -3
}

variable "jobs" {
  description = "Los procesos periódicos, con el cron en HORA LOCAL. La clave es el segmento de /api/cron/<clave>."
  type = map(object({
    cron            = string
    timeout_seconds = optional(number, 600)
    auth_mode       = optional(string, "header")
    # Override para endpoints cuyo nombre no entre en 32 caracteres con el
    # prefijo "cron-". Hoy el más largo es support-attachments-cleanup, que
    # queda justo en el límite.
    name = optional(string)
    # true: el runner dispara y hace polling con `?status=1` en vez de esperar
    # la respuesta completa. Hace falta para endpoints cuyo trabajo real supera
    # los ~240s que tolera el ingress de Container Apps antes de devolver 504
    # "stream timeout" — un techo de plataforma, no configurable (verificado
    # 2026-07-30: no hay `requestTimeout` en `properties.configuration.ingress`).
    # Sin esto el job queda marcado Failed aunque el trabajo termine bien del
    # lado del servidor. Sólo `sync` lo necesita hoy; default false para no
    # tocar el comportamiento de los demás.
    async_poll = optional(bool, false)
  }))

  validation {
    condition     = alltrue([for k, v in var.jobs : length(coalesce(v.name, "cron-${k}")) <= 32])
    error_message = "Algún job supera los 32 caracteres de nombre que permite Container Apps. Usar el campo `name` para acortarlo."
  }
}

variable "alerts_enabled" {
  type    = bool
  default = true
}

variable "action_group_id" {
  type    = string
  default = null
}

variable "tags" {
  type = map(string)
}

# ─── Runtime de los jobs ────────────────────────────────────────────────────
#
# Los jobs NO corren la app: el `command` es `node -e "<runner>"`, veinte
# lineas de `fetch` contra /api/cron/*. `fetch` y `AbortSignal.timeout` son
# nativos de Node desde la 18, asi que alcanza con el binario de node.
#
# Hasta el 2026-09-07 bajaban `finops:latest` --la imagen de produccion de
# Next.js entera, desde un ACR Basic-- para eso. Medido por el propio modulo:
# `power-schedules` hace su trabajo en 107 ms y la ejecucion logueaba a los
# 21 s. El resto era pull y arranque, ~51.400 veces por mes.
#
# `finops:cron` es `node:22-alpine` retagueado al mismo ACR. Mismo registry, asi
# que no cambia la autenticacion por managed identity, y evita el rate limit de
# pulls anonimos de Docker Hub (100 cada 6 h; con ~70 pulls/hora lo tocariamos).
#
# OJO CON EL ORDEN: el tag tiene que existir en el ACR ANTES del apply, o los
# 14 jobs fallan al arrancar. Se sube una sola vez, no cambia con los deploys:
#   az acr import --name cscsfinopsprodglobalcr \
#     --source docker.io/library/node:22-alpine --image finops:cron
#
# `az acr import` y no `docker pull && push`: copia el manifiesto del lado del
# servidor, asi que no depende del docker local, no gasta el rate limit de
# Docker Hub, y --esto es lo que muerde-- conserva el manifest list multi-arch.
# Un `docker pull` desde una Mac trae el binario ARM64 y los jobs no arrancan en
# Container Apps, que es amd64. Si hay que hacerlo con docker si o si, va con
# `--platform linux/amd64` explicito.
variable "runner_image_tag" {
  description = "Tag de la imagen de los jobs. Sólo necesita el binario de node."
  type        = string
  default     = "cron"
}

# 0.25 vCPU / 0.5Gi y no 1.0/2Gi (la directiva del 2026-08-13, que estandarizo
# todos los jobs). Esa directiva tenia sentido cuando se creia que los jobs
# corrian trabajo; para un fetch y un console.log, no. Container Apps cobra por
# vCPU-segundo: 1.0 vCPU sobre ~51.400 arranques de ~21 s daba ~1.070.000
# vCPU-s/mes contra un free grant de 180.000.
variable "runner_cpu" {
  description = "vCPU por job. Es un fetch: no necesita mas."
  type        = number
  default     = 0.25
}

variable "runner_memory" {
  description = "Memoria por job. Debe respetar la relacion cpu/memoria de Container Apps."
  type        = string
  default     = "0.5Gi"
}

# El perfil Consumption de Container Apps solo acepta memoria = 2x vCPU en GiB
# (0.25/0.5Gi, 0.5/1Gi, 1.0/2Gi...). Un par invalido no falla en el plan: falla
# en el apply, con un error del ARM que no nombra la relacion. Esto lo convierte
# en un mensaje legible antes de tocar Azure.
resource "terraform_data" "runner_size_valida" {
  lifecycle {
    precondition {
      condition     = var.runner_memory == format("%gGi", var.runner_cpu * 2)
      error_message = "Container Apps exige memoria = 2x vCPU en GiB. Con runner_cpu = ${var.runner_cpu} corresponde ${format("%gGi", var.runner_cpu * 2)}, no ${var.runner_memory}."
    }
  }
}
