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

variable "subscription_id" {
  type = string
}

variable "network_flow_logs_enabled" {
  description = "Habilita VNet Flow Logs y Traffic Analytics sólo para staging y producción."
  type        = bool
  default     = false
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

variable "mysql_version" {
  description = "Versión de MySQL con la que se crea el servidor (en uno existente se ignora). Ver modules/mysql."
  type        = string
  default     = "8.0.21"
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

# --- Azure Backup (Data Protection Backup Vault) para MySQL Flexible Server —
# medida de contención adicional a los backups automáticos nativos
# (mysql_backup_retention_days arriba) y al runbook de mysql_backup. Punto de
# restauración gestionado por Azure, fuera del ciclo de vida del servidor.
variable "mysql_backup_vault_enabled" {
  type    = bool
  default = false
}

variable "mysql_backup_vault_redundancy" {
  description = "LocallyRedundant o GeoRedundant. Geo duplica el costo de storage del vault."
  type        = string
  default     = "LocallyRedundant"
}

variable "mysql_backup_vault_retention_days" {
  type    = number
  default = 30
}

variable "mysql_backup_vault_daily_time" {
  description = "RFC3339 completo (fecha + hora): fecha+día-de-semana de referencia del backup SEMANAL (Azure Data Protection sólo acepta P1W para MySQL Flexible Server, no P1D — ver el comentario en modules/stamp/main.tf). Azure sólo usa la hora/minuto y el día de la semana de esta fecha; el año/mes son sólo el ancla. Evitar que la hora coincida con el sync (06:00 UTC) y con el runbook de mysql_backup."
  type        = string
  default     = "2026-01-01T04:00:00+00:00"
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

variable "storage_backup_monthly_retention_days" {
  type = number
}

variable "storage_backup_yearly_retention_days" {
  type = number
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
    Este tag se construye con `--target migrator` (INFRA-08): el stage builder,
    que sí tiene el código fuente, los .sql y el node_modules completo, pero
    corriendo con un usuario no-root. El nombre del tag sigue siendo `builder`:
      az acr build --registry <acr> --image finops:builder --target migrator .
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
    # Mismo motivo que en environments/prod/variables.tf: el tipo tiene que
    # espejar EXACTO el de var.jobs en modules/cronjobs en TODAS las capas de
    # passthrough (prod → stamp → cronjobs), o Terraform descarta en silencio
    # los campos no declarados en cada límite de module call. Esta era la
    # SEGUNDA capa con el mismo bug — el fix en environments/prod no alcanzaba
    # porque acá, un nivel más adentro, se volvía a truncar.
    name       = optional(string)
    async_poll = optional(bool, false)
  }))
  default = {}
}

# --- key vault ---
# INFRA-07: defaults seguros. Un vault creado por el módulo nace con firewall Deny y
# private endpoint; create = false (vault existente por data source) hay que pedirlo
# explícitamente y no admite firewall (ver la precondición en modules/keyvault).
variable "keyvault_create" {
  type    = bool
  default = true
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
  default = true
}

variable "keyvault_network_acls_enabled" {
  description = "Firewall del vault en default_action = Deny. Ver infra/docs/keyvault-network-hardening.md."
  type        = bool
  default     = true
}

variable "keyvault_allowed_ip_rules" {
  description = "IPs/CIDRs permanentes del vault. La IP efímera del runner la maneja el workflow."
  type        = list(string)
  default     = []
}

variable "keyvault_allowed_subnet_ids" {
  description = "Subredes de runners con acceso de red al vault del stamp."
  type        = list(string)
  default     = []
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

variable "enable_delete_lock" {
  type    = bool
  default = true
}

variable "blob_managed_identity_enabled" {
  description = <<-DESC
    true = el app le habla a Blob con la identidad administrada (le agrega
    AZURE_STORAGE_ACCOUNT_NAME, que azureBlobStorage.ts prefiere sobre la connection
    string). Hace falta el rol Storage Blob Data Contributor de la identidad sobre la
    cuenta, que ya existe. Predeterminado true junto con Shared Key apagada;
    volver a connection string requiere habilitar la clave y revisar la excepcion de CI.
  DESC
  type        = bool
  default     = true
}

variable "security_activity_alerts_enabled" {
  description = "Alertas de Activity Log a nivel de suscripción (modules/security_policy/audit.tf). Encender en UN solo stamp."
  type        = bool
  default     = false
}

variable "security_policy_audit_enabled" {
  description = "Políticas integradas de Azure en modo auditoría sobre el resource group del stamp (modules/security_policy/audit.tf)."
  type        = bool
  default     = false
}

variable "nat_gateway_enabled" {
  description = "NAT Gateway con IP fija de salida para la subred de apps (modules/network/main.tf). Cambia la salida de TODO el entorno."
  type        = bool
  default     = false
}

variable "apps_nsg_block_imds" {
  description = "NSG en la subred de apps que deniega la salida a IMDS (modules/network/main.tf). Probar primero en staging."
  type        = bool
  default     = false
}

variable "storage_shared_access_key_enabled" {
  description = <<-DESC
    false = la cuenta de Storage de la app rechaza toda solicitud autorizada con la clave de
    cuenta, incluidas las SAS firmadas con ella (sólo valen Entra ID y las SAS de delegación de
    usuario). Antes de apagarla tienen que haber migrado los tres clientes: la app
    (blob_managed_identity_enabled), los backups (runbook worker con identidad administrada: en el
    Hybrid Worker es la de la Automation Account) y Terraform (storage_use_azuread en el
    provider). El rollback es volver a true. Ver
    docs/security/endurecimiento-infraestructura-saas-2026-10-09.md, 7.6.
  DESC
  type        = bool
  default     = false
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

variable "custom_domain_certificate_source" {
  description = "managed (certificado gestionado de Azure), byo_staged (crea el propio y mantiene el gestionado) o byo (sólo el propio, desde Key Vault). Ver modules/custom_domain."
  type        = string
  default     = "managed"
}

variable "custom_domain_byo_certificate_name" {
  description = "Nombre del certificado propio en el entorno; para rotarlo, uno nuevo. Vacío = el del módulo."
  type        = string
  default     = ""
}

# --- IA de plataforma (modules/ai_services) ---
variable "ai_services_enabled" {
  description = "Cuenta de Azure AI Services del stamp, con private endpoint y la identidad de la app como credencial."
  type        = bool
  default     = false
}

variable "ai_services_location" {
  description = "Región de la cuenta de IA; null = la del stamp. West US 2 no ofrece modelos de Azure OpenAI: el stamp us usa westus3."
  type        = string
  default     = null
}

variable "ai_services_entra_auth" {
  description = <<-DESC
    true: la app pasa a la cuenta nueva con Entra ID (AZURE_OPENAI_RESOURCE_NAME,
    AZURE_OPENAI_DEPLOYMENT y AZURE_OPENAI_AUTH=entra). false: sólo la
    infraestructura; la app sigue con la key, como hoy. Sirve para verificar
    DNS y RBAC antes de pasar el tráfico, y de rollback sin borrar la cuenta.
  DESC
  type        = bool
  default     = true
}

# --- Document Intelligence (modules/ai_services, kind FormRecognizer) ---
variable "document_intelligence_enabled" {
  description = "Cuenta de Document Intelligence del stamp, sólo con Entra ID, y el cron external-spend-poll que la usa."
  type        = bool
  default     = false
}

variable "tags" {
  type = map(string)
}

variable "mysql_audit_log_mode" {
  description = "Auditoría del servidor MySQL (modules/mysql): unmanaged (por defecto, no gestiona nada), on u off. Ver el módulo."
  type        = string
  default     = "unmanaged"
}

variable "security_activity_log_export_enabled" {
  description = "Exporta el Activity Log de la SUSCRIPCIÓN al workspace de este stamp (modules/security_policy). Encender en UN solo stamp. Apagado por defecto."
  type        = bool
  default     = false
}

variable "security_tables_retention_days" {
  description = "Retención interactiva (días) de las tablas de seguridad del workspace (modules/monitoring). 0 = no se gestionan."
  type        = number
  default     = 0
}

variable "security_tables_total_retention_days" {
  description = "Retención total (días) de las tablas de seguridad del workspace. Rollback: igualarla a la interactiva."
  type        = number
  default     = 0
}

variable "storage_malware_scanning_enabled" {
  description = "AISEC-09: Defender for Storage con escaneo antimalware al subir en la cuenta del stamp, y lectura de support-attachments sólo para blobs marcados limpios (ABAC)."
  type        = bool
  default     = false
}

variable "storage_malware_scan_cap_gb_per_month" {
  description = "Tope mensual de GB escaneados por la cuenta (costo). -1 = sin tope."
  type        = number
  default     = 100
}

variable "segmentation_nsgs_enabled" {
  description = "INFRA-06: NSG de entrada en las subredes de private endpoints y MySQL (modules/network/main.tf). Probar primero en staging."
  type        = bool
  default     = false
}

variable "pe_extra_client_prefixes" {
  description = "CIDR, además de la subred de apps, autorizados a los private endpoints."
  type        = list(string)
  default     = []
}

variable "mysql_extra_client_prefixes" {
  description = "CIDR, además de la subred de apps, autorizados a MySQL por 3306."
  type        = list(string)
  default     = []
}

variable "egress_firewall_private_ip" {
  description = "IP privada del firewall de salida; null = sin UDR."
  type        = string
  default     = null
}
