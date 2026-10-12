variable "name_base" {
  type = string
}

variable "environment" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "resource_group_id" {
  type = string
}

variable "locked_resource_ids" {
  description = "nombre => id de los recursos con datos que se protegen del borrado. Las claves tienen que ser estáticas."
  type        = map(string)
  default     = {}
}

variable "resource_lock_enabled" {
  description = "Feature flag de locks de borrado en recursos de datos. Default desactivado."
  type        = bool
  default     = false
}

variable "alerts_enabled" {
  type    = bool
  default = true
}

variable "activity_alerts_enabled" {
  description = "Alertas de Activity Log (cambios de privilegio y borrado de recursos con datos), a nivel de suscripción. Encender en UN solo stamp. Ver audit.tf."
  type        = bool
  default     = false
}

variable "policy_audit_enabled" {
  description = "Asigna políticas integradas de Azure en modo auditoría (enforce = false) sobre el resource group del stamp. No bloquea nada. Ver audit.tf."
  type        = bool
  default     = false
}

variable "container_app_id" {
  type    = string
  default = null
}

variable "action_group_id" {
  type    = string
  default = null
}

variable "tags" {
  type = map(string)
}

variable "activity_log_export_enabled" {
  description = <<-DESC
    Exporta el Activity Log de la SUSCRIPCIÓN al workspace de Log Analytics (categorías Administrative,
    Security, Policy y Alert). Sin esto el Activity Log sólo vive 90 días en Azure y no se puede consultar
    junto con el resto. Exportarlo no cobra ingesta (doc de Azure Monitor). Es de la suscripción: se enciende
    en UN solo stamp. Apagarlo borra un recurso, que el validador del apply sí deja pasar (un delete, por replace).
  DESC
  type        = bool
  default     = false
}

variable "workspace_id" {
  description = "Workspace de Log Analytics que recibe el Activity Log. Obligatorio si activity_log_export_enabled."
  type        = string
  default     = null
}
