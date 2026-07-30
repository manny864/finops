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

  redis_sku_name                  = each.value.redis_sku_name
  redis_high_availability_enabled = each.value.redis_high_availability_enabled

  storage_replication_type      = each.value.storage_replication_type
  storage_backup_retention_days = each.value.storage_backup_retention_days

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

  extra_env_vars       = merge(var.extra_env_vars, each.value.extra_env_vars)
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
