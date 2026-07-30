variable "name_prefix" {
  description = "Prefijo de la organización."
  type        = string
  default     = "cscs"
}

variable "project" {
  type    = string
  default = "finops"
}

variable "environment" {
  type = string
}

variable "data_region" {
  description = "Coincide con los valores de Tenants.data_residency: us, eu, latam, apac."
  type        = string
}

variable "location" {
  type = string
}

variable "tenant_id" {
  type = string
}

# --- red ---
variable "address_space" {
  type = list(string)
}

variable "apps_subnet_prefix" {
  type = string
}

variable "pe_subnet_prefix" {
  type = string
}

variable "mysql_subnet_prefix" {
  type = string
}

# --- mysql ---
variable "mysql_database_name" {
  type    = string
  default = "finops"
}

variable "mysql_admin_login" {
  type    = string
  default = "finops_admin"
}

variable "mysql_sku_name" {
  type = string
}

variable "mysql_storage_gb" {
  type = number
}

variable "mysql_backup_retention_days" {
  type    = number
  default = 14
}

variable "mysql_geo_redundant_backup" {
  type    = bool
  default = false
}

variable "mysql_high_availability" {
  description = "Exige sku GP_*. El tier Burstable no la soporta."
  type        = bool
  default     = false
}

# --- redis ---
variable "redis_sku_name" {
  description = "SKU de Azure Managed Redis (ej: Balanced_B3)."
  type        = string
  default     = "Balanced_B3"
}

variable "redis_high_availability_enabled" {
  description = "Habilita réplica y failover del cache."
  type        = bool
  default     = true
}

# --- storage ---
variable "storage_replication_type" {
  type    = string
  default = "ZRS"
}

variable "storage_backup_retention_days" {
  type    = number
  default = 35
}

# --- app ---
variable "registry_server" {
  type = string
}

variable "acr_id" {
  description = "ID del Azure Container Registry para asignar AcrPull a la identidad del stamp."
  type        = string
}

variable "image_name" {
  type    = string
  default = "finops"
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "migrate_image_tag" {
  description = <<-DESC
    Tag que usa el job de migraciones. NO es el mismo que el de la app: la
    imagen de runtime es un standalone de Next podado y no tiene scripts/,
    ni migrations/, ni tsx — `npm run migrate` ahí falla con "tsx: not found".
    Este tag se construye con `--target builder`, que sí tiene el código
    fuente, los .sql y el node_modules completo:
      az acr build --registry <acr> --image finops:builder --target builder .
  DESC
  type        = string
  default     = "builder"
}

variable "target_port" {
  type    = number
  default = 3000
}

variable "zone_redundant" {
  type    = bool
  default = true
}

variable "web_cpu" {
  type    = number
  default = 1.0
}

variable "web_memory" {
  type    = string
  default = "2Gi"
}

variable "web_min_replicas" {
  type    = number
  default = 1
}

variable "web_max_replicas" {
  type    = number
  default = 5
}

variable "concurrent_requests_per_replica" {
  type    = number
  default = 40
}

variable "extra_env_vars" {
  description = "El resto del .env (Paddle, WorkOS, SMTP, marketplace, MSAL...)."
  type        = map(string)
  default     = {}
}

variable "key_vault_secret_ids" {
  description = "nombre-del-secret-en-la-app => id del secret en Key Vault."
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

# --- cron ---
variable "cron_secret_name" {
  description = "Nombre en Key Vault del secreto que ya usa infraSecrets.ts."
  type        = string
  default     = "infra-cron-secret"
}

variable "cron_timezone_offset_hours" {
  description = "Huso de las expresiones cron. -3 = Argentina."
  type        = number
  default     = -3
}

variable "cron_jobs" {
  type = map(object({
    cron            = string
    timeout_seconds = optional(number, 600)
    auth_mode       = optional(string, "header")
  }))
  default = {}
}

# --- key vault ---
variable "keyvault_create" {
  type    = bool
  default = false
}

variable "keyvault_existing_name" {
  type    = string
  default = ""
}

variable "keyvault_existing_resource_group" {
  type    = string
  default = ""
}

variable "keyvault_private_endpoint_enabled" {
  type    = bool
  default = false
}

# --- observabilidad y coste ---
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
  type    = bool
  default = false
}

variable "alert_email" {
  type = string
}

variable "monthly_budget_amount" {
  type = number
}

variable "budget_start_date" {
  type    = string
  default = "2026-08-01T00:00:00Z"
}

variable "custom_domain_enabled" {
  description = "false hasta que el CNAME + TXT existan en el DNS. Ver custom_domain_dns_instructions en el output del environment."
  type        = bool
  default     = false
}

variable "custom_domain_name" {
  description = "FQDN del dominio propio, ej. finops.cscloudsolutions.com.ar"
  type        = string
  default     = ""
}

variable "custom_domain_certificate_name" {
  description = "Nombre real del managed certificate cuando se importó uno creado a mano. Ver modules/custom_domain/variables.tf."
  type        = string
  default     = ""
}

variable "tags" {
  type = map(string)
}
