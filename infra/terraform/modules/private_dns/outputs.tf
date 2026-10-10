output "vault_zone_id" {
  value = azurerm_private_dns_zone.this["vault"].id
}

output "mysql_zone_id" {
  value = azurerm_private_dns_zone.this["mysql"].id
}

output "redis_zone_id" {
  value = try(azurerm_private_dns_zone.this["redis"].id, null)
}

output "cognitiveservices_zone_id" {
  value = try(azurerm_private_dns_zone.this["cognitiveservices"].id, null)
}

output "openai_zone_id" {
  value = try(azurerm_private_dns_zone.this["openai"].id, null)
}

output "aiservices_zone_id" {
  value = try(azurerm_private_dns_zone.this["aiservices"].id, null)
}

