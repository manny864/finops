# VNet injection (delegated_subnet_id) en vez de private endpoint: el servidor
# nace sin acceso público y sin PE que pagar.
resource "azurerm_mysql_flexible_server" "this" {
  name                         = "${var.name_base}-mysql"
  resource_group_name          = var.resource_group_name
  location                     = var.location
  administrator_login          = var.admin_login
  administrator_password       = var.admin_password
  sku_name                     = var.sku_name
  version                      = var.mysql_version
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
    # version: la actualización de versión mayor (8.0 -> 8.4) es IRREVERSIBLE, en un servidor
    # Burstable tiene un flujo propio (compute tier General Purpose temporal) y se hace a mano,
    # con backup a demanda y probada antes en una copia (docs/security/endurecimiento-infraestructura-saas-2026-10-09.md,
    # "MySQL 8.0 a 8.4"). Ignorar el cambio impide que Terraform la dispare por un valor mal puesto
    # en el tfvars, o que planee "volver" a 8.0.21 después de la actualización manual. La
    # variable mysql_version sólo manda al CREAR un servidor.
    ignore_changes = [zone, high_availability[0].standby_availability_zone, version]
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

# Bloqueo contra borrado accidental (Resource Lock - CanNotDelete)
resource "azurerm_management_lock" "mysql_delete_lock" {
  count      = var.enable_delete_lock ? 1 : 0
  name       = "${azurerm_mysql_flexible_server.this.name}-lock"
  scope      = azurerm_mysql_flexible_server.this.id
  lock_level = "CanNotDelete"
  notes      = "Protección contra borrado accidental del servidor MySQL de producción (Fase 4 Endurecimiento SaaS)"
}
