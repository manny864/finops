output "hostname" {
  description = "Hostname del endpoint TLS de Managed Redis."
  value       = azurerm_managed_redis.this.hostname
}

output "ssl_port" {
  description = "Puerto TLS del endpoint de Managed Redis."
  value       = azurerm_managed_redis.this.default_database[0].port
}

output "primary_access_key" {
  description = "Primary key de la base default para auth de clientes."
  value       = azurerm_managed_redis.this.default_database[0].primary_access_key
  sensitive   = true
}

output "id" {
  value = azurerm_managed_redis.this.id
}
