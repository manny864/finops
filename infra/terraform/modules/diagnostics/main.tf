# Diagnostic settings reutilizable: manda todos los logs y métricas de un
# recurso al Log Analytics del stamp.
#
# El caso que justifica esto es el Key Vault: sin diagnostic settings NO hay
# registro de quién leyó qué secreto. Es la primera pregunta de cualquier
# auditoría y la única forma de investigar una credencial filtrada.
resource "azurerm_monitor_diagnostic_setting" "this" {
  for_each                   = merge(var.targets, var.metrics_only_targets)
  name                       = "${var.name_base}-${each.key}-diag"
  target_resource_id         = each.value
  log_analytics_workspace_id = var.workspace_id

  # Los de metrics_only no llevan bloque de logs: no publican ninguna categoría
  # y Azure rechaza el request entero con 400.
  dynamic "enabled_log" {
    for_each = contains(keys(var.metrics_only_targets), each.key) ? [] : [1]
    content {
      category_group = "allLogs"
    }
  }

  enabled_metric {
    category = "AllMetrics"
  }

  lifecycle {
    # Azure agrega categorías nuevas con el tiempo y el provider las marca
    # como drift aunque "allLogs" ya las cubra.
    ignore_changes = [enabled_log, enabled_metric]
  }
}
