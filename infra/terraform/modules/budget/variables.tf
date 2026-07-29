variable "name_base" {
  type = string
}

variable "resource_group_id" {
  type = string
}

variable "amount" {
  type = number
}

variable "start_date" {
  description = "Primer día de un mes, en UTC."
  type        = string
  default     = "2026-08-01T00:00:00Z"
}

variable "alert_email" {
  type = string
}
