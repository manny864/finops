output "setting_ids" {
  value = { for k, v in azurerm_monitor_diagnostic_setting.this : k => v.id }
}
