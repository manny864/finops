# Presupuesto por resource group, no por suscripción: si mañana conviven el
# stack de M365 SaaS y el de FinOps en la misma suscripción, cada uno tiene
# su propia alerta y su propio número.
resource "azurerm_consumption_budget_resource_group" "this" {
  name              = "${var.name_base}-budget"
  resource_group_id = var.resource_group_id
  amount            = var.amount
  time_grain        = "Monthly"

  time_period {
    start_date = var.start_date
  }

  # Presupuesto de recursos puntuales dentro del RG (la cuenta de IA): sin
  # filtro cuenta todo el resource group.
  dynamic "filter" {
    for_each = length(var.resource_ids) > 0 ? [1] : []
    content {
      dimension {
        name   = "ResourceId"
        values = var.resource_ids
      }
    }
  }

  dynamic "notification" {
    for_each = toset([50, 75, 90, 100])
    content {
      enabled        = true
      threshold      = notification.value
      operator       = "GreaterThan"
      threshold_type = "Actual"
      contact_emails = [var.alert_email]
    }
  }

  # Aviso temprano: 100% del presupuesto *proyectado* a fin de mes.
  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThan"
    threshold_type = "Forecasted"
    contact_emails = [var.alert_email]
  }
}
