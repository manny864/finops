terraform {
  required_version = ">= 1.9.8"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id                 = var.subscription_id
  resource_provider_registrations = "none"
}

variable "subscription_id" {
  type = string
}

variable "admin_public_key" {
  type      = string
  sensitive = true
}

variable "location" {
  type    = string
  default = "westus2"
}

variable "vm_size" {
  type    = string
  default = "Standard_B2s_v2"
}

locals {
  runners = {
    staging = "10.71.0.0/24"
    prod    = "10.72.0.0/24"
  }
  tags = {
    project    = "finops"
    owner      = "CloudOps"
    purpose    = "terraform-runner"
    managed_by = "terraform-runners"
  }
}

resource "azurerm_resource_group" "runner" {
  for_each = local.runners
  name     = "cscs-finops-${each.key}-runner-rg"
  location = var.location
  tags     = merge(local.tags, { environment = each.key })
}

resource "azurerm_virtual_network" "runner" {
  for_each            = local.runners
  name                = "cscs-finops-${each.key}-runner-vnet"
  address_space       = [each.value]
  location            = var.location
  resource_group_name = azurerm_resource_group.runner[each.key].name
  tags                = azurerm_resource_group.runner[each.key].tags
}

resource "azurerm_subnet" "runner" {
  for_each                        = local.runners
  name                            = "runner"
  resource_group_name             = azurerm_resource_group.runner[each.key].name
  virtual_network_name            = azurerm_virtual_network.runner[each.key].name
  address_prefixes                = [each.value]
  default_outbound_access_enabled = false
  service_endpoints               = ["Microsoft.Storage.Global", "Microsoft.KeyVault"]
}

resource "azurerm_network_security_group" "runner" {
  for_each            = local.runners
  name                = "cscs-finops-${each.key}-runner-nsg"
  location            = var.location
  resource_group_name = azurerm_resource_group.runner[each.key].name
  tags                = azurerm_resource_group.runner[each.key].tags

  security_rule {
    name                       = "DenyAllInbound"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowWebOutbound"
    priority                   = 100
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_ranges    = ["80", "443"]
    source_address_prefix      = "*"
    destination_address_prefix = "Internet"
  }

  security_rule {
    name                       = "DenyOtherOutbound"
    priority                   = 4096
    direction                  = "Outbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "runner" {
  for_each                  = local.runners
  subnet_id                 = azurerm_subnet.runner[each.key].id
  network_security_group_id = azurerm_network_security_group.runner[each.key].id
}

resource "azurerm_public_ip" "egress" {
  for_each            = local.runners
  name                = "cscs-finops-${each.key}-runner-egress"
  location            = var.location
  resource_group_name = azurerm_resource_group.runner[each.key].name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = azurerm_resource_group.runner[each.key].tags
}

resource "azurerm_network_interface" "runner" {
  for_each            = local.runners
  name                = "cscs-finops-${each.key}-runner-nic"
  location            = var.location
  resource_group_name = azurerm_resource_group.runner[each.key].name
  tags                = azurerm_resource_group.runner[each.key].tags

  ip_configuration {
    name                          = "runner"
    subnet_id                     = azurerm_subnet.runner[each.key].id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.egress[each.key].id
  }
}

resource "azurerm_linux_virtual_machine" "runner" {
  # checkov:skip=CKV_AZURE_50:owner=CloudOps; expires=2027-01-15; VM agent extensions required for protected Run Command administration and platform patching; no inbound SSH.
  for_each                        = local.runners
  name                            = "cscs-finops-${each.key}-runner"
  location                        = var.location
  resource_group_name             = azurerm_resource_group.runner[each.key].name
  size                            = var.vm_size
  admin_username                  = "vmadmin"
  disable_password_authentication = true
  network_interface_ids           = [azurerm_network_interface.runner[each.key].id]
  provision_vm_agent              = true
  allow_extension_operations      = true
  patch_mode                      = "AutomaticByPlatform"
  patch_assessment_mode           = "AutomaticByPlatform"
  secure_boot_enabled             = true
  vtpm_enabled                    = true
  encryption_at_host_enabled      = true
  custom_data                     = filebase64("${path.module}/cloud-init.yml")
  tags                            = azurerm_resource_group.runner[each.key].tags

  admin_ssh_key {
    username   = "vmadmin"
    public_key = var.admin_public_key
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
    disk_size_gb         = 64
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "24.04.202609040"
  }

  boot_diagnostics {}

  depends_on = [azurerm_subnet_network_security_group_association.runner]
}

output "runners" {
  value = {
    for environment, vm in azurerm_linux_virtual_machine.runner : environment => {
      id             = vm.id
      name           = vm.name
      resource_group = vm.resource_group_name
      subnet_id      = azurerm_subnet.runner[environment].id
      egress_ip      = azurerm_public_ip.egress[environment].ip_address
      labels         = ["self-hosted", "linux", "x64", "finops-${environment}"]
    }
  }
}
