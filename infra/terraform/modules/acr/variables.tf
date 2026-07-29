variable "name_compact" {
  description = "Base sin guiones ni mayúsculas."
  type        = string
}

variable "geo_replication_locations" {
  description = "Sólo Premium. Con Basic el pull cross-region funciona, más lento."
  type        = list(string)
  default     = []
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "sku" {
  type    = string
  default = "Basic"
}

variable "tags" {
  type = map(string)
}
