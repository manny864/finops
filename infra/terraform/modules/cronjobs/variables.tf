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

variable "image_tag" {
  type    = string
  default = "latest"
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
