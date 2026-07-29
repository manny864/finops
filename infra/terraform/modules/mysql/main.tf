# VNet injection (delegated_subnet_id) en vez de private endpoint: el servidor
# nace sin acceso público y sin PE que pagar.
resource "azurerm_mysql_flexible_server" "this" {
  name                         = "${var.name_base}-mysql"
  resource_group_name          = var.resource_group_name
  location                     = var.location
  administrator_login          = var.admin_login
  administrator_password       = var.admin_password
  sku_name                     = var.sku_name
  version                      = "8.0.21"
  backup_retention_days        = var.backup_retention_days
  geo_redundant_backup_enabled = var.geo_redundant_backup_enabled
  delegated_subnet_id          = var.subnet_id
  private_dns_zone_id          = var.private_dns_zone_id
  # La zona NO se fija: qué zonas hay disponibles depende de la región, del SKU
  # y de la capacidad del momento, y pinear "1" hace fallar la creación con
  # ZoneNotAvailableForRegion donde esa zona no se ofrece. Azure elige una
  # disponible; `ignore_changes` evita que después figure como drift.
  zone = null

  storage {
    size_gb           = var.storage_gb
    auto_grow_enabled = true
  }

  # OJO: el tier Burstable (B_Standard_*) NO soporta high_availability.
  # Poner high_availability = true obliga a subir a GP_Standard_*.
  dynamic "high_availability" {
    for_each = var.high_availability ? [1] : []
    content {
      mode = "ZoneRedundant"
    }
  }

  lifecycle {
    ignore_changes = [zone, high_availability[0].standby_availability_zone]
  }

  tags = var.tags
}

resource "azurerm_mysql_flexible_database" "app" {
  name                = var.database_name
  resource_group_name = var.resource_group_name
  server_name         = azurerm_mysql_flexible_server.this.name
  charset             = "utf8mb4"
  collation           = "utf8mb4_unicode_ci"
}

# TLS obligatorio. La app debe conectar con ssl.rejectUnauthorized = true
# (ver src/modules/storage/db.ts) o falla la conexión.
resource "azurerm_mysql_flexible_server_configuration" "require_tls" {
  name                = "require_secure_transport"
  resource_group_name = var.resource_group_name
  server_name         = azurerm_mysql_flexible_server.this.name
  value               = "ON"
}
