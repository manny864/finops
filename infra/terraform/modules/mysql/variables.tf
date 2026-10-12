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

variable "audit_log_enabled" {
  description = <<-DESC
    Activa el registro de auditoría del servidor (parámetros audit_log_enabled y audit_log_events).
    Apagado por defecto: encenderlo en un ambiente es una decisión, porque suma ingesta de logs.
    Los registros salen por el diagnostic setting `allLogs` del servidor (categoría MySqlAuditLogs, tabla
    AzureDiagnostics del workspace). Ambos parámetros son dinámicos: no reinician el servidor.
  DESC
  type        = bool
  default     = false
}

variable "audit_log_events" {
  description = <<-DESC
    Clases de evento a auditar (audit_log_events). CONNECTION_V2 incluye los intentos de conexión
    FALLIDOS con su código de error, que CONNECTION no registra: es la señal contra fuerza bruta.
    DDL y DCL (cambios de esquema y de permisos) son de bajo volumen. Se deja afuera ADMIN (incluye
    `SHOW STATUS`), DML y GENERAL: mucho volumen y poco valor de seguridad. Valores admitidos, leídos de
    `az mysql flexible-server parameter show -n audit_log_events`: DDL, DML_SELECT, DML_NONSELECT, DCL,
    ADMIN, DML, GENERAL, CONNECTION, CONNECTION_V2, TABLE_ACCESS.
  DESC
  type        = string
  default     = "CONNECTION_V2,DDL,DCL"
}
