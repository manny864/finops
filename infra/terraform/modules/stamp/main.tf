# Un STAMP (celda) = todo lo que toca datos de clientes, en una región.
#
# Hoy se instancia una sola vez (East US 2). La estructura existe porque el
# producto YA tiene la residencia de datos a medio camino: `Tenants.data_residency`
# es un ENUM(EU,US,LATAM,APAC,GLOBAL) con auditoría y locking, y
# src/modules/storage/regionPool.ts expone getTenantPool()/resolveTenantPool()
# apuntando todos los valores al mismo pool. Cuando exista un segundo stamp, la
# activación es cambiar POOL_BY_REGION — no rediseñar la infraestructura.

# Convención de nombres: <prefijo>-<proyecto>-<ambiente>-<region>-<tipo>.
# El tipo va como SUFIJO. Tres variantes porque Azure no acepta una sola:
#
#  name_base       cscs-finops-prod-eastus2   caso general
#  name_base_short cscs-finops-prod-wus2      Key Vault (máx 24 caracteres).
#                                             Lleva la región de Azure ABREVIADA
#                                             y no la lógica: el Key Vault tiene
#                                             purge protection, así que un vault
#                                             borrado reserva su nombre 30 días.
#                                             Sin la región en el nombre, mover
#                                             el stamp de región dejaría el
#                                             nombre bloqueado y el apply nuevo
#                                             fallaría.
#  name_compact    cscsfinopsprodeastus2      Storage y ACR: sólo alfanumérico.
locals {
  # eastus2 -> eus2, westus2 -> wus2, westeurope -> weu, brazilsouth -> brs
  location_short = lower(replace(replace(replace(replace(replace(replace(replace(
    var.location,
    "europe", "eu"), "brazil", "br"), "east", "e"), "west", "w"), "central", "c"), "south", "s"), "north", "n"
  ))

  name_base       = lower("${var.name_prefix}-${var.project}-${var.environment}-${var.location}")
  name_base_short = lower("${var.name_prefix}-${var.project}-${var.environment}-${local.location_short}")
  name_compact    = lower(replace(local.name_base, "-", ""))
}


module "network" {
  source              = "../network"
  name_base           = local.name_base
  location            = var.location
  address_space       = var.address_space
  apps_subnet_prefix  = var.apps_subnet_prefix
  pe_subnet_prefix    = var.pe_subnet_prefix
  mysql_subnet_prefix = var.mysql_subnet_prefix
  tags                = var.tags
}

module "private_dns" {
  source              = "../private_dns"
  name_base           = local.name_base
  resource_group_name = module.network.resource_group_name
  vnet_id             = module.network.vnet_id
  redis_enabled       = true
  tags                = var.tags
}

module "monitoring" {
  source              = "../monitoring"
  name_base           = local.name_base
  location            = var.location
  resource_group_name = module.network.resource_group_name
  retention_in_days   = var.log_retention_days
  daily_quota_gb      = var.log_daily_quota_gb

  appinsights_sampling_percentage = var.appinsights_sampling_percentage
  alert_email                     = var.alert_email
  tags                            = var.tags
}

resource "azurerm_user_assigned_identity" "app" {
  name                = "${local.name_base}-id"
  location            = var.location
  resource_group_name = module.network.resource_group_name
  tags                = var.tags
}

resource "azurerm_role_assignment" "acr_pull" {
  scope                = var.acr_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# En el primer deploy del stamp, Azure AD puede tardar en propagar AcrPull.
# Sin esta espera, Container Apps y Jobs pueden fallar al hacer pull.
resource "time_sleep" "acr_pull_propagation" {
  depends_on      = [azurerm_role_assignment.acr_pull]
  create_duration = "90s"
}

# El proyecto YA tiene un Key Vault en producción con las credenciales por
# tenant (tenantCredentials.ts) y los secretos de infra (infraSecrets.ts:
# infra-db-password, infra-redis-password, infra-cron-secret). Se referencia,
# no se recrea.
module "keyvault" {
  source                        = "../keyvault"
  name_base_short               = local.name_base_short
  location                      = var.location
  resource_group_name           = module.network.resource_group_name
  tenant_id                     = var.tenant_id
  create                        = var.keyvault_create
  existing_vault_name           = var.keyvault_existing_name
  existing_vault_resource_group = var.keyvault_existing_resource_group
  private_endpoint_enabled      = var.keyvault_private_endpoint_enabled
  subnet_id                     = module.network.private_endpoint_subnet_id
  private_dns_zone_id           = module.private_dns.vault_zone_id
  app_principal_id              = azurerm_user_assigned_identity.app.principal_id
  tags                          = var.tags
}

# En prod el vault es el existente y CRON_SECRET ya está ahí (infraSecrets.ts
# lo lee como `infra-cron-secret`). En un ambiente con vault nuevo no existe
# todavía, así que se genera: leerlo con un data source haría fallar el apply.
data "azurerm_key_vault_secret" "cron" {
  count        = var.keyvault_create ? 0 : 1
  name         = var.cron_secret_name
  key_vault_id = module.keyvault.id
}

resource "random_password" "cron" {
  count   = var.keyvault_create ? 1 : 0
  length  = 48
  special = false
}

# Ancla de 1 año para expiration_date. time_offset no rota solo — congela la
# fecha en el momento del primer apply y no vuelve a moverse en los
# siguientes, así que no fuerza un diff en cada plan. Vence, no rota: cuando
# Key Vault empiece a avisar por vencimiento, el secreto se regenera a mano
# (random_password no soporta point-in-time replace controlado) y esto se
# vuelve a aplicar.
resource "time_offset" "secret_expiry" {
  offset_years = 1
}

resource "azurerm_key_vault_secret" "cron" {
  count           = var.keyvault_create ? 1 : 0
  name            = var.cron_secret_name
  value           = random_password.cron[0].result
  key_vault_id    = module.keyvault.id
  content_type    = "cron-auth-token"
  expiration_date = time_offset.secret_expiry.rfc3339
  tags            = var.tags

  depends_on = [module.keyvault]
}

locals {
  cron_secret_id = var.keyvault_create ? azurerm_key_vault_secret.cron[0].versionless_id : data.azurerm_key_vault_secret.cron[0].versionless_id
}

resource "random_password" "mysql" {
  length           = 32
  special          = true
  override_special = "!#$%*()-_=+[]{}<>:?"
}

# `infra-db-password` a secas, que es el nombre que resuelve infraSecrets.
#
# Antes se guardaba como `infra-db-password-azure-<region>` para no pisarle el
# secreto a la app del VPS mientras ambos convivían. Ese motivo caducó: el VPS
# quedó congelado (2026-07-28) y esta instalación arranca de cero, así que el
# nombre desalineado sólo lograba que la app no encontrara el secreto.
resource "azurerm_key_vault_secret" "mysql_password" {
  name            = "infra-db-password"
  value           = random_password.mysql.result
  key_vault_id    = module.keyvault.id
  content_type    = "password"
  expiration_date = time_offset.secret_expiry.rfc3339
  tags            = var.tags

  depends_on = [module.keyvault]
}

module "mysql" {
  source                       = "../mysql"
  name_base                    = local.name_base
  location                     = var.location
  resource_group_name          = module.network.resource_group_name
  database_name                = var.mysql_database_name
  admin_login                  = var.mysql_admin_login
  admin_password               = random_password.mysql.result
  sku_name                     = var.mysql_sku_name
  storage_gb                   = var.mysql_storage_gb
  backup_retention_days        = var.mysql_backup_retention_days
  geo_redundant_backup_enabled = var.mysql_geo_redundant_backup
  high_availability            = var.mysql_high_availability
  subnet_id                    = module.network.mysql_subnet_id
  private_dns_zone_id          = module.private_dns.mysql_zone_id
  tags                         = var.tags
}

module "redis" {
  source                        = "../redis"
  name_base                     = local.name_base
  location                      = var.location
  resource_group_name           = module.network.resource_group_name
  sku_name                      = var.redis_sku_name
  high_availability_enabled     = var.redis_high_availability_enabled
  public_network_access         = "Disabled"
  subnet_id                     = module.network.private_endpoint_subnet_id
  private_dns_zone_id           = module.private_dns.redis_zone_id
  private_link_subresource_name = "redisEnterprise"
  tags                          = var.tags
}

module "storage" {
  source                    = "../storage"
  name_compact              = local.name_compact
  location                  = var.location
  resource_group_name       = module.network.resource_group_name
  replication_type          = var.storage_replication_type
  backup_retention_days     = var.storage_backup_retention_days
  shared_access_key_enabled = true
  app_principal_id          = azurerm_user_assigned_identity.app.principal_id
  tags                      = var.tags
}

resource "azurerm_container_app_environment" "this" {
  name                       = "${local.name_base}-cae"
  location                   = var.location
  resource_group_name        = module.network.resource_group_name
  log_analytics_workspace_id = module.monitoring.workspace_id
  infrastructure_subnet_id   = module.network.apps_subnet_id
  # No se puede cambiar después de crear el entorno; no cuesta nada extra.
  zone_redundancy_enabled = var.zone_redundant
  tags                    = var.tags
}

locals {
  app_env = merge({
    NODE_ENV               = "production"
    DB_HOST                = module.mysql.fqdn
    DB_PORT                = "3306"
    DB_NAME                = module.mysql.database_name
    DB_USER                = var.mysql_admin_login
    DB_SSL                 = "true"
    REDIS_HOST             = module.redis.hostname
    REDIS_PORT             = tostring(module.redis.ssl_port)
    REDIS_TLS              = "true"
    AZURE_KEYVAULT_ENABLED = "true"
    AZURE_KEYVAULT_URL     = module.keyvault.vault_uri

    # Client id de la managed identity, para que el cliente de Key Vault sepa
    # cuál usar (con identidad user-assigned hay que decirlo explícitamente).
    #
    # ⚠️ NOMBRE PROPIO, *NO* AZURE_CLIENT_ID. Esa variable ya tiene dueño en esta
    # app: es el client id del app registration de CSCS, que se usa en ~8 lugares
    # para pedir tokens contra login.microsoftonline.com/{AZURE_TENANT_ID}, en
    # src/lib/azure.ts y en requestAuth.ts.
    #
    # Pisarla con el id de la MSI rompe todo eso a la vez, y de dos formas:
    #   AADSTS7000232  MSI identity should not use ClientSecretCredential
    #                  (EnvironmentCredential arma id-de-MSI + secret del vault)
    #   AADSTS700016   Application '<msi>' was not found in directory '<tenant>'
    #                  (la MSI vive en el tenant de CSCS, no en el del cliente)
    # Verificado 2026-07-28: se probó y se revirtió.
    AZURE_KEYVAULT_MI_CLIENT_ID = azurerm_user_assigned_identity.app.client_id
    # La app conmuta a Blob sola cuando ve esta variable (azureBlobStorage.ts).
    AZURE_STORAGE_CONTAINER_SUPPORT_ATTACHMENTS = "support-attachments"
    AZURE_STORAGE_CONTAINER_LOGOS               = "tenant-logos"
    OTEL_SERVICE_NAME                           = "finops-web"
    OTEL_RESOURCE_ATTRIBUTES                    = "service.namespace=${var.data_region},deployment.environment=${var.environment}"
  }, var.extra_env_vars)

  app_secrets = {
    db-password                   = random_password.mysql.result
    redis-password                = module.redis.primary_access_key
    storage-connection-string     = module.storage.primary_connection_string
    appinsights-connection-string = module.monitoring.appinsights_connection_string
  }

  app_secret_env = {
    DB_PASSWORD                           = "db-password"
    REDIS_PASSWORD                        = "redis-password"
    AZURE_STORAGE_CONNECTION_STRING       = "storage-connection-string"
    APPLICATIONINSIGHTS_CONNECTION_STRING = "appinsights-connection-string"
  }
}

module "app" {
  source                          = "../containerapp"
  name_base                       = local.name_base
  resource_group_name             = module.network.resource_group_name
  environment_id                  = azurerm_container_app_environment.this.id
  identity_id                     = azurerm_user_assigned_identity.app.id
  registry_server                 = var.registry_server
  image_name                      = var.image_name
  image_tag                       = var.image_tag
  target_port                     = var.target_port
  cpu                             = var.web_cpu
  memory                          = var.web_memory
  min_replicas                    = var.web_min_replicas
  max_replicas                    = var.web_max_replicas
  concurrent_requests_per_replica = var.concurrent_requests_per_replica
  allowed_ip_ranges               = var.allowed_ip_ranges
  env_vars                        = local.app_env
  inline_secrets                  = local.app_secrets
  key_vault_secret_ids            = var.key_vault_secret_ids
  secret_env_vars                 = merge(local.app_secret_env, var.key_vault_secret_env)
  tags                            = var.tags
  depends_on                      = [time_sleep.acr_pull_propagation]
}

# Dominio propio. enabled=false por defecto — ver el comentario del módulo:
# la secuencia real tiene un paso de DNS afuera de Terraform en el medio.
module "custom_domain" {
  source                       = "../custom_domain"
  enabled                      = var.custom_domain_enabled
  domain_name                  = var.custom_domain_name
  container_app_id             = module.app.app_id
  container_app_environment_id = azurerm_container_app_environment.this.id
  tags                         = var.tags
}

# Los 14 procesos periódicos, con su schedule en código.
module "cronjobs" {
  source                = "../cronjobs"
  name_base             = local.name_base
  location              = var.location
  resource_group_name   = module.network.resource_group_name
  environment_id        = azurerm_container_app_environment.this.id
  identity_id           = azurerm_user_assigned_identity.app.id
  registry_server       = var.registry_server
  image_name            = var.image_name
  image_tag             = var.image_tag
  app_url               = module.app.internal_url
  cron_secret_id        = local.cron_secret_id
  jobs                  = var.cron_jobs
  timezone_offset_hours = var.cron_timezone_offset_hours
  action_group_id       = module.monitoring.action_group_id
  tags                  = var.tags
  depends_on            = [time_sleep.acr_pull_propagation]
}

# Migraciones: misma imagen, disparo manual desde el pipeline antes de
# actualizar la app. Reemplaza al `npm run migrate` por SSH.
resource "azurerm_container_app_job" "migrate" {
  # 32 caracteres máximo, igual que los cron jobs: la base con región de Azure
  # no entra. Se usa la base con la región lógica del stamp.
  name                         = "${local.name_base_short}-migrate"
  resource_group_name          = module.network.resource_group_name
  location                     = var.location
  container_app_environment_id = azurerm_container_app_environment.this.id
  replica_timeout_in_seconds   = 900
  replica_retry_limit          = 1
  tags                         = var.tags

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  registry {
    server   = var.registry_server
    identity = azurerm_user_assigned_identity.app.id
  }

  dynamic "secret" {
    for_each = local.app_secrets
    content {
      name  = secret.key
      value = secret.value
    }
  }

  template {
    container {
      name = "migrate"
      # migrate_image_tag, no image_tag: ver el comentario de esa variable.
      # La imagen de runtime no puede correr las migraciones.
      image   = "${var.registry_server}/${var.image_name}:${var.migrate_image_tag}"
      cpu     = 0.5
      memory  = "1Gi"
      command = ["npm", "run", "migrate"]

      dynamic "env" {
        for_each = local.app_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.app_secret_env
        content {
          name        = env.key
          secret_name = env.value
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [time_sleep.acr_pull_propagation]
}

# Auditoría: quién leyó qué secreto, qué pasó en la base y en el cache.
module "diagnostics" {
  source       = "../diagnostics"
  name_base    = local.name_base
  workspace_id = module.monitoring.workspace_id

  # Storage EXCLUIDO: Azure Storage Accounts no soportan category_group='allLogs'
  # a nivel de cuenta — solo en sub-servicios (blob/queue/file/table).
  # Error aprendido: 2026-07-28 → CategoryGroup 'allLogs' is not supported,
  # supported ones are: '' (400 Bad Request en prod westus2).
  targets = {
    keyvault = module.keyvault.id
    mysql    = module.mysql.id
  }

  # Redis va acá y no en targets: Managed Redis no publica ninguna categoría de
  # log, así que con 'allLogs' Azure devuelve el mismo 400 que el de Storage.
  # Verificado 2026-07-28 en prod westus2. Las métricas sí se recogen.
  metrics_only_targets = {
    redis = module.redis.id
  }
}

# Storage quedó afuera del módulo diagnostics de arriba porque 'allLogs' no
# corre a nivel de CUENTA (ver el comentario ahí) — pero sí corre apuntado al
# sub-servicio blob, que es donde viven los adjuntos de soporte, los logos de
# tenant y los backups. Sin esto no hay registro de quién leyó o borró un
# blob — la misma laguna que motivó el módulo diagnostics para el Key Vault.
resource "azurerm_monitor_diagnostic_setting" "storage_blob" {
  name                       = "${local.name_base}-storage-blob-diag"
  target_resource_id         = "${module.storage.id}/blobServices/default"
  log_analytics_workspace_id = module.monitoring.workspace_id

  enabled_log {
    category_group = "allLogs"
  }

  enabled_metric {
    category = "AllMetrics"
  }

  lifecycle {
    ignore_changes = [enabled_log, enabled_metric]
  }
}

module "budget" {
  source            = "../budget"
  name_base         = local.name_base
  resource_group_id = module.network.resource_group_id
  amount            = var.monthly_budget_amount
  start_date        = var.budget_start_date
  alert_email       = var.alert_email
}

module "security_policy" {
  source                = "../security_policy"
  name_base             = local.name_base
  resource_lock_enabled = var.resource_lock_enabled
  environment           = var.environment
  resource_group_name   = module.network.resource_group_name
  resource_group_id     = module.network.resource_group_id

  # Sólo lo que tiene datos. La VNet queda deliberadamente afuera: un lock ahí
  # impide crear y operar MySQL Flexible con VNet injection.
  locked_resource_ids = {
    mysql   = module.mysql.id
    storage = module.storage.id
  }

  container_app_id = module.app.app_id
  action_group_id  = module.monitoring.action_group_id
  tags             = var.tags
}
