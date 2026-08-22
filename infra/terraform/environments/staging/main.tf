# Staging Environment — Opción 1 (Recomendada)
# ============================================
# 
# ARQUITECTURA:
# - Container Apps Environment: COMPARTIDO con prod (mismo CAE, etiquetado por app)
# - MySQL: SEPARADA (finops_staging en servidor diferente)
# - Redis: COMPARTIDO con prefijo (staging:key)
# - Storage & Key Vault: COMPARTIDOS
#
# COSTO MENSUAL STAGING:
# - MySQL B1ms: ~$30/mes
# - CAE (1 replica, 0.5 vCPU): ~$10/mes
# - Total incremental: ~$40/mes
#
# Nota: Este archivo es IDÉNTICO a prod/main.tf. La diferenciación
#       ocurre en variables (staging.tfvars) y en los outputs.

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
      prevent_deletion_if_contains_resources = false
    }
  }
  subscription_id = var.subscription_id
  tenant_id       = var.tenant_id
  use_oidc        = true
}

locals {
  global_name_base    = lower("${var.name_prefix}-${var.project}-${var.environment}-global")
  global_name_compact = lower(replace(local.global_name_base, "-", ""))

  tags = merge(var.tags, {
    Environment = upper(var.environment)
    Service     = "CSCS-FINOPS"
    ManagedBy   = "Terraform"
  })

  stamp_hostnames = { for k, s in module.stamp : k => s.hostname }
}

# Control Plane (ACR compartido con prod)
resource "azurerm_resource_group" "global" {
  name     = "${local.global_name_base}-rg"
  location = var.global_location
  tags     = local.tags
}

# Referencia al ACR de prod (data source, no crea nada nuevo)
data "azurerm_container_registry" "acr" {
  name                = var.acr_name
  resource_group_name = var.acr_resource_group_name
}

# Stamps (por residencia de datos) — para staging, típicamente un solo stamp
module "stamp" {
  for_each = var.stamps

  source = "../../modules/stamp"

  name_prefix      = var.name_prefix
  project          = var.project
  environment      = var.environment
  stamp_identifier = each.key
  location         = each.value.location
  tags             = local.tags

  # ACR compartido (referenciado, no creado)
  acr_login_server  = data.azurerm_container_registry.acr.login_server
  acr_admin_enabled = false

  # Imagen
  image_name        = var.image_name
  image_tag         = var.image_tag
  migrate_image_tag = var.migrate_image_tag
  target_port       = var.target_port

  # Red
  address_space       = each.value.address_space
  apps_subnet_prefix  = each.value.apps_subnet_prefix
  pe_subnet_prefix    = each.value.pe_subnet_prefix
  mysql_subnet_prefix = each.value.mysql_subnet_prefix
  zone_redundant      = each.value.zone_redundant

  # MySQL STAGING (separada de prod)
  mysql_database_name         = each.value.mysql_database_name
  mysql_admin_login           = each.value.mysql_admin_login
  mysql_sku_name              = each.value.mysql_sku_name
  mysql_storage_gb            = each.value.mysql_storage_gb
  mysql_backup_retention_days = each.value.mysql_backup_retention_days
  mysql_geo_redundant_backup  = each.value.mysql_geo_redundant_backup
  mysql_high_availability     = each.value.mysql_high_availability
  mysql_backup_vault_enabled  = each.value.mysql_backup_vault_enabled

  # Redis COMPARTIDO (mismo Redis que prod, pero con prefijo en keys)
  redis_sku_name                  = each.value.redis_sku_name
  redis_high_availability_enabled = each.value.redis_high_availability_enabled

  # Storage
  storage_replication_type      = each.value.storage_replication_type
  storage_backup_retention_days = each.value.storage_backup_retention_days

  # Container Apps (web) — MENOS RESOURCES para staging
  web_cpu                         = each.value.web_cpu
  web_memory                      = each.value.web_memory
  web_min_replicas                = each.value.web_min_replicas
  web_max_replicas                = each.value.web_max_replicas
  concurrent_requests_per_replica = each.value.concurrent_requests_per_replica

  # Variables de entorno
  extra_env_vars = merge(
    each.value.extra_env_vars,
    {
      ENVIRONMENT      = var.environment
      REDIS_PREFIX     = "${var.environment}:"
      LOG_LEVEL        = "info"
      ENABLE_TELEMETRY = "true"
    }
  )

  # Key Vault
  keyvault_create                   = each.value.keyvault_create
  keyvault_existing_name            = each.value.keyvault_existing_name
  keyvault_existing_resource_group  = each.value.keyvault_existing_resource_group
  keyvault_private_endpoint_enabled = each.value.keyvault_private_endpoint_enabled
  keyvault_network_acls_enabled     = each.value.keyvault_network_acls_enabled
  keyvault_allowed_ip_rules         = each.value.keyvault_allowed_ip_rules

  # Presupuesto
  monthly_budget_amount = each.value.monthly_budget_amount

  # Dominio personalizado
  custom_domain_enabled          = each.value.custom_domain_enabled
  custom_domain_name             = each.value.custom_domain_name
  custom_domain_certificate_name = each.value.custom_domain_certificate_name
}

# CRON Jobs para staging (opcional, recomendado para testing)
module "cron_jobs" {
  source = "../../modules/cronjobs"

  name_prefix = var.name_prefix
  project     = var.project
  environment = var.environment
  location    = var.stamps[var.default_stamp].location
  tags        = local.tags

  # ACR compartido
  acr_login_server = data.azurerm_container_registry.acr.login_server

  image_name        = var.image_name
  migrate_image_tag = var.migrate_image_tag
  image_tag         = var.image_tag
  target_port       = var.target_port

  # Referencia al stamp (web para obtener CAE, KV, etc.)
  web_app_id           = module.stamp[var.default_stamp].web_app_id
  managed_identity_id  = module.stamp[var.default_stamp].managed_identity_id
  container_app_env_id = module.stamp[var.default_stamp].container_app_env_id
  keyvault_id          = module.stamp[var.default_stamp].keyvault_id
  storage_account_name = module.stamp[var.default_stamp].storage_account_name
  storage_account_id   = module.stamp[var.default_stamp].storage_account_id

  jobs = var.cron_jobs

  cron_timezone_offset_hours = var.cron_timezone_offset_hours
  cron_secret_name           = var.cron_secret_name

  # Variables de entorno compartidas
  extra_env_vars = merge(
    var.extra_env_vars,
    {
      ENVIRONMENT  = var.environment
      REDIS_PREFIX = "${var.environment}:"
      LOG_LEVEL    = "info"
    }
  )

  key_vault_secret_ids = var.key_vault_secret_ids
  key_vault_secret_env = var.key_vault_secret_env
  allowed_ip_ranges    = var.allowed_ip_ranges
}
