# Azure Managed Redis con HA mínimo y acceso privado.
#
# Este módulo reemplaza el Redis en Container App para tener un servicio
# administrado con replicación del dataset y failover del plano de datos.
resource "azurerm_managed_redis" "this" {
  name                = "${var.name_base}-redis"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku_name            = var.sku_name

  high_availability_enabled = var.high_availability_enabled
  public_network_access     = var.public_network_access

  default_database {
    access_keys_authentication_enabled = true
    client_protocol                    = "Encrypted"
    eviction_policy                    = "AllKeysLRU"

    # EnterpriseCluster y NO OSSCluster (que es el default de Azure).
    #
    # Con OSSCluster las claves se reparten en slots y el servidor contesta
    # "MOVED <slot> <ip>:<puerto>" cuando la clave no vive en el nodo al que se
    # preguntó. Eso exige un cliente cluster-aware, y src/lib/redis.ts usa
    # `new Redis(...)` a secas — con lo cual toda escritura falla con
    #   ReplyError: MOVED 525 10.50.10.4:8500
    # Verificado 2026-07-28 en los logs de la app.
    #
    # EnterpriseCluster expone un endpoint único y hace el proxy internamente,
    # así que un cliente no-cluster funciona sin cambios. Es el modo que
    # corresponde mientras la app no hable el protocolo de cluster.
    clustering_policy = "EnterpriseCluster"
  }

  tags = var.tags
}

resource "azurerm_private_endpoint" "this" {
  name                = "${var.name_base}-redis-pe"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = var.subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "psc-redis"
    private_connection_resource_id = azurerm_managed_redis.this.id
    subresource_names              = [var.private_link_subresource_name]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [var.private_dns_zone_id]
  }
}
