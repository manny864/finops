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
  name                 = "${var.name_base}-snet-pe"
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [var.pe_subnet_prefix]
  # INFRA-06: sin esto Azure ignora el NSG en el tráfico hacia los private endpoints.
  private_endpoint_network_policies = var.segmentation_nsgs_enabled ? "NetworkSecurityGroupEnabled" : "Disabled"
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

# ---------------------------------------------------------------------------
# NSG de la subred de apps: corta el acceso a IMDS (169.254.169.254) desde los
# contenedores (AISEC-03). Si un SSRF llega a salir (p. ej. del Chromium que arma
# los PDF), no puede pedir tokens ni metadatos a IMDS.
#
# Una regla con destino "169.254.169.254" NO tiene efecto: Azure no somete IMDS a
# los NSG salvo que se use el service tag AzurePlatformIMDS (learn.microsoft.com,
# "Network security groups", Azure platform considerations).
#
# Container Apps no usa IMDS para la identidad administrada (usa IDENTITY_ENDPOINT),
# pero los nodos del entorno viven en esta subred. Encender primero en staging y
# verificar: health del app, token a Key Vault, pull del ACR y los cron jobs.
#
# Las reglas por defecto del NSG se mantienen (salida a VNet e internet). La
# entrada pública del entorno no pasa por la subred, así que DenyAllInBound no la
# corta. NO denegar 168.63.129.16 (DNS): el entorno deja de funcionar.
# ---------------------------------------------------------------------------
resource "azurerm_network_security_group" "apps" {
  count               = var.apps_nsg_block_imds ? 1 : 0
  name                = "${var.name_base}-snet-apps-nsg"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = var.tags

  security_rule {
    name                       = "DenyAzurePlatformIMDSOutbound"
    priority                   = 100
    direction                  = "Outbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "AzurePlatformIMDS"
  }
}

resource "azurerm_subnet_network_security_group_association" "apps" {
  count                     = var.apps_nsg_block_imds ? 1 : 0
  subnet_id                 = azurerm_subnet.apps.id
  network_security_group_id = azurerm_network_security_group.apps[0].id
}

# ---------------------------------------------------------------------------
# INFRA-06: segmentación de las subredes de private endpoints y de MySQL.
#
# Sin NSG, cualquier recurso de la VNet (una subred nueva, un peering, un nodo
# comprometido) llega a Key Vault, Redis, AI y MySQL. Con esto sólo llegan los
# clientes declarados; el resto de la VNet queda denegado. Ninguna de las dos
# subredes es pública: MySQL va por VNet injection y Redis/KV por PE.
#
# Puertos efectivos verificados en Azure (2026-10-15): Key Vault y AI Services
# 443; Managed Redis 10000 (clustering EnterpriseCluster, NO 6379; con OSS
# clustering también harían falta los 85xx, ver pe_allowed_ports).
#
# Sólo se filtra la ENTRADA. La salida de MySQL (Storage para backups/logs, HA,
# DNS 168.63.129.16) queda con las reglas por defecto del NSG. Encender primero
# en staging y verificar: health, token a Key Vault, rate limit (Redis), cron,
# migraciones y, en prod, la VM de backup y la web corporativa (clientes
# fuera de este módulo que se pasan en *_extra_client_prefixes).
# ---------------------------------------------------------------------------
resource "azurerm_network_security_group" "private_endpoint" {
  count               = var.segmentation_nsgs_enabled ? 1 : 0
  name                = "${var.name_base}-snet-pe-nsg"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = var.tags

  security_rule {
    name                       = "AllowAppsToPrivateEndpoints"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_ranges    = var.pe_allowed_ports
    source_address_prefix      = var.apps_subnet_prefix
    destination_address_prefix = var.pe_subnet_prefix
  }

  dynamic "security_rule" {
    for_each = length(var.pe_extra_client_prefixes) > 0 ? [1] : []
    content {
      name                       = "AllowExtraClientsToPrivateEndpoints"
      priority                   = 110
      direction                  = "Inbound"
      access                     = "Allow"
      protocol                   = "Tcp"
      source_port_range          = "*"
      destination_port_ranges    = var.pe_allowed_ports
      source_address_prefixes    = var.pe_extra_client_prefixes
      destination_address_prefix = var.pe_subnet_prefix
    }
  }

  security_rule {
    name                       = "DenyAllOtherInbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "private_endpoint" {
  count                     = var.segmentation_nsgs_enabled ? 1 : 0
  subnet_id                 = azurerm_subnet.private_endpoint.id
  network_security_group_id = azurerm_network_security_group.private_endpoint[0].id
}

resource "azurerm_network_security_group" "mysql" {
  count               = var.segmentation_nsgs_enabled ? 1 : 0
  name                = "${var.name_base}-snet-mysql-nsg"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = var.tags

  security_rule {
    name                       = "AllowAppsToMySql"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3306"
    source_address_prefix      = var.apps_subnet_prefix
    destination_address_prefix = var.mysql_subnet_prefix
  }

  # Réplica de HA (3306/33062) y tráfico interno del servidor: dentro de la subred, sin filtrar puerto.
  security_rule {
    name                       = "AllowMySqlSubnetInternal"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = var.mysql_subnet_prefix
    destination_address_prefix = var.mysql_subnet_prefix
  }

  dynamic "security_rule" {
    for_each = length(var.mysql_extra_client_prefixes) > 0 ? [1] : []
    content {
      name                       = "AllowExtraClientsToMySql"
      priority                   = 120
      direction                  = "Inbound"
      access                     = "Allow"
      protocol                   = "Tcp"
      source_port_range          = "*"
      destination_port_range     = "3306"
      source_address_prefixes    = var.mysql_extra_client_prefixes
      destination_address_prefix = var.mysql_subnet_prefix
    }
  }

  # La regla por defecto AllowAzureLoadBalancerInBound (65001) queda tapada por el Deny de abajo.
  security_rule {
    name                       = "AllowAzureLoadBalancerInbound"
    priority                   = 130
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "AzureLoadBalancer"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "DenyAllOtherInbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "mysql" {
  count                     = var.segmentation_nsgs_enabled ? 1 : 0
  subnet_id                 = azurerm_subnet.mysql.id
  network_security_group_id = azurerm_network_security_group.mysql[0].id
}

# ---------------------------------------------------------------------------
# INFRA-06: salida de apps por firewall (Azure Firewall/NVA). El NAT Gateway fija
# la IP pero NO filtra destinos; esto manda 0.0.0.0/0 al firewall, que es quien
# aplica la política. Inactivo mientras egress_firewall_private_ip sea null: hoy
# no hay firewall desplegado (riesgo aceptado, ver
# infra/docs/network-segmentation.md). Una UDR sola no filtra nada; antes de
# activarla, el firewall tiene que permitir ACA/ACR/Entra, DNS, APIs de Azure,
# proveedores de IA, pagos e integraciones. Con la ruta activa, la salida a
# internet deja de usar el NAT Gateway.
# ---------------------------------------------------------------------------
resource "azurerm_route_table" "apps_egress" {
  count               = var.egress_firewall_private_ip == null ? 0 : 1
  name                = "${var.name_base}-rt-apps-egress"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = var.tags

  route {
    name                   = "default-via-firewall"
    address_prefix         = "0.0.0.0/0"
    next_hop_type          = "VirtualAppliance"
    next_hop_in_ip_address = var.egress_firewall_private_ip
  }
}

resource "azurerm_subnet_route_table_association" "apps_egress" {
  count          = var.egress_firewall_private_ip == null ? 0 : 1
  subnet_id      = azurerm_subnet.apps.id
  route_table_id = azurerm_route_table.apps_egress[0].id
}
