output "app_id" {
  value = azurerm_container_app.this.id
}

output "app_name" {
  value = azurerm_container_app.this.name
}

output "default_hostname" {
  value = azurerm_container_app.this.ingress[0].fqdn
}

output "internal_url" {
  description = "URL que usan los cron jobs para pegarle a la app dentro del entorno."
  value       = "https://${azurerm_container_app.this.ingress[0].fqdn}"
}
