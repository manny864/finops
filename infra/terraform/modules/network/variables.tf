variable "name_base" {
  description = "Base de nombres: cscs-<proyecto>-<ambiente>-<region>. El tipo va como SUFIJO."
  type        = string
}

variable "location" {
  type = string
}

variable "address_space" {
  type = list(string)
}

variable "apps_subnet_prefix" {
  description = "Debe ser /23 o mayor: lo exige el entorno de Container Apps."
  type        = string
}

variable "pe_subnet_prefix" {
  type = string
}

variable "mysql_subnet_prefix" {
  type = string
}

variable "tags" {
  type = map(string)
}

variable "nat_gateway_enabled" {
  description = "Crea un NAT Gateway (Standard) con una IP pública fija y lo asocia a la subred de apps: toda la salida del entorno de Container Apps pasa a salir por esa IP. Ver main.tf."
  type        = bool
  default     = false
}

variable "nat_gateway_idle_timeout_minutes" {
  description = "Minutos de inactividad antes de que el NAT Gateway libere una conexión TCP (4 a 120)."
  type        = number
  default     = 10

  validation {
    condition     = var.nat_gateway_idle_timeout_minutes >= 4 && var.nat_gateway_idle_timeout_minutes <= 120
    error_message = "idle_timeout_in_minutes del NAT Gateway va de 4 a 120."
  }
}
