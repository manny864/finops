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
