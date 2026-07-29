# El proyecto YA tiene un Key Vault en producción: credenciales de Azure por
# tenant (src/lib/secrets/tenantCredentials.ts) y secretos de infra
# (infraSecrets.ts: infra-db-password, infra-redis-password, infra-cron-secret).
# Por defecto este módulo lo REFERENCIA en vez de crear uno nuevo: recrearlo
# obligaría a recargar todos los secrets a mano. create = true sólo para un
# vault nuevo (ej. ambiente dev).
data "azurerm_key_vault" "existing" {
  count               = var.create ? 0 : 1
  name                = var.existing_vault_name
  resource_group_name = var.existing_vault_resource_group
}

resource "azurerm_key_vault" "this" {
  count = var.create ? 1 : 0
  # El límite de 24 caracteres no admite la región: cscs-finops-prod-eastus2-kv
  # son 27. Se usa la base sin región — el resource group ya la identifica.
  name                          = "${var.name_base_short}-kv"
  location                      = var.location
  resource_group_name           = var.resource_group_name
  tenant_id                     = var.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = true
  purge_protection_enabled      = true
  soft_delete_retention_days    = 30
  public_network_access_enabled = var.private_endpoint_enabled ? false : true
  tags                          = var.tags
}

locals {
  vault_id  = var.create ? azurerm_key_vault.this[0].id : data.azurerm_key_vault.existing[0].id
  vault_uri = var.create ? azurerm_key_vault.this[0].vault_uri : data.azurerm_key_vault.existing[0].vault_uri
}

# Private endpoint opcional: ~USD 7/mes. En fase 1 se deja en false y el vault
# queda con acceso público pero protegido por RBAC + managed identity.
resource "azurerm_private_endpoint" "vault" {
  count               = var.private_endpoint_enabled ? 1 : 0
  name                = "${var.name_base_short}-kv-pe"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = var.subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "psc-vault"
    private_connection_resource_id = local.vault_id
    subresource_names              = ["vault"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [var.private_dns_zone_id]
  }
}

# Acceso de la app a los secrets. Es lo que reemplaza a
# AZURE_KEYVAULT_CLIENT_ID/SECRET en el .env.
#
# "Secrets Officer" y no "Secrets User": el segundo es de SOLO LECTURA, y la app
# ESCRIBE en el vault — al guardar las credenciales de un tenant desde la UI hace
# setSecret("tenant-<id>-client-secret"), y beginDeleteSecret al desvincularlo.
# Con el rol de lectura eso falla con
#   403 ForbiddenByRbac — Action: Microsoft.KeyVault/vaults/secrets/setSecret/action
# y la pantalla de credenciales devuelve 500. Verificado 2026-07-28.
#
# No hay un rol intermedio: Azure no publica uno que permita escribir sin borrar.
# Officer es el mínimo que cubre setSecret. Sigue sin poder tocar claves,
# certificados ni la configuración del vault.
resource "azurerm_role_assignment" "app_secrets_user" {
  scope                = local.vault_id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = var.app_principal_id
}

data "azurerm_client_config" "current" {}

# Un vault en modo RBAC NO le da acceso de data plane a quien lo crea. Sin
# esto, el primer `terraform apply` falla con 403 al escribir el secret de la
# password de MySQL. Con un vault preexistente (create = false) se asume que
# el operador ya tiene este rol y no se toca su RBAC.
resource "azurerm_role_assignment" "deployer_secrets_officer" {
  count                = var.create ? 1 : 0
  scope                = local.vault_id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

# Las asignaciones de RBAC tardan en propagarse (~30 s). Sin esta espera, el
# apply que crea el vault y escribe el secret en la misma corrida falla la
# mitad de las veces.
resource "time_sleep" "rbac_propagation" {
  count           = var.create ? 1 : 0
  depends_on      = [azurerm_role_assignment.deployer_secrets_officer]
  create_duration = "40s"
}
