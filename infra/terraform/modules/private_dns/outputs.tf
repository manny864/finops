output "vault_zone_id" {
  value = azurerm_private_dns_zone.this["vault"].id
}

output "mysql_zone_id" {
  value = azurerm_private_dns_zone.this["mysql"].id

  # MySQL Flexible con VNet injection exige que la VNet YA esté enlazada a la zona cuando se crea
  # el servidor ("VnetNotLinkedToPrivateDnsZone", visto en el primer apply de staging, 2026-10-12).
  # Depender sólo del id de la zona los dejaba en paralelo con el enlace: una carrera que en un
  # ambiente nuevo se pierde. En prod, con el enlace ya creado, esta dependencia no cambia nada.
  depends_on = [azurerm_private_dns_zone_virtual_network_link.this]
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

