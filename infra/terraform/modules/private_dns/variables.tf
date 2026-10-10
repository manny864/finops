variable "name_base" {
  description = "Base de nombres: cscs-<proyecto>-<ambiente>-<region>. El tipo va como SUFIJO."
  type        = string
}

variable "resource_group_name" {
  type = string
}

variable "vnet_id" {
  type = string
}

variable "redis_enabled" {
  type    = bool
  default = false
}

variable "ai_services_enabled" {
  type    = bool
  default = false
}

variable "document_intelligence_enabled" {
  type    = bool
  default = false
}

variable "containerapps_enabled" {
  description = "Crea la zona privatelink.<region>.azurecontainerapps.io para el endpoint privado del entorno de Container Apps."
  type        = bool
  default     = false
}

variable "containerapps_location" {
  description = "Región del entorno de Container Apps (la zona privada lleva el nombre de la región). Sólo se usa con containerapps_enabled."
  type        = string
  default     = ""
}

variable "tags" {
  type = map(string)
}
