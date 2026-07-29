variable "subscription_id" {
  type = string
}

variable "tenant_id" {
  type = string
}

variable "environment" {
  type = string
}

# Convención de nombres: <name_prefix>-<project>-<environment>-<region>-<tipo>.
# Ej: cscs-finops-prod-eastus2-rg
variable "name_prefix" {
  type    = string
  default = "cscs"
}

variable "project" {
  type    = string
  default = "finops"
}

variable "global_location" {
  description = "Región del plano de control (ACR). No aloja datos de clientes."
  type        = string
}

# ---------------------------------------------------------------------------
# Stamps. La clave del mapa es el valor de Tenants.data_residency que atiende.
# ---------------------------------------------------------------------------
variable "stamps" {
  type = map(object({
    location       = string
    zone_redundant = optional(bool, true)

    address_space       = list(string)
    apps_subnet_prefix  = string
    pe_subnet_prefix    = string
    mysql_subnet_prefix = string

    mysql_database_name         = optional(string, "finops")
    mysql_admin_login           = optional(string, "finops_admin")
    mysql_sku_name              = optional(string, "B_Standard_B2s")
    mysql_storage_gb            = optional(number, 64)
    mysql_backup_retention_days = optional(number, 14)
    mysql_geo_redundant_backup  = optional(bool, false)
    mysql_high_availability     = optional(bool, false)

    # Azure Managed Redis.
    redis_sku_name                  = optional(string, "Balanced_B3")
    redis_high_availability_enabled = optional(bool, true)

    storage_replication_type      = optional(string, "ZRS")
    storage_backup_retention_days = optional(number, 35)

    web_cpu                         = optional(number, 1.0)
    web_memory                      = optional(string, "2Gi")
    web_min_replicas                = optional(number, 1)
    web_max_replicas                = optional(number, 5)
    concurrent_requests_per_replica = optional(number, 40)

    extra_env_vars = optional(map(string), {})

    keyvault_create                   = optional(bool, false)
    keyvault_existing_name            = optional(string, "")
    keyvault_existing_resource_group  = optional(string, "")
    keyvault_private_endpoint_enabled = optional(bool, false)

    monthly_budget_amount = optional(number, 250)
  }))
}

variable "default_stamp" {
  type    = string
  default = "us"
}

variable "stamp_geo_routing" {
  description = "stamp => países ISO-3166. Sólo aplica con frontdoor_enabled."
  type        = map(list(string))
  default     = {}
}

# ---------------------------------------------------------------------------
# Cron. Estas expresiones son el reemplazo del crontab manual del VPS.
# ---------------------------------------------------------------------------
variable "cron_jobs" {
  type = map(object({
    cron            = string
    timeout_seconds = optional(number, 600)
    auth_mode       = optional(string, "header")
  }))
}

variable "cron_timezone_offset_hours" {
  description = "Huso en el que están escritas las expresiones de cron_jobs. -3 = Argentina."
  type        = number
  default     = -3
}

variable "cron_secret_name" {
  type    = string
  default = "infra-cron-secret"
}

# --- imagen ---
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
  description = "Tag para el job de migraciones; se construye con --target builder. Ver modules/stamp/variables.tf."
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

# --- front door ---
variable "frontdoor_enabled" {
  type    = bool
  default = false
}

variable "frontdoor_sku" {
  type    = string
  default = "Standard_AzureFrontDoor"
}

# --- defender for cloud (alcance suscripción) ---
variable "defender_enabled" {
  type    = bool
  default = false
}

variable "defender_resource_types" {
  type = list(string)
  default = [
    "KeyVaults",
    "OpenSourceRelationalDatabases",
    "StorageAccounts",
    "Containers",
    "Arm",
  ]
}

# --- transversal ---
variable "extra_env_vars" {
  type    = map(string)
  default = {}
}

variable "key_vault_secret_ids" {
  description = "nombre-en-la-app => id del secret en Key Vault (Paddle, WorkOS, SMTP...)."
  type        = map(string)
  default     = {}
}

variable "key_vault_secret_env" {
  description = "NOMBRE_DE_ENV_VAR => nombre del secret declarado arriba."
  type        = map(string)
  default     = {}
}

variable "allowed_ip_ranges" {
  type    = list(string)
  default = []
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "log_daily_quota_gb" {
  type    = number
  default = 1
}

variable "appinsights_sampling_percentage" {
  type    = number
  default = 100
}

variable "resource_lock_enabled" {
  description = "Feature flag de locks de borrado en recursos de datos. Default desactivado para evitar ScopeLocked en despliegues."
  type        = bool
  default     = false
}

variable "alert_email" {
  type = string
}

variable "budget_start_date" {
  type    = string
  default = "2026-08-01T00:00:00Z"
}

variable "tags" {
  type    = map(string)
  default = {}
}
