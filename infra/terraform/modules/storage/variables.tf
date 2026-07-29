variable "name_compact" {
  description = "Base sin guiones ni mayúsculas: Storage Account no admite otra cosa."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{1,22}$", var.name_compact))
    error_message = "name_compact debe ser alfanumérico minúsculo y dejar lugar para el sufijo (máx 22)."
  }
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "replication_type" {
  description = "ZRS en prod (3 zonas, mismo precio que LRS en muchas regiones)."
  type        = string
  default     = "ZRS"
}

variable "shared_access_key_enabled" {
  description = "Necesario mientras la app use AZURE_STORAGE_CONNECTION_STRING."
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  type    = number
  default = 35
}

variable "app_principal_id" {
  type = string
}

variable "tags" {
  type = map(string)
}
