variable "name_base" {
  description = "Base de nombres: cscs-<proyecto>-<ambiente>-<region>. El tipo va como SUFIJO."
  type        = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "database_name" {
  type    = string
  default = "finops"
}

variable "admin_login" {
  type = string
}

variable "admin_password" {
  type      = string
  sensitive = true
}

variable "sku_name" {
  type = string
}

variable "mysql_version" {
  description = "Versión de MySQL con la que se CREA el servidor. En uno existente se ignora (lifecycle): la actualización de versión mayor es manual."
  type        = string
  default     = "8.0.21"

  validation {
    condition     = contains(["5.7", "8.0.21", "8.4"], var.mysql_version)
    error_message = "El provider admite 5.7, 8.0.21 y 8.4."
  }
}

variable "storage_gb" {
  type = number
}

variable "backup_retention_days" {
  type = number
}

variable "geo_redundant_backup_enabled" {
  type    = bool
  default = false
}

variable "high_availability" {
  description = "Requiere sku GP_*. Burstable no lo soporta."
  type        = bool
  default     = false
}

variable "subnet_id" {
  type = string
}

variable "private_dns_zone_id" {
  type = string
}

variable "tags" {
  type = map(string)
}

variable "enable_delete_lock" {
  type        = bool
  description = "Aplica bloqueo CanNotDelete contra borrado accidental del servidor MySQL"
  default     = true
}
