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
    mysql_version               = optional(string, "8.0.21")
    mysql_storage_gb            = optional(number, 64)
    mysql_backup_retention_days = optional(number, 14)
    mysql_geo_redundant_backup  = optional(bool, false)
    mysql_high_availability     = optional(bool, false)
    mysql_audit_log_mode        = optional(string, "unmanaged")

    # Azure Backup (Data Protection Backup Vault) — contención adicional,
    # ver modules/stamp/main.tf.
    mysql_backup_vault_enabled        = optional(bool, false)
    mysql_backup_vault_redundancy     = optional(string, "LocallyRedundant")
    mysql_backup_vault_retention_days = optional(number, 30)
    mysql_backup_vault_daily_time     = optional(string, "2026-01-01T04:00:00+00:00")

    # Azure Managed Redis.
    redis_sku_name                  = optional(string, "Balanced_B3")
    redis_high_availability_enabled = optional(bool, true)

    storage_replication_type = optional(string, "ZRS")
    # 90 = el numero que ya publica el DPA ("Backups are retained for disaster
    # recovery and deleted after 90 days", docs/trust-center/DPA_EN.md:54).
    # Estaba en 35: la ventana real de recuperacion era menos de la mitad de
    # la comprometida.
    storage_backup_retention_days         = optional(number, 90)
    storage_backup_monthly_retention_days = optional(number, 1095)
    storage_backup_yearly_retention_days  = optional(number, 3650)

    web_cpu                         = optional(number, 1.0)
    web_memory                      = optional(string, "2Gi")
    web_min_replicas                = optional(number, 1)
    web_max_replicas                = optional(number, 3)
    concurrent_requests_per_replica = optional(number, 40)

    extra_env_vars = optional(map(string), {})

    keyvault_create                   = optional(bool, false)
    keyvault_existing_name            = optional(string, "")
    keyvault_existing_resource_group  = optional(string, "")
    keyvault_private_endpoint_enabled = optional(bool, false)
    keyvault_network_acls_enabled     = optional(bool, false)
    keyvault_allowed_ip_rules         = optional(list(string), [])

    monthly_budget_amount = optional(number, 250)

    custom_domain_enabled          = optional(bool, false)
    custom_domain_name             = optional(string, "")
    custom_domain_certificate_name = optional(string, "")
    # managed | byo_staged | byo (ver modules/custom_domain/main.tf). Con byo el .pfx y su
    # contraseña salen de los secretos origin-cert-pfx y origin-cert-pfx-password del Key Vault
    # del stamp.
    custom_domain_certificate_source   = optional(string, "managed")
    custom_domain_byo_certificate_name = optional(string, "")

    # IA de plataforma (modules/ai_services). Ver modules/stamp/variables.tf.
    ai_services_enabled    = optional(bool, false)
    ai_services_location   = optional(string)
    ai_services_entra_auth = optional(bool, true)

    # Document Intelligence (modules/ai_services). Ver modules/stamp/variables.tf.
    document_intelligence_enabled = optional(bool, false)

    # Auditoría (modules/security_policy/audit.tf). Apagadas por defecto: no cambian ni bloquean
    # nada. Las alertas son de la suscripción: encenderlas en un solo stamp.
    security_activity_alerts_enabled = optional(bool, false)
    security_policy_audit_enabled    = optional(bool, false)

    # Exportación del Activity Log de la suscripción (también de la suscripción: UN solo stamp) y retención de
    # las tablas de seguridad del workspace. 0 / false = no se gestionan. Ver modules/security_policy y
    # modules/monitoring.
    security_activity_log_export_enabled = optional(bool, false)
    security_tables_retention_days       = optional(number, 0)
    security_tables_total_retention_days = optional(number, 0)

    # NAT Gateway con IP fija de salida (modules/network/main.tf). Cambia la salida de TODO el
    # entorno: ver el runbook "Cerrar el origen" de docs/security/.
    nat_gateway_enabled = optional(bool, false)

    # NSG que deniega la salida de los contenedores a IMDS (AISEC-03, modules/network/main.tf).
    apps_nsg_block_imds = optional(bool, false)
  }))
}

variable "default_stamp" {
  type    = string
  default = "us"
}

# ---------------------------------------------------------------------------
# Cron. Estas expresiones son el reemplazo del crontab manual del VPS.
# ---------------------------------------------------------------------------
variable "cron_jobs" {
  type = map(object({
    cron            = string
    timeout_seconds = optional(number, 600)
    auth_mode       = optional(string, "header")
    # `name` y `async_poll` faltaban acá — el tipo de este variable (nivel
    # entorno) tiene que espejar EXACTO el de var.jobs en modules/cronjobs, o
    # Terraform descarta en silencio cualquier campo no declarado al pasar el
    # valor al módulo (coerción de tipo en el límite del module call). Pasó de
    # verdad: cron_jobs.sync.async_poll=true en terraform.tfvars nunca llegó
    # al módulo, así que el job siguió con el runner viejo (fetch-and-wait)
    # después de un apply que Terraform reportó exitoso — confirmado con
    # `terraform console` mostrando var.cron_jobs["sync"] SIN el campo.
    name       = optional(string)
    async_poll = optional(bool, false)
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

# --- cierre del origen (ver locals.origin_allowed_ip_ranges en cloudflare_ips.tf) ---
variable "origin_cloudflare_only" {
  description = <<-DESC
    true = el ingress del app sólo acepta los rangos IPv4 de Cloudflare (catálogo
    cloudflare_ips.tf) más origin_extra_allowed_ip_ranges (default: true). false deja
    el origen abierto a cualquier IP y permite saltear el WAF de Cloudflare.

    NO activarlo sin recorrer el runbook "Cerrar el origen" de
    docs/security/endurecimiento-infraestructura-saas-2026-10-09.md. Hay tres
    consumidores que NO vienen de Cloudflare: los cron jobs (llaman a la URL del
    entorno desde IPs de salida de Azure), el health check del deploy y la
    validación del certificado gestionado (DigiCert).
  DESC
  type        = bool
  default     = true
}

variable "origin_extra_allowed_ip_ranges" {
  description = <<-DESC
    CIDR IPv4 adicionales que pueden llegar al origen cuando origin_cloudflare_only
    es true: típicamente la IP fija de salida del entorno (NAT Gateway) para que los
    cron jobs no reciban 403. Se ignora si origin_cloudflare_only es false.
  DESC
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for c in var.origin_extra_allowed_ip_ranges : can(cidrhost(c, 0)) && !strcontains(c, ":")])
    error_message = "Sólo CIDR IPv4 válidos (ej. 203.0.113.7/32): Container Apps no admite IPv6 en ipAddressRange."
  }
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

variable "enable_delete_lock" {
  description = "Enable MySQL and newly created Key Vault delete locks. Disable only for an approved maintenance operation."
  type        = bool
  default     = true
}

variable "blob_managed_identity_enabled" {
  description = "true = la app usa Blob por identidad administrada (AZURE_STORAGE_ACCOUNT_NAME). Ver runbook de Storage en docs/security/endurecimiento-infraestructura-saas-2026-10-09.md."
  type        = bool
  default     = false
}

# Apagar la clave de cuenta de Storage (modules/storage). true = como hoy. Sólo se pone en false
# después de migrar la app, los backups y Terraform (docs/security/..., 7.6); un check lo vigila.
#
# Es una variable de nivel raíz, como blob_managed_identity_enabled, y NO un atributo de stamps:
# Checkov no resuelve `each.value.<atributo>` y CKV2_AZURE_41 (Storage con SAS policy) exige ver
# el valor de shared_access_key_enabled como un literal. Con el valor por un for_each el escaneo
# falla en CI (2026-10-11) aunque el recurso cumpla. Rige para todos los stamps.
variable "storage_shared_access_key_enabled" {
  description = "false = la cuenta de Storage de cada stamp rechaza toda solicitud autorizada con la clave de cuenta, incluidas las SAS firmadas con ella. Antes: app con identidad administrada, backups con la identidad de la VM y Terraform con storage_use_azuread. Rollback: true. Ver docs/security/endurecimiento-infraestructura-saas-2026-10-09.md, 7.6."
  type        = bool
  default     = true
}

variable "resource_lock_enabled" {
  description = "Feature flag de locks de borrado en recursos de datos. Default desactivado para evitar ScopeLocked en despliegues."
  type        = bool
  default     = false
}

variable "alert_email" {
  type = string
}

variable "teams_webhook_url" {
  # Sin `default` a proposito. Una variable de Automation encriptada que se
  # escribe vacia rompe en silencio (caso STORAGE_ACCOUNT_NAME, 2026-08-22):
  # sin default, un tfvars incompleto frena el plan en vez de publicar un
  # canal de alertas muerto.
  description = "URL del trigger HTTP del flow de Power Automate que postea en Teams. Lleva `sig=` en el query string: es un secreto, va en TF_VARS_PROD."
  type        = string
  sensitive   = true
}

variable "budget_start_date" {
  type    = string
  default = "2026-08-01T00:00:00Z"
}

variable "tags" {
  type    = map(string)
  default = {}
}

# ---------------------------------------------------------------------------
# Sistema de Backup Automatizado para MySQL Flexible Server
# ---------------------------------------------------------------------------

variable "mysql_backup_enabled" {
  description = "Apaga el módulo completo (VM Windows + Bastion + Automation) sin borrar nada del stamp."
  type        = bool
  default     = false
}

variable "mysql_backup_resource_group_name" {
  type    = string
  default = "cscs-finops-prod-westus2-backup-rg"
}

variable "mysql_backup_vm_subnet_prefix" {
  type    = string
  default = "10.50.30.0/24"
}

variable "mysql_backup_bastion_enabled" {
  description = "Azure Bastion para RDP puntual a la VM de backups. ~USD 140/mes en Basic: apagado salvo ventana de mantenimiento."
  type        = bool
  default     = false
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
  description = "RFC3339. Evitar que coincida con el sync diario (06:00 UTC) — compiten por la misma VNet/ancho de banda."
  type        = string
  default     = "2026-08-01T09:00:00-03:00"
}
