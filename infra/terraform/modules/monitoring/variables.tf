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
