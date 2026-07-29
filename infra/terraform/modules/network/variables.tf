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
