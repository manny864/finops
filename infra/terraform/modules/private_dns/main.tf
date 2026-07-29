# Sólo las zonas que este proyecto usa. Blob/Storage no está: los artifacts
# de scan viven en MySQL (tabla scan_artifacts) — agregar la zona el día que
# se muevan a Blob.
locals {
  zones = merge(
    {
      vault = "privatelink.vaultcore.azure.net"
      mysql = "privatelink.mysql.database.azure.com"
    },
    # Azure Managed Redis (kind=v2, SKUs Balanced/Memory/Compute) expone el
    # cache como <nombre>.<region>.redis.azure.net, así que la zona de private
    # link es privatelink.redis.azure.net.
    #
    # NO es privatelink.redisenterprise.cache.azure.net: esa corresponde al
    # recurso Redis Enterprise clásico. Con esa zona el private endpoint no
    # registra ningún A record —queda vacía— el hostname nunca resuelve a la IP
    # privada y la app muere con "connect ETIMEDOUT" contra el cache.
    # Verificado 2026-07-28: customDnsConfigs del endpoint pide
    # cscs-finops-prod-westus2-redis.westus2.redis.azure.net -> 10.50.10.4.
    var.redis_enabled ? { redis = "privatelink.redis.azure.net" } : {}
  )
}

resource "azurerm_private_dns_zone" "this" {
  for_each            = local.zones
  name                = each.value
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "this" {
  for_each              = azurerm_private_dns_zone.this
  name                  = "${var.name_base}-pdnslink-${each.key}"
  private_dns_zone_name = each.value.name
  resource_group_name   = var.resource_group_name
  virtual_network_id    = var.vnet_id
  registration_enabled  = false
  tags                  = var.tags
}
