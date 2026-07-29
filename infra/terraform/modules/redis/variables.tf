variable "name_base" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "sku_name" {
  description = "SKU de Azure Managed Redis. Ej: Balanced_B3."
  type        = string
  default     = "Balanced_B3"
}

variable "high_availability_enabled" {
  description = "Replica del dataset para alta disponibilidad."
  type        = bool
  default     = true
}

variable "public_network_access" {
  description = "Acceso público al cache. En prod debe quedar Disabled."
  type        = string
  default     = "Disabled"
}

variable "subnet_id" {
  description = "Subnet de private endpoints."
  type        = string
}

variable "private_dns_zone_id" {
  description = "Private DNS zone para resolver el endpoint privado."
  type        = string
}

variable "private_link_subresource_name" {
  description = "Subresource name del private endpoint de Managed Redis."
  type        = string
  default     = "redisEnterprise"
}

variable "tags" {
  type = map(string)
}
