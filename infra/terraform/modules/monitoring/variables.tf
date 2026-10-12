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

variable "retention_in_days" {
  type = number
}

variable "daily_quota_gb" {
  type    = number
  default = 1
}

variable "appinsights_sampling_percentage" {
  description = "100 = toda la telemetría. Bajarlo si la ingesta se acerca al cap diario."
  type        = number
  default     = 100
}

variable "action_group_short_name" {
  description = "Máximo 12 caracteres (límite de Azure)."
  type        = string
  default     = "cscsfinops"
}

variable "alert_email" {
  type = string
}

variable "tags" {
  type = map(string)
}

variable "security_tables_retention_days" {
  description = <<-DESC
    Retención interactiva, en días, de las tablas de seguridad del workspace (AzureDiagnostics, AzureActivity
    y StorageBlobLogs). 0 = no se gestionan (es lo que tiene prod hasta decidirlo). Entre 4 y 730 (doc del
    provider azurerm). Con la retención del workspace en 30, las tablas que alimentan una investigación
    (quién leyó un secreto, quién descargó un blob, quién cambió un permiso) sólo guardan un mes.
  DESC
  type        = number
  default     = 0

  validation {
    condition     = var.security_tables_retention_days == 0 || (var.security_tables_retention_days >= 4 && var.security_tables_retention_days <= 730)
    error_message = "security_tables_retention_days debe ser 0 (sin gestionar) o estar entre 4 y 730."
  }
}

variable "security_tables_total_retention_days" {
  description = <<-DESC
    Retención TOTAL (interactiva + archivo), en días, de las mismas tablas. Tiene que ser >= la interactiva;
    admite 4-730 o 1095, 1460, 1826, 2191, 2556, 2922, 3288, 3653, 4018, 4383 (doc del provider). El archivo se
    cobra por GB-mes y con la ingesta medida (0,1 GB/día) es marginal. ROLLBACK: igualarla a la interactiva
    (sin archivo) es un update; borrar los recursos devolvería la retención del workspace y el validador del
    apply sólo perdona un delete.
  DESC
  type        = number
  default     = 0

  validation {
    condition     = var.security_tables_total_retention_days == 0 || contains(concat(range(4, 731), [1095, 1460, 1826, 2191, 2556, 2922, 3288, 3653, 4018, 4383]), var.security_tables_total_retention_days)
    error_message = "security_tables_total_retention_days debe ser 0 (sin gestionar), 4-730 o uno de 1095, 1460, 1826, 2191, 2556, 2922, 3288, 3653, 4018, 4383."
  }
}
