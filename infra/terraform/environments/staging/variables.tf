variable "subscription_id" {
  type = string
}

variable "tenant_id" {
  type = string
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "name_prefix" {
  type    = string
  default = "cscs"
}

variable "project" {
  type    = string
  default = "finops"
}

variable "global_location" {
  description = "Región del plano de control (ACR compartido con prod)."
  type        = string
  default     = "westus2"
}

# ===== ACR COMPARTIDO CON PROD =====
variable "acr_name" {
  description = "Nombre del ACR de prod (compartido con staging)"
  type        = string
  # Ejemplo: cscsfinopsprodglobalcr
}

variable "acr_resource_group_name" {
  description = "Resource Group del ACR de prod"
  type        = string
  # Ejemplo: cscs-finops-prod-westus2-rg
}

# ===== STAMPS (Típicamente 1 para staging) =====
variable "stamps" {
  type = map(object({
    location       = string
    zone_redundant = optional(bool, false) # ⚠️ Staging es NON-HA

    address_space       = list(string)
    apps_subnet_prefix  = string
    pe_subnet_prefix    = string
    mysql_subnet_prefix = string

    # MySQL STAGING (separada de prod, pero con SKU más pequeño)
    mysql_database_name         = optional(string, "finops_staging")
    mysql_admin_login           = optional(string, "finops_admin")
    mysql_sku_name              = optional(string, "B_Standard_B1ms") # ← Más pequeño que prod
    mysql_storage_gb            = optional(number, 32)                # ← 32GB es suficiente para staging
    mysql_backup_retention_days = optional(number, 7)                 # ← Menos backup que prod
    mysql_geo_redundant_backup  = optional(bool, false)               # ← Sin geo-redundancia
    mysql_high_availability     = optional(bool, false)               # ← Sin HA
    mysql_backup_vault_enabled  = optional(bool, false)               # ← Sin backup vault

    # Redis COMPARTIDO (mismo que prod, pero con prefijo en keys)
    redis_sku_name                  = optional(string, "Balanced_B3")
    redis_high_availability_enabled = optional(bool, true)

    # Storage (compartido con prod)
    storage_replication_type      = optional(string, "ZRS")
    storage_backup_retention_days = optional(number, 7)

    # Container Apps (web) — MENOS REPLICAS Y RECURSOS QUE PROD
    web_cpu                         = optional(number, 0.5)   # ← 0.5 vCPU (prod: 1.0)
    web_memory                      = optional(string, "1Gi") # ← 1 GB (prod: 2.5 GB)
    web_min_replicas                = optional(number, 1)     # ← 1 replica (prod: 2-5)
    web_max_replicas                = optional(number, 2)     # ← Max 2 (prod: 5)
    concurrent_requests_per_replica = optional(number, 20)    # ← Menos concurrencia

    extra_env_vars = optional(map(string), {})

    keyvault_create                   = optional(bool, false) # Usar existente
    keyvault_existing_name            = optional(string, "")  # (será la misma que prod)
    keyvault_existing_resource_group  = optional(string, "")
    keyvault_private_endpoint_enabled = optional(bool, false)
    keyvault_network_acls_enabled     = optional(bool, false)
    keyvault_allowed_ip_rules         = optional(list(string), [])

    monthly_budget_amount = optional(number, 50) # ← Budget más bajo que prod

    custom_domain_enabled          = optional(bool, false)
    custom_domain_name             = optional(string, "")
    custom_domain_certificate_name = optional(string, "")
  }))

  default = {
    us = {
      location       = "westus2"
      zone_redundant = false

      address_space       = ["10.1.0.0/16"]
      apps_subnet_prefix  = "10.1.0.0/24"
      pe_subnet_prefix    = "10.1.1.0/24"
      mysql_subnet_prefix = "10.1.2.0/24"

      mysql_database_name         = "finops_staging"
      mysql_admin_login           = "finops_admin"
      mysql_sku_name              = "B_Standard_B1ms"
      mysql_storage_gb            = 32
      mysql_backup_retention_days = 7
      mysql_geo_redundant_backup  = false
      mysql_high_availability     = false
      mysql_backup_vault_enabled  = false

      redis_sku_name                  = "Balanced_B3"
      redis_high_availability_enabled = true

      storage_replication_type      = "ZRS"
      storage_backup_retention_days = 7

      web_cpu                         = 0.5
      web_memory                      = "1Gi"
      web_min_replicas                = 1
      web_max_replicas                = 2
      concurrent_requests_per_replica = 20

      extra_env_vars = {}

      keyvault_create                   = false
      keyvault_existing_name            = ""
      keyvault_existing_resource_group  = ""
      keyvault_private_endpoint_enabled = false

      monthly_budget_amount = 50

      custom_domain_enabled = false
    }
  }
}

variable "default_stamp" {
  type    = string
  default = "us"
}

variable "stamp_geo_routing" {
  description = "stamp => países ISO-3166 (staging no usa geo-routing)."
  type        = map(list(string))
  default     = {}
}

# ===== CRON JOBS PARA STAGING (Opcional, recomendado para testing) =====
variable "cron_jobs" {
  type = map(object({
    cron            = string
    timeout_seconds = optional(number, 600)
    auth_mode       = optional(string, "header")
    name            = optional(string)
    async_poll      = optional(bool, false)
  }))
  default = {
    # Ejemplo: sync 1 vez al día (para testing)
    sync = {
      cron      = "0 6 * * *"
      name      = "sync"
      auth_mode = "header"
    }
  }
}

variable "cron_timezone_offset_hours" {
  description = "Huso para cron expressions (Argentina: -3)"
  type        = number
  default     = -3
}

variable "cron_secret_name" {
  type    = string
  default = "infra-cron-secret"
}

# ===== IMAGEN =====
variable "acr_sku" {
  type    = string
  default = "Basic"
}

variable "acr_geo_replication_locations" {
  type    = list(string)
  default = []
}

variable "image_name" {
  type    = string
  default = "finops"
}

variable "migrate_image_tag" {
  description = "Tag para migration jobs (builder)"
  type        = string
  default     = "builder"
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "target_port" {
  type    = number
  default = 3000
}

# ===== DEFENDER FOR CLOUD =====
variable "defender_enabled" {
  type    = bool
  default = false # Staging no necesita Defender
}

variable "defender_resource_types" {
  type    = list(string)
  default = []
}

# ===== TRANSVERSAL =====
variable "extra_env_vars" {
  type    = map(string)
  default = {}
}

variable "key_vault_secret_ids" {
  description = "nombre-en-app => id del secret en Key Vault"
  type        = map(string)
  default     = {}
}

variable "key_vault_secret_env" {
  description = "ENV_VAR => nombre del secret en Key Vault"
  type        = map(string)
  default     = {}
}

variable "allowed_ip_ranges" {
  type    = list(string)
  default = []
}

variable "log_retention_days" {
  type = number
  # 30 es el MÍNIMO que acepta Log Analytics (rango válido 30-730). Estaba en 7
  # "para gastar menos que prod", pero el apply falla con
  # "expected retention_in_days to be in the range (30 - 730)". El workspace
  # real tiene 30. Para gastar menos, la palanca es log_daily_quota_gb.
  default = 30
}

variable "log_daily_quota_gb" {
  type    = number
  default = 0.5 # Menos quota que prod
}

variable "appinsights_sampling_percentage" {
  type    = number
  default = 50 # Muestreo al 50% para ahorrar
}

variable "resource_lock_enabled" {
  description = "Feature flag de locks de borrado. Staging: false (para facilitar testing)."
  type        = bool
  default     = false
}

variable "alert_email" {
  type = string
  # Típicamente: operations-staging@cscloudsolutions.com.ar
}

variable "budget_start_date" {
  type    = string
  default = "2026-08-01T00:00:00Z"
}

variable "tags" {
  type = map(string)
  default = {
    Environment = "STAGING"
    Criticality = "Medium"
  }
}

# ===== BACKUP MYSQL (Típicamente disabled para staging) =====
variable "mysql_backup_enabled" {
  type    = bool
  default = false # Staging no necesita backup
}

variable "mysql_backup_resource_group_name" {
  type    = string
  default = "cscs-finops-staging-westus2-backup-rg"
}

variable "mysql_backup_vm_subnet_prefix" {
  type    = string
  default = "10.50.30.0/24"
}

variable "mysql_backup_bastion_subnet_prefix" {
  type    = string
  default = "10.50.40.0/27"
}

variable "mysql_backup_vm_size" {
  type    = string
  default = "Standard_D2s_v5"
}

variable "mysql_backup_schedule_start_time" {
  type    = string
  default = "2026-08-01T09:00:00-03:00"
}
