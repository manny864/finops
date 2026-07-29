# El lock va sobre los recursos CON DATOS, nunca sobre el resource group.
#
# Un lock a nivel de RG cascadea a todo lo que hay adentro, incluida la VNet, y
# eso rompe operaciones legítimas:
#
#  - MySQL Flexible con VNet injection NO se puede crear: Azure responde
#    VirtualNetworkLocked porque necesita operar sobre la VNet.
#  - Cualquier apply que borre un recurso del RG falla con ScopeLocked 409.
#
# Bloqueando sólo la base y la Storage se protege lo que de verdad duele perder,
# y se deja operar libremente al resto — que es todo recreable desde este mismo
# Terraform.
#
# Sigue siendo un flag: para un apply que necesite borrar uno de estos dos
# recursos, se corre con -var resource_lock_enabled=false y se reactiva después.
resource "azurerm_management_lock" "data_resources" {
  for_each = var.environment == "prod" && var.resource_lock_enabled ? var.locked_resource_ids : {}

  name       = "${var.name_base}-${each.key}-lock"
  scope      = each.value
  lock_level = "CanNotDelete"
  notes      = "Protección de eliminación para producción: este recurso tiene datos."
}

# Alerta de salud: si la app deja de responder el health check, llega mail.
resource "azurerm_monitor_metric_alert" "app_down" {
  # El count NO puede depender de container_app_id: es un id que Terraform no
  # conoce hasta el apply, y ahí falla con "count value depends on resource
  # attributes that cannot be determined until apply".
  count               = var.alerts_enabled ? 1 : 0
  name                = "${var.name_base}-replicas-alert"
  resource_group_name = var.resource_group_name
  scopes              = [var.container_app_id]
  description         = "El Container App se quedó sin réplicas corriendo."
  severity            = 1
  frequency           = "PT5M"
  window_size         = "PT15M"

  criteria {
    metric_namespace = "Microsoft.App/containerApps"
    metric_name      = "Replicas"
    aggregation      = "Average"
    operator         = "LessThan"
    threshold        = 1
  }

  action {
    action_group_id = var.action_group_id
  }

  tags = var.tags
}
