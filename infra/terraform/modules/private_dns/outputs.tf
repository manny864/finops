output "vault_zone_id" {
  value = azurerm_private_dns_zone.this["vault"].id
}

output "mysql_zone_id" {
  value = azurerm_private_dns_zone.this["mysql"].id
}

output "redis_zone_id" {
  value = try(azurerm_private_dns_zone.this["redis"].id, null)
}
