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

  backend "azurerm" {}
}

provider "azurerm" {
  features {
    resource_group {
      # Azure crea solo un action group "Application Insights Smart Detection"
      # dentro del RG al crear un Application Insights, y no lo gestiona
      # Terraform. Con el valor por defecto (true), ese único recurso huérfano
      # impide borrar el RG y deja el destroy a medias.
      #
      # El riesgo que se acepta: borrar un RG también se lleva lo que alguien
      # haya creado ahí por fuera de Terraform. En un RG que es propiedad
      # exclusiva de este stamp, es el comportamiento que se quiere.
      prevent_deletion_if_contains_resources = false
    }
  }
  subscription_id = var.subscription_id
  tenant_id       = var.tenant_id

  # OIDC explícito (2026-07-30): azure/login@v2 deja una sesión de Azure CLI
  # autenticada como Service Principal vía federated credential, pero el modo
  # "Azure CLI" del provider SOLO soporta sesiones de usuario — falla con
  # "Authenticating using the Azure CLI is only supported as a User (not a
  # Service Principal)" apenas arranca `terraform init`. El workflow ya declara
  # `permissions: id-token: write` y hace el login OIDC; sólo faltaba decirle al
  # provider que use ESE token en vez de intentar CLI. Sin client_secret ni
  # nada más: azurerm lee ARM_CLIENT_ID/ARM_TENANT_ID/ARM_SUBSCRIPTION_ID (los
  # pone azure/login) y pide el JWT OIDC directo a GitHub Actions.
  use_oidc = true
}

locals {
  # El plano de control no pertenece a ninguna región de datos, así que en el
  # lugar de la zona lleva "global". Sin esto choca con el RG del stamp cuando
  # ambos caen en la misma región de Azure.
  global_name_base    = lower("${var.name_prefix}-${var.project}-${var.environment}-global")
  global_name_compact = lower(replace(local.global_name_base, "-", ""))

  tags = merge(var.tags, {
    Environment = upper(var.environment)
    Service     = "CSCS-FINOPS"
    ManagedBy   = "Terraform"
  })

  stamp_hostnames = { for k, s in module.stamp : k => s.hostname }
}

# ---------------------------------------------------------------------------
# Plano de control: compartido entre regiones, sin datos de clientes.
# ---------------------------------------------------------------------------

resource "azurerm_resource_group" "global" {
  name     = "${local.global_name_base}-rg"
  location = var.global_location
  tags     = local.tags
}

module "acr" {
  source                    = "../../modules/acr"
  name_compact              = local.global_name_compact
  location                  = azurerm_resource_group.global.location
  resource_group_name       = azurerm_resource_group.global.name
  sku                       = var.acr_sku
  geo_replication_locations = var.acr_geo_replication_locations
  tags                      = local.tags
}

module "defender" {
  source         = "../../modules/defender"
  enabled        = var.defender_enabled
  resource_types = var.defender_resource_types
  alert_email    = var.alert_email
}

module "global_diagnostics" {
  source       = "../../modules/diagnostics"
  name_base    = local.global_name_base
  workspace_id = module.stamp[var.default_stamp].workspace_id

  targets = merge(
    { acr = module.acr.id },
    var.frontdoor_enabled ? { frontdoor = module.frontdoor.profile_id } : {}
  )
}

# ---------------------------------------------------------------------------
# Stamps. Hoy uno; la clave del mapa es el valor de Tenants.data_residency.
# ---------------------------------------------------------------------------

module "stamp" {
  source   = "../../modules/stamp"
  for_each = var.stamps

  name_prefix = var.name_prefix
  project     = var.project
  environment = var.environment
  data_region = each.key
  location    = each.value.location
  tenant_id   = var.tenant_id

  zone_redundant = each.value.zone_redundant

  address_space       = each.value.address_space
  apps_subnet_prefix  = each.value.apps_subnet_prefix
  pe_subnet_prefix    = each.value.pe_subnet_prefix
  mysql_subnet_prefix = each.value.mysql_subnet_prefix

  mysql_database_name         = each.value.mysql_database_name
  mysql_admin_login           = each.value.mysql_admin_login
  mysql_sku_name              = each.value.mysql_sku_name
  mysql_storage_gb            = each.value.mysql_storage_gb
  mysql_backup_retention_days = each.value.mysql_backup_retention_days
  mysql_geo_redundant_backup  = each.value.mysql_geo_redundant_backup
  mysql_high_availability     = each.value.mysql_high_availability

  mysql_backup_vault_enabled        = each.value.mysql_backup_vault_enabled
  mysql_backup_vault_redundancy     = each.value.mysql_backup_vault_redundancy
  mysql_backup_vault_retention_days = each.value.mysql_backup_vault_retention_days
  mysql_backup_vault_daily_time     = each.value.mysql_backup_vault_daily_time

  redis_sku_name                  = each.value.redis_sku_name
  redis_high_availability_enabled = each.value.redis_high_availability_enabled

  storage_replication_type              = each.value.storage_replication_type
  storage_backup_retention_days         = each.value.storage_backup_retention_days
  storage_backup_monthly_retention_days = each.value.storage_backup_monthly_retention_days
  storage_backup_yearly_retention_days  = each.value.storage_backup_yearly_retention_days

  registry_server   = module.acr.login_server
  acr_id            = module.acr.id
  image_name        = var.image_name
  image_tag         = var.image_tag
  migrate_image_tag = var.migrate_image_tag
  target_port       = var.target_port

  web_cpu                         = each.value.web_cpu
  web_memory                      = each.value.web_memory
  web_min_replicas                = each.value.web_min_replicas
  web_max_replicas                = each.value.web_max_replicas
  concurrent_requests_per_replica = each.value.concurrent_requests_per_replica

  # Los price IDs de Paddle salen del MISMO archivo que el catalogo de la app
  # (generado desde src/lib/addonCatalog.ts) en vez de escribirse a mano aca o
  # en TF_VARS_PROD: dos listas de 144 entradas se desincronizan solas. No son
  # secretos --viajan al browser en el checkout y estan versionados-- asi que
  # van como env vars planas y no por Key Vault.
  # `__tests__/unit/paddlePriceIdsTerraform.test.ts` falla si el JSON se separa
  # del catalogo.
  extra_env_vars = merge(
    var.extra_env_vars,
    each.value.extra_env_vars,
    jsondecode(file("${path.module}/paddle-price-ids.json")),
  )
  key_vault_secret_ids = var.key_vault_secret_ids
  key_vault_secret_env = var.key_vault_secret_env
  allowed_ip_ranges    = var.allowed_ip_ranges

  cron_secret_name           = var.cron_secret_name
  cron_jobs                  = var.cron_jobs
  cron_timezone_offset_hours = var.cron_timezone_offset_hours

  keyvault_create                   = each.value.keyvault_create
  keyvault_existing_name            = each.value.keyvault_existing_name
  keyvault_existing_resource_group  = each.value.keyvault_existing_resource_group
  keyvault_private_endpoint_enabled = each.value.keyvault_private_endpoint_enabled
  keyvault_network_acls_enabled     = each.value.keyvault_network_acls_enabled
  keyvault_allowed_ip_rules         = each.value.keyvault_allowed_ip_rules

  log_retention_days              = var.log_retention_days
  log_daily_quota_gb              = var.log_daily_quota_gb
  appinsights_sampling_percentage = var.appinsights_sampling_percentage
  resource_lock_enabled           = var.resource_lock_enabled
  alert_email                     = var.alert_email
  monthly_budget_amount           = each.value.monthly_budget_amount
  budget_start_date               = var.budget_start_date
  custom_domain_enabled           = each.value.custom_domain_enabled
  custom_domain_name              = each.value.custom_domain_name
  custom_domain_certificate_name  = each.value.custom_domain_certificate_name

  tags = merge(local.tags, { DataRegion = upper(each.key) })

  # Garantiza que el role AcrPull propagó en AAD antes de que Container Apps
  # y los cron jobs intenten hacer pull de la imagen. Sin este depends_on, el
  # apply falla con "unable to pull image using Managed identity" en el
  # primer despliegue de cada stamp.
  # Restricción aprendida: 2026-07-28 — error ContainerAppOperationError en prod.
  depends_on = [module.acr]
}


# ---------------------------------------------------------------------------
# Front Door: sólo con 2+ stamps. Con uno, Cloudflare alcanza.
# ---------------------------------------------------------------------------

module "frontdoor" {
  source              = "../../modules/frontdoor"
  enabled             = var.frontdoor_enabled
  name_base           = local.global_name_base
  name_compact        = local.global_name_compact
  resource_group_name = azurerm_resource_group.global.name
  sku_name            = var.frontdoor_sku
  origin_host_name    = local.stamp_hostnames[var.default_stamp]

  extra_origins = [
    for k, v in var.stamp_geo_routing : {
      key       = k
      host_name = local.stamp_hostnames[k]
      countries = v
    }
  ]

  tags = local.tags
}

# ---------------------------------------------------------------------------
# Sistema de Backup Automatizado para MySQL Flexible Server
#
# RG separado, misma suscripción, misma VNet que el stamp (decisión del
# usuario 2026-07-30) — sin Private Endpoint nuevo, esa VNet ya tiene la zona
# DNS privada de mysql vinculada. Ver
# infra/terraform/modules/mysql_backup/variables.tf para el detalle completo.
# ---------------------------------------------------------------------------

# ── Import puntual: TEAMS_WEBHOOK_URL ya existe en Azure ─────────────────────
#
# La variable se creo a mano por la API el 2026-09-12 para que la alerta a Teams
# funcionara el mismo dia, ANTES de que existiera este recurso en el modulo. Por
# eso el primer apply muere con "a resource with the ID ... already exists - to
# be managed via Terraform this resource needs to be imported into the State".
#
# Se resuelve con un `import` block y no con `terraform import` a mano porque el
# workflow es workflow_dispatch y no expone un paso de import: asi entra por el
# apply normal y queda auditado en el plan.
#
# El ID se arma desde el data source y no hardcodeado: el subscription id es un
# secreto del pipeline (sale enmascarado como *** en los logs).
#
# BORRAR ESTE BLOQUE una vez que el apply haya pasado. Terraform lo ignora si el
# recurso ya esta en el state, pero dejarlo es ruido permanente en cada plan.
data "azurerm_client_config" "current" {}

import {
  to = module.mysql_backup[0].azurerm_automation_variable_string.teams_webhook_url
  id = "/subscriptions/${data.azurerm_client_config.current.subscription_id}/resourceGroups/${var.mysql_backup_resource_group_name}/providers/Microsoft.Automation/automationAccounts/aa-mysql-backups/variables/TEAMS_WEBHOOK_URL"
}

module "mysql_backup" {
  count  = var.mysql_backup_enabled ? 1 : 0
  source = "../../modules/mysql_backup"

  location            = var.stamps[var.default_stamp].location
  resource_group_name = var.mysql_backup_resource_group_name
  # Role propio: estos recursos son del sistema de backup, no del stamp de la
  # app. Sin el merge, el `Role = "FinOps"` global les borraba el valor
  # descriptivo que estaba puesto a mano en el portal.
  tags = merge(local.tags, { Role = "Backups Finops" })

  existing_vnet_name                = module.stamp[var.default_stamp].vnet_name
  existing_vnet_resource_group_name = module.stamp[var.default_stamp].vnet_resource_group_name
  vm_subnet_prefix                  = var.mysql_backup_vm_subnet_prefix
  bastion_enabled                   = var.mysql_backup_bastion_enabled
  bastion_subnet_prefix             = var.mysql_backup_bastion_subnet_prefix

  vm_size = var.mysql_backup_vm_size

  mysql_fqdn           = module.stamp[var.default_stamp].mysql_fqdn
  mysql_admin_login    = module.stamp[var.default_stamp].mysql_admin_login
  mysql_admin_password = module.stamp[var.default_stamp].mysql_admin_password
  mysql_database_names = [var.stamps[var.default_stamp].mysql_database_name]

  storage_account_name                      = module.stamp[var.default_stamp].storage_account_name
  storage_account_primary_connection_string = module.stamp[var.default_stamp].storage_account_primary_connection_string

  key_vault_id = module.stamp[var.default_stamp].key_vault_id

  alert_email         = var.alert_email
  teams_webhook_url   = var.teams_webhook_url
  schedule_start_time = var.mysql_backup_schedule_start_time
}

# Import del runbook Orchestrator pre-existente en Azure Automation
import {
  to = module.mysql_backup[0].azurerm_automation_runbook.orchestrator
  id = "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/cscs-finops-prod-westus2-backup-rg/providers/Microsoft.Automation/automationAccounts/aa-mysql-backups/runbooks/Orchestrator-Start-Backup-Stop"
}
