output "workspace_id" {
  value = azurerm_log_analytics_workspace.this.id
}

output "workspace_customer_id" {
  value = azurerm_log_analytics_workspace.this.workspace_id
}

output "workspace_primary_shared_key" {
  value     = azurerm_log_analytics_workspace.this.primary_shared_key
  sensitive = true
}

output "action_group_id" {
  value = azurerm_monitor_action_group.this.id
}

output "appinsights_connection_string" {
  value     = azurerm_application_insights.this.connection_string
  sensitive = true
}

output "appinsights_id" {
  value = azurerm_application_insights.this.id
}
