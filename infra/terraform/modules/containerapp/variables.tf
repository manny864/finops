variable "name_base" {
  description = "Base de nombres. El tipo va como sufijo."
  type        = string

  validation {
    condition     = length("${var.name_base}-web") <= 32
    error_message = "El nombre del Container App supera los 32 caracteres que permite Azure."
  }
}

variable "resource_group_name" {
  type = string
}

variable "environment_id" {
  type = string
}

variable "identity_id" {
  type = string
}

variable "registry_server" {
  type = string
}

variable "image_name" {
  type    = string
  default = "finops"
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "target_port" {
  type    = number
  default = 3000
}

variable "cpu" {
  type    = number
  default = 1.0
}

variable "memory" {
  type    = string
  default = "2Gi"
}

variable "min_replicas" {
  type    = number
  default = 1
}

variable "max_replicas" {
  type    = number
  default = 5
}

variable "concurrent_requests_per_replica" {
  type    = number
  default = 40
}

variable "env_vars" {
  type    = map(string)
  default = {}
}

variable "key_vault_secret_ids" {
  type    = map(string)
  default = {}
}

variable "inline_secrets" {
  type      = map(string)
  default   = {}
  sensitive = true
}

variable "secret_env_vars" {
  type    = map(string)
  default = {}
}

variable "allowed_ip_ranges" {
  type    = list(string)
  default = []
}

variable "tags" {
  type = map(string)
}
