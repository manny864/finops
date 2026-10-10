variable "enabled" {
  type    = bool
  default = false
}

variable "name_base" {
  type = string
}

variable "name_compact" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "sku_name" {
  type    = string
  default = "Standard_AzureFrontDoor"
}

variable "origin_host_name" {
  description = "FQDN del stamp por defecto."
  type        = string
}

variable "extra_origins" {
  description = "Stamps adicionales con su lista de países. Ej: [{ key = \"eu\", host_name = \"...\", countries = [\"DE\",\"FR\"] }]. private_link_target_id y private_link_location (opcionales) conectan ese origin por Private Link."
  type = list(object({
    key                    = string
    host_name              = string
    countries              = list(string)
    private_link_target_id = optional(string)
    private_link_location  = optional(string)
  }))
  default = []
}

variable "origin_private_link" {
  description = <<-DESC
    Si no es null, el origin por defecto se conecta por Private Link al Container Apps
    environment (target_type managedEnvironments): target_id es el id del managed
    environment y location su región. Exige SKU Premium y, para que sea el único camino,
    que el entorno tenga el acceso público deshabilitado (stamp: app_private_access_only).
    Después del apply hay que APROBAR la conexión de endpoint privado pendiente.
  DESC
  type = object({
    target_id       = string
    location        = string
    request_message = optional(string, "AFD Private Link Request")
  })
  default = null
}

variable "custom_domain_host_name" {
  description = "FQDN del dominio propio en Front Door (certificado gestionado). Vacío = sólo el hostname *.azurefd.net. Ver el comentario del recurso en main.tf."
  type        = string
  default     = ""
}

variable "waf_mode" {
  description = "Detection registra sin bloquear; Prevention bloquea. Arrancar en Detection, revisar el log del WAF y recién después pasar a Prevention."
  type        = string
  default     = "Prevention"

  validation {
    condition     = contains(["Detection", "Prevention"], var.waf_mode)
    error_message = "waf_mode es Detection o Prevention."
  }
}

variable "waf_bot_protection_enabled" {
  description = "Agrega el ruleset administrado Microsoft_BotManagerRuleSet 1.1 (sólo Premium)."
  type        = bool
  default     = true
}

variable "waf_bot_action" {
  description = "Acción del ruleset de bots: Log (sólo registra, default), Allow, Block o Redirect."
  type        = string
  default     = "Log"

  validation {
    condition     = contains(["Allow", "Log", "Block", "Redirect"], var.waf_bot_action)
    error_message = "waf_bot_action es Allow, Log, Block o Redirect."
  }
}

variable "waf_rate_limit_enabled" {
  description = "Agrega una regla de límite de pedidos por IP de cliente (sólo Premium)."
  type        = bool
  default     = true
}

variable "waf_rate_limit_action" {
  description = "Acción al superar el umbral: Log (sólo mide, default), Block, Redirect, JSChallenge o CAPTCHA."
  type        = string
  default     = "Log"

  validation {
    condition     = contains(["Allow", "Block", "Log", "Redirect", "JSChallenge", "CAPTCHA"], var.waf_rate_limit_action)
    error_message = "waf_rate_limit_action es Allow, Block, Log, Redirect, JSChallenge o CAPTCHA."
  }
}

variable "waf_rate_limit_threshold" {
  description = "Pedidos permitidos por IP de cliente en la ventana. Estimación sin datos de tráfico: medir con el log antes de bloquear."
  type        = number
  default     = 1200

  validation {
    condition     = var.waf_rate_limit_threshold >= 10
    error_message = "El umbral mínimo razonable es 10 pedidos."
  }
}

variable "waf_rate_limit_duration_minutes" {
  description = "Ventana del límite de pedidos: 1 o 5 minutos."
  type        = number
  default     = 1

  validation {
    condition     = contains([1, 5], var.waf_rate_limit_duration_minutes)
    error_message = "La ventana del rate limit de Front Door es de 1 o 5 minutos."
  }
}

variable "tags" {
  type = map(string)
}
