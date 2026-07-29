output "enabled_plans" {
  value = var.enabled ? var.resource_types : []
}
