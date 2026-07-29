# Estado remoto de Terraform. Se corre UNA vez, con backend local, y después
# se copia el output al backend de cada environment.
terraform {
  required_version = ">= 1.8.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.11"
    }
  }
}

provider "azurerm" {
  features {}
  # La cuenta del estado tiene las claves compartidas deshabilitadas, así que
  # el provider también tiene que hablarle al data plane con Entra ID. Sin
  # esto falla al crear el container con "Key based authentication is not
  # permitted on this storage account".
  storage_use_azuread = true
}

data "azurerm_client_config" "current" {}

variable "location" {
  type    = string
  default = "eastus2"
}

variable "name_prefix" {
  type    = string
  default = "cscs"
}

variable "project" {
  type    = string
  default = "finops"
}

variable "environment" {
  description = "Ni dev ni prod: el estado lo comparten los ambientes."
  type        = string
  default     = "mgmt"
}

variable "terraform_sp_object_id" {
  description = <<-DESC
    objectId del service principal que corre el pipeline. Es quien lee y
    escribe el estado, así que necesita rol de DATOS sobre la storage —
    Contributor sobre la suscripción no alcanza, es control plane.
    Obtenerlo con: az ad sp show --id <appId> --query id -o tsv
  DESC
  type        = string
}

variable "grant_bootstrap_operator_access" {
  description = <<-DESC
    Da acceso de datos también a quien corre este bootstrap. Hace falta para
    crear el container en esta misma corrida; una vez creado se puede poner en
    false y aplicar de nuevo, y el estado queda accesible SÓLO para el SP.
  DESC
  type        = bool
  default     = true
}

resource "random_string" "suffix" {
  length  = 6
  upper   = false
  special = false
}

# Misma convención que el resto: <prefijo>-<proyecto>-<ambiente>-<zona>-<tipo>.
# El ambiente es "mgmt" porque el estado no pertenece a dev ni a prod: lo
# comparten los dos. Ese slot queda disponible para cualquier otro recurso de
# plataforma transversal a los ambientes.
locals {
  name_base = lower("${var.name_prefix}-${var.project}-${var.environment}-${var.location}")
  # Storage Account: sólo alfanumérico, máximo 24. Sin la región, para dejar
  # lugar al sufijo aleatorio que exige la unicidad global de Azure.
  storage_base = lower("${var.name_prefix}${var.project}${var.environment}")
}

resource "azurerm_resource_group" "tfstate" {
  name     = "${local.name_base}-rg"
  location = var.location
}

resource "azurerm_storage_account" "tfstate" {
  # Storage Account: sólo alfanumérico y máximo 24 caracteres, así que el token
  # "tfstate" se abrevia a "tf" — con el nombre completo el sufijo "sa" quedaba
  # truncado. El sufijo aleatorio es obligatorio: el nombre es único a nivel
  # global de Azure, no de la suscripción.
  name                            = "${local.storage_base}${random_string.suffix.result}sa"
  resource_group_name             = azurerm_resource_group.tfstate.name
  location                        = azurerm_resource_group.tfstate.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false

  blob_properties {
    versioning_enabled = true
    delete_retention_policy {
      days = 30
    }
  }
}

# El que importa: sin esto el pipeline no puede leer ni escribir el estado.
# Ser Contributor de la suscripción NO alcanza — es un rol de control plane y
# el acceso al contenido de un blob es plano de datos.
resource "azurerm_role_assignment" "tfstate_blob_sp" {
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = var.terraform_sp_object_id
}

# Temporal: el humano que corre este bootstrap necesita acceso de datos para
# crear el container. Después se puede poner grant_bootstrap_operator_access
# en false y volver a aplicar — el estado queda sólo para el SP.
resource "azurerm_role_assignment" "tfstate_blob_operator" {
  count                = var.grant_bootstrap_operator_access ? 1 : 0
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = data.azurerm_client_config.current.object_id
}

# El RBAC de datos tarda en propagar; sin la espera, el container falla con 403
# la mitad de las veces.
resource "time_sleep" "rbac_propagation" {
  depends_on      = [azurerm_role_assignment.tfstate_blob_sp, azurerm_role_assignment.tfstate_blob_operator]
  create_duration = "60s"
}

resource "azurerm_storage_container" "tfstate" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.tfstate.id
  container_access_type = "private"

  depends_on = [time_sleep.rbac_propagation]
}

output "backend_config" {
  value = {
    resource_group_name  = azurerm_resource_group.tfstate.name
    storage_account_name = azurerm_storage_account.tfstate.name
    container_name       = azurerm_storage_container.tfstate.name
    use_azuread_auth     = true
  }
}
