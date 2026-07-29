variable "enabled" {
  description = "Prender en UN solo ambiente: el alcance es la suscripción entera."
  type        = bool
  default     = false
}

variable "resource_types" {
  description = "Planes de Defender a activar."
  type        = list(string)
  default = [
    "KeyVaults",                     # acceso anómalo a secretos
    "OpenSourceRelationalDatabases", # MySQL Flexible
    "StorageAccounts",
    "Containers", # ACR + Container Apps
    "Arm",        # operaciones sospechosas sobre el control plane
  ]
}

variable "alert_email" {
  type = string
}
