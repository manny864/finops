variable "name_base" {
  description = "Base de nombres: cscs-<proyecto>-<ambiente>-<region>. El tipo va como SUFIJO."
  type        = string
}

variable "resource_group_name" {
  type = string
}

variable "vnet_id" {
  type = string
}

variable "redis_enabled" {
  type    = bool
  default = false
}

variable "tags" {
  type = map(string)
}
