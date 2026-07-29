variable "name_base" {
  type = string
}

variable "environment" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "resource_group_id" {
  type = string
}

variable "locked_resource_ids" {
  description = "nombre => id de los recursos con datos que se protegen del borrado. Las claves tienen que ser estáticas."
  type        = map(string)
  default     = {}
}

variable "resource_lock_enabled" {
  description = "Feature flag de locks de borrado en recursos de datos. Default desactivado."
  type        = bool
  default     = false
}

variable "alerts_enabled" {
  type    = bool
  default = true
}

variable "container_app_id" {
  type    = string
  default = null
}

variable "action_group_id" {
  type    = string
  default = null
}

variable "tags" {
  type = map(string)
}
