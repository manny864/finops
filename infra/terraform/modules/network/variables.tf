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

variable "apps_nsg_block_imds" {
  description = "Asocia a la subred de apps un NSG que deniega la salida a IMDS (service tag AzurePlatformIMDS). Ver main.tf."
  type        = bool
  default     = false
}

variable "segmentation_nsgs_enabled" {
  description = "INFRA-06: NSG en las subredes de private endpoints y de MySQL que sólo deja entrar a los clientes declarados (apps y *_extra_client_prefixes). Ver main.tf."
  type        = bool
  default     = false
}

variable "pe_allowed_ports" {
  description = "Puertos TCP de los private endpoints: 443 (Key Vault, AI) y 10000 (Managed Redis, EnterpriseCluster)."
  type        = list(string)
  default     = ["443", "10000"]
}

variable "pe_extra_client_prefixes" {
  description = "Prefijos CIDR, además de la subred de apps, que pueden usar los private endpoints."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for p in var.pe_extra_client_prefixes : can(cidrhost(p, 0))])
    error_message = "pe_extra_client_prefixes sólo admite CIDR (ej. 10.50.30.0/24)."
  }
}

variable "mysql_extra_client_prefixes" {
  description = "Prefijos CIDR, además de la subred de apps, que pueden conectarse a MySQL por 3306 (VM de backup, web corporativa)."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for p in var.mysql_extra_client_prefixes : can(cidrhost(p, 0))])
    error_message = "mysql_extra_client_prefixes sólo admite CIDR (ej. 10.50.30.0/24)."
  }
}

variable "egress_firewall_private_ip" {
  description = "IP privada del firewall de salida. null = sin UDR (la salida sigue por el NAT Gateway, sin filtrar destinos)."
  type        = string
  default     = null

  validation {
    condition     = var.egress_firewall_private_ip == null || can(cidrhost("${coalesce(var.egress_firewall_private_ip, "0.0.0.0")}/32", 0))
    error_message = "egress_firewall_private_ip tiene que ser una IPv4."
  }
}
