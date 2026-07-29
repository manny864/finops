variable "enabled" {
  type    = bool
  default = false
}

variable "name_base" {
  type = string
}

variable "name_compact" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "sku_name" {
  type    = string
  default = "Standard_AzureFrontDoor"
}

variable "origin_host_name" {
  description = "FQDN del stamp por defecto."
  type        = string
}

variable "extra_origins" {
  description = "Stamps adicionales con su lista de países. Ej: [{ key = \"eu\", host_name = \"...\", countries = [\"DE\",\"FR\"] }]"
  type = list(object({
    key       = string
    host_name = string
    countries = list(string)
  }))
  default = []
}

variable "tags" {
  type = map(string)
}
