output "resource_group_name" {
  value = azurerm_resource_group.this.name
}

output "resource_group_id" {
  value = azurerm_resource_group.this.id
}

output "vnet_id" {
  value = azurerm_virtual_network.this.id
}

output "vnet_name" {
  value = azurerm_virtual_network.this.name
}

output "apps_subnet_id" {
  value = azurerm_subnet.apps.id
}

output "private_endpoint_subnet_id" {
  value = azurerm_subnet.private_endpoint.id
}

output "mysql_subnet_id" {
  value = azurerm_subnet.mysql.id
}

output "nat_gateway_public_ip" {
  description = "IP pública fija de salida del entorno, o null si el NAT Gateway está apagado."
  value       = var.nat_gateway_enabled ? azurerm_public_ip.nat[0].ip_address : null

  # Quien la use (por ejemplo, para filtrar el origen) espera a que la subred ya salga por ella.
  depends_on = [azurerm_subnet_nat_gateway_association.apps]
}

output "nat_gateway_id" {
  value = var.nat_gateway_enabled ? azurerm_nat_gateway.this[0].id : null
}

output "apps_nsg_id" {
  description = "NSG de la subred de apps, o null si apps_nsg_block_imds está apagado."
  value       = var.apps_nsg_block_imds ? azurerm_network_security_group.apps[0].id : null
}

output "private_endpoint_nsg_id" {
  value = var.segmentation_nsgs_enabled ? azurerm_network_security_group.private_endpoint[0].id : null
}

output "mysql_nsg_id" {
  value = var.segmentation_nsgs_enabled ? azurerm_network_security_group.mysql[0].id : null
}
