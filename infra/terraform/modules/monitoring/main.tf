resource "azurerm_log_analytics_workspace" "this" {
  name                = "${var.name_base}-law"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = var.retention_in_days
  # Los primeros 5 GB/mes son gratis. El cap evita que un loop de logs se
  # convierta en la factura más cara del stack.
  daily_quota_gb = var.daily_quota_gb
  tags           = var.tags
}

# Workspace-based: la telemetría cae en el Log Analytics del MISMO stamp. Esto
# no es un detalle de costo — las trazas llevan user ids, tenant ids y URLs, así
# que un App Insights compartido entre regiones rompería la residencia de datos.
resource "azurerm_application_insights" "this" {
  name                = "${var.name_base}-appi"
  location            = var.location
  resource_group_name = var.resource_group_name
  workspace_id        = azurerm_log_analytics_workspace.this.id
  application_type    = "Node.JS"
  # El sampling protege la factura: sin esto, un pico de tráfico se paga en
  # ingesta de Log Analytics.
  sampling_percentage = var.appinsights_sampling_percentage
  tags                = var.tags
}

resource "azurerm_monitor_action_group" "this" {
  name                = "${var.name_base}-ag"
  resource_group_name = var.resource_group_name
  # short_name tiene un máximo de 12 caracteres: no admite la convención larga.
  short_name = var.action_group_short_name
  tags       = var.tags

  email_receiver {
    name          = "ops"
    email_address = var.alert_email
  }
}
