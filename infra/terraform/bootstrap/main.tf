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
    escribe el estado de prod, así que necesita rol de DATOS sobre su contenedor —
    Contributor sobre la suscripción no alcanza, es control plane.
    Obtenerlo con: az ad sp show --id <appId> --query id -o tsv
  DESC
  type        = string
}

variable "staging_terraform_sp_object_id" {
  description = "objectId del SP de staging; sólo recibe acceso al contenedor tfstate-stg."
  type        = string
}

variable "grant_bootstrap_operator_access" {
  description = <<-DESC
    Da acceso de datos también a quien corre este bootstrap. Hace falta para
    crear el container en esta misma corrida; una vez creado se puede poner en
    false y aplicar de nuevo para retirar esta asignación temporal. No retira
    roles de operadores administrados fuera de este bootstrap.
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

  lifecycle {
    # El etiquetado lo administra CloudOps fuera del bootstrap.
    ignore_changes = [tags]
  }
}

resource "azurerm_storage_account" "tfstate" {
  # checkov:skip=CKV_AZURE_33:owner=CloudOps; expires=2027-01-15; Queue unused; Blob-only backend with Entra RBAC.
  # checkov:skip=CKV_AZURE_59:owner=CloudOps; expires=2027-01-15; Public endpoint required by hosted runners; Deny plus temporary /32 ARM leases; CI connectivity remains intermittent.
  # checkov:skip=CKV_AZURE_206:owner=CloudOps; expires=2027-01-15; Single-region LRS accepted; versioning and 30-day recovery tested.
  # checkov:skip=CKV_AZURE_36:owner=CloudOps; expires=2027-01-15; No trusted-service bypass needed; explicit runner /32 is narrower.
  # checkov:skip=CKV2_AZURE_33:owner=CloudOps; expires=2027-01-15; No private runner route; Deny plus temporary /32 ARM leases; CI connectivity remains intermittent.
  # checkov:skip=CKV2_AZURE_1:owner=CloudOps; expires=2027-01-15; Microsoft-managed encryption accepted; no CMK compliance mandate.
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

  network_rules {
    default_action = "Deny"
    bypass         = ["None"]
  }

  lifecycle {
    prevent_destroy = true
    # /32 temporales pertenecen al lease ARM del runner, no al apply.
    ignore_changes = [tags, network_rules[0].ip_rules]
  }

  blob_properties {
    versioning_enabled = true
    delete_retention_policy {
      days = 30
    }
    container_delete_retention_policy {
      days = 30
    }
  }
}

# Cada SP recibe datos sólo en su contenedor. Contributor de la suscripción
# no sustituye el rol de datos; los administradores RBAC aún pueden reasignarlo.
resource "azurerm_role_assignment" "tfstate_blob_prod" {
  scope                = "${azurerm_storage_account.tfstate.id}/blobServices/default/containers/${azurerm_storage_container.tfstate_prod.name}"
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = var.terraform_sp_object_id
}

resource "azurerm_role_assignment" "tfstate_blob_staging" {
  scope                = "${azurerm_storage_account.tfstate.id}/blobServices/default/containers/${azurerm_storage_container.tfstate_staging.name}"
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = var.staging_terraform_sp_object_id

  lifecycle {
    precondition {
      condition     = var.staging_terraform_sp_object_id != var.terraform_sp_object_id
      error_message = "Prod y staging deben usar identidades de backend distintas."
    }
  }
}

# Temporal: el humano que corre este bootstrap necesita acceso de datos para
# crear el container. Después se puede poner grant_bootstrap_operator_access
# en false y volver a aplicar para retirar esta asignación.
resource "azurerm_role_assignment" "tfstate_blob_operator" {
  count                = var.grant_bootstrap_operator_access ? 1 : 0
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = data.azurerm_client_config.current.object_id
}

# El RBAC de datos tarda en propagar; sin la espera, el container falla con 403
# la mitad de las veces.
resource "time_sleep" "operator_rbac_propagation" {
  depends_on      = [azurerm_role_assignment.tfstate_blob_operator]
  create_duration = "60s"
}

resource "azurerm_storage_container" "tfstate" {
  # checkov:skip=CKV2_AZURE_21:owner=CloudOps; expires=2027-01-15; Backend Blob diagnostics not configured; Entra RBAC, versioning and ARM activity logs do not replace data-access logs.
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.tfstate.id
  container_access_type = "private"

  depends_on = [time_sleep.operator_rbac_propagation]

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_storage_container" "tfstate_staging" {
  # checkov:skip=CKV2_AZURE_21:owner=CloudOps; expires=2027-01-15; Backend Blob diagnostics not configured; Entra RBAC, versioning and ARM activity logs do not replace data-access logs.
  name                  = "tfstate-stg"
  storage_account_id    = azurerm_storage_account.tfstate.id
  container_access_type = "private"

  depends_on = [time_sleep.operator_rbac_propagation]

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_storage_container" "tfstate_prod" {
  # checkov:skip=CKV2_AZURE_21:owner=CloudOps; expires=2027-01-15; Backend Blob diagnostics not configured; Entra RBAC, versioning and ARM activity logs do not replace data-access logs.
  name                  = "tfstate-prod"
  storage_account_id    = azurerm_storage_account.tfstate.id
  container_access_type = "private"

  depends_on = [time_sleep.operator_rbac_propagation]

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_management_lock" "tfstate" {
  name       = "${local.name_base}-state-lock"
  scope      = azurerm_storage_account.tfstate.id
  lock_level = "CanNotDelete"
  notes      = "INFRA-09: proteger el backend; no sustituye el lease ni el RBAC de datos."

  depends_on = [
    azurerm_role_assignment.tfstate_blob_prod,
    azurerm_role_assignment.tfstate_blob_staging,
    azurerm_role_assignment.tfstate_blob_operator,
  ]
}

resource "azurerm_role_definition" "tfstate_firewall" {
  name  = "${local.name_base}-backend-firewall"
  scope = azurerm_resource_group.tfstate.id

  permissions {
    actions = [
      "Microsoft.Storage/storageAccounts/read",
      "Microsoft.Storage/storageAccounts/write",
      "Microsoft.Resources/tags/read",
      "Microsoft.Resources/tags/write",
    ]
  }
  assignable_scopes = [azurerm_resource_group.tfstate.id]
}

resource "azurerm_role_assignment" "tfstate_firewall_staging" {
  scope              = azurerm_storage_account.tfstate.id
  role_definition_id = azurerm_role_definition.tfstate_firewall.role_definition_resource_id
  principal_id       = var.staging_terraform_sp_object_id
}

output "backend_config" {
  value = {
    resource_group_name  = azurerm_resource_group.tfstate.name
    storage_account_name = azurerm_storage_account.tfstate.name
    container_name       = azurerm_storage_container.tfstate_prod.name
    use_azuread_auth     = true
  }
}
