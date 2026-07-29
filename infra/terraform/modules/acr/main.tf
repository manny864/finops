resource "azurerm_container_registry" "this" {
  # Igual que Storage: sólo alfanumérico.
  name                = "${var.name_compact}cr"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = var.sku
  # Sin usuario admin: el pull va con managed identity, no con password.
  admin_enabled = false
  tags          = var.tags

  # La imagen pesa ~965 MB (PowerShell + módulos EXO/Teams). Basic da 10 GB:
  # entran ~10 tags. La retención automática sólo existe en Premium; en Basic
  # hay que purgar tags viejos desde el pipeline.
  retention_policy_in_days = var.sku == "Premium" ? 30 : null

  # Geo-replicación: baja el tiempo de pull del stamp europeo. Sólo Premium
  # (~USD 500/mes) — con Basic el stamp EU hace pull cross-region y tarda más
  # en el primer arranque de cada revisión, nada más.
  dynamic "georeplications" {
    for_each = var.sku == "Premium" ? toset(var.geo_replication_locations) : toset([])
    content {
      location                = georeplications.value
      zone_redundancy_enabled = false
    }
  }
}
