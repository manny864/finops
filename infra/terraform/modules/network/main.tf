resource "azurerm_resource_group" "this" {
  name     = "${var.name_base}-rg"
  location = var.location
  tags     = var.tags
}

resource "azurerm_virtual_network" "this" {
  name                = "${var.name_base}-vnet"
  address_space       = var.address_space
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = var.tags
}

# Subnet de infraestructura del entorno de Container Apps: /23 o mayor,
# dedicada, y DELEGADA a Microsoft.App/environments.
#
# La delegación es obligatoria para un entorno de perfil Consumption (los de
# workload profiles son los que no la piden). Sin ella el entorno falla con
# ManagedEnvironmentSubnetDelegationError.
resource "azurerm_subnet" "apps" {
  name                 = "${var.name_base}-snet-apps"
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [var.apps_subnet_prefix]

  delegation {
    name = "delegation-container-apps"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_subnet" "private_endpoint" {
  name                              = "${var.name_base}-snet-pe"
  resource_group_name               = azurerm_resource_group.this.name
  virtual_network_name              = azurerm_virtual_network.this.name
  address_prefixes                  = [var.pe_subnet_prefix]
  private_endpoint_network_policies = "Disabled"
}

# Subnet delegada a MySQL Flexible (VNet injection). Es la alternativa al
# private endpoint para MySQL y sale más barata: no hay PE que pagar.
resource "azurerm_subnet" "mysql" {
  name                 = "${var.name_base}-snet-mysql"
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [var.mysql_subnet_prefix]

  delegation {
    name = "delegation-mysql"
    service_delegation {
      name    = "Microsoft.DBforMySQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# ---------------------------------------------------------------------------
# NAT Gateway: IP pública FIJA de salida para el entorno de Container Apps.
#
# Sin esto el entorno sale a internet por el pool regional de Azure (el app lista
# unas 190 IP en outboundIpAddresses, y Microsoft avisa que pueden cambiar): no hay
# una IP que se pueda declarar a quien necesite filtrar por origen. La que muestra
# el output `outbound_ip` del stamp es la de ENTRADA (capp-svc-lb-ip, en el resource
# group ME_...), no la de salida.
#
# Para qué sirve: los cron jobs llaman al app por la URL del entorno, que resuelve a
# la IP pública, y llegan al ingress con la IP de salida. Para poder restringir el
# ingress a Cloudflare sin cortar los cron, esa IP tiene que ser una sola y conocida
# (origin_extra_allowed_ip_ranges en environments/prod).
#
# Todo el tráfico de salida del entorno pasa a salir por esta IP, no sólo el de los
# cron: es un cambio de red de toda la subred de apps. Con el flag en false no se
# crea nada y la salida sigue como hoy.
#
# Container Apps sólo admite el SKU Standard (StandardV2 no está soportado) y sólo en
# entornos de workload profiles (learn.microsoft.com, "Networking in an Azure
# Container Apps Environment" y "Provide a virtual network to an environment").
# ---------------------------------------------------------------------------
resource "azurerm_public_ip" "nat" {
  count               = var.nat_gateway_enabled ? 1 : 0
  name                = "${var.name_base}-nat-pip"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = var.tags
}

resource "azurerm_nat_gateway" "this" {
  count                   = var.nat_gateway_enabled ? 1 : 0
  name                    = "${var.name_base}-nat"
  location                = var.location
  resource_group_name     = azurerm_resource_group.this.name
  sku_name                = "Standard"
  idle_timeout_in_minutes = var.nat_gateway_idle_timeout_minutes
  tags                    = var.tags
}

resource "azurerm_nat_gateway_public_ip_association" "this" {
  count                = var.nat_gateway_enabled ? 1 : 0
  nat_gateway_id       = azurerm_nat_gateway.this[0].id
  public_ip_address_id = azurerm_public_ip.nat[0].id
}

resource "azurerm_subnet_nat_gateway_association" "apps" {
  count          = var.nat_gateway_enabled ? 1 : 0
  subnet_id      = azurerm_subnet.apps.id
  nat_gateway_id = azurerm_nat_gateway.this[0].id

  # La IP tiene que estar asociada al NAT antes de que la subred empiece a salir por él.
  depends_on = [azurerm_nat_gateway_public_ip_association.this]
}
