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

variable "backup_database_name" {
  description = "Nombre de la base cuyos dumps viven en db-backups/. Hace falta porque el `prefix_match` del lifecycle es un prefijo literal: la ruta es db-backups/<base>/<clase>/."
  type        = string
}

variable "backup_monthly_retention_days" {
  description = "Retencion de db-backups/<base>/monthly/. 1095 = 36 meses."
  type        = number
  default     = 1095
}

variable "backup_yearly_retention_days" {
  description = "Retencion de db-backups/<base>/yearly/. 3650 = 10 anios."
  type        = number
  default     = 3650
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
