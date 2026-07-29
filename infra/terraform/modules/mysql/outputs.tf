output "id" {
  value = azurerm_mysql_flexible_server.this.id
}

output "fqdn" {
  value = azurerm_mysql_flexible_server.this.fqdn
}

output "database_name" {
  value = azurerm_mysql_flexible_database.app.name
}
