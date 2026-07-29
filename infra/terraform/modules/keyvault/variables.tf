variable "name_base_short" {
  description = "Base SIN región: el Key Vault tiene un límite de 24 caracteres."
  type        = string

  validation {
    condition     = length("${var.name_base_short}-kv") <= 24
    error_message = "El nombre del Key Vault supera los 24 caracteres que permite Azure."
  }
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "tenant_id" {
  type = string
}

variable "create" {
  description = "false = usar el Key Vault existente del proyecto."
  type        = bool
  default     = false
}

variable "existing_vault_name" {
  type    = string
  default = ""
}

variable "existing_vault_resource_group" {
  type    = string
  default = ""
}

variable "private_endpoint_enabled" {
  type    = bool
  default = false
}

variable "subnet_id" {
  type    = string
  default = null
}

variable "private_dns_zone_id" {
  type    = string
  default = null
}

variable "app_principal_id" {
  description = "principalId de la managed identity de la app."
  type        = string
}

variable "tags" {
  type = map(string)
}
