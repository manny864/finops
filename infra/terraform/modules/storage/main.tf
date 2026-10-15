# Storage Account del stamp: reemplaza el volumen Docker `support_uploads` del
# VPS. El filesystem de un contenedor en Container Apps es efímero, así que los
# adjuntos de soporte y los logos de tenant no pueden quedarse en disco local.
#
# La app conmuta a Blob cuando isBlobStorageEnabled() (src/lib/azureBlobStorage.ts) ve
# AZURE_STORAGE_ACCOUNT_NAME: entra con la identidad administrada (Storage Blob Data Contributor)
# y no usa la clave de la cuenta, que está apagada (storage_shared_access_key_enabled = false).
# El fallback con AZURE_STORAGE_CONNECTION_STRING sólo existe para desarrollo local y Docker.
resource "azurerm_storage_account" "this" {
  # Storage Account: sólo minúsculas y números, máximo 24. De ahí la variante
  # compacta de la convención.
  name                            = "${var.name_compact}sa"
  resource_group_name             = var.resource_group_name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = var.replication_type
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  public_network_access_enabled   = true

  # Mientras blob_managed_identity_enabled esté apagado la app usa la connection string (clave
  # de cuenta). El código para pasar a identidad administrada ya existe (azureBlobStorage.ts, con
  # ManagedIdentityCredential y NO DefaultAzureCredential). Antes de apagar esto tienen que haber
  # migrado los tres clientes de la clave: la app, los backups (AzCopy, que sube con identidad
  # administrada desde el 2026-10-11) y el provider de Terraform (storage_use_azuread): ver
  # docs/security/endurecimiento-infraestructura-saas-2026-10-09.md.
  shared_access_key_enabled = var.shared_access_key_enabled

  # Una SAS emitida a mano y olvidada no vence sola. El límite es sobre la
  # validez máxima que Azure acepta al emitir una nueva SAS, no sobre las que
  # ya existen — no rompe la de db-backups del VPS descrita arriba.
  sas_policy {
    expiration_period = "01.00:00:00"
    expiration_action = "Log"
  }

  blob_properties {
    delete_retention_policy {
      days = 30
    }
    versioning_enabled = true
  }

  tags = var.tags
}

resource "azurerm_storage_container" "app" {
  # Los nombres tienen que coincidir con AZURE_STORAGE_CONTAINER_* de la app.
  for_each              = toset(["support-attachments", "tenant-logos", "finops-cost-exports"])
  name                  = each.key
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}

# Backups de MySQL. Hoy el VPS sube acá con una SAS de sólo escritura; con
# MySQL Flexible los backups son del servicio, así que este container queda
# para los dumps lógicos del runbook de restore.
resource "azurerm_storage_container" "backups" {
  name                  = "db-backups"
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}

# Retención: los adjuntos ya se borran a los 60 días por el cron de la app.
# Esta política es la red de seguridad para lo que quede huérfano y para
# abaratar los backups viejos.
resource "azurerm_storage_management_policy" "lifecycle" {
  storage_account_id = azurerm_storage_account.this.id

  # Una regla por clase de backup, con prefijos que NO se solapan.
  #
  # Antes habia una sola regla con prefix_match = ["db-backups/"], o sea el
  # container entero: borraba a los 35 dias sin distinguir daily de monthly ni
  # de yearly, asi que la jerarquia que escribe el runbook no servia de nada
  # --un backup "yearly" vivia 35 dias--. No se deja una regla catch-all sobre
  # "db-backups/" porque se solaparia con estas tres y la retencion efectiva
  # quedaria ambigua; la contra es que un blob fuera de estos tres prefijos no
  # lo administra nadie.
  dynamic "rule" {
    for_each = {
      daily   = var.backup_retention_days
      monthly = var.backup_monthly_retention_days
      yearly  = var.backup_yearly_retention_days
    }

    content {
      name    = "backups-${rule.key}-cool-then-delete"
      enabled = true

      filters {
        prefix_match = ["db-backups/${var.backup_database_name}/${rule.key}/"]
        blob_types   = ["blockBlob"]
      }

      actions {
        base_blob {
          tier_to_cool_after_days_since_modification_greater_than = 7
          delete_after_days_since_modification_greater_than       = rule.value
        }
        version {
          delete_after_days_since_creation = 7
        }
      }
    }

  }

  dynamic "rule" {
    for_each = var.flow_logs_retention_prefix == null ? {} : { flow_logs = var.flow_logs_retention_prefix }

    content {
      name    = "flowlogs-retention-7d"
      enabled = true

      filters {
        prefix_match = [rule.value]
        blob_types   = ["blockBlob"]
      }

      actions {
        base_blob {
          delete_after_days_since_modification_greater_than = 7
        }
      }
    }
  }
}

# AISEC-09: lectura condicionada al veredicto antimalware. Defender for Storage escribe la etiqueta
# de índice "Malware Scanning scan result" en cada blob subido; para los containers listados, la app
# sólo puede leer (no listar) blobs con "No threats found": los pendientes y los maliciosos quedan en
# cuarentena (Blob responde 403 y la app lo traduce a 409). Patrón documentado por Microsoft
# ("prevent access to unscanned or malicious files with ABAC").
# Ojo: condition es ForceNew. Activarlo reemplaza la asignación y la app queda unos segundos sin
# acceso a Blob durante el apply; los blobs subidos antes de activar el escaneo no tienen etiqueta y
# quedan ilegibles hasta que el cron de retención (60 días) los borre.
locals {
  clean_scan_container_clause = join(" AND ", [
    for c in var.require_clean_scan_containers :
    "@Resource[Microsoft.Storage/storageAccounts/blobServices/containers:name] StringNotEquals '${c}'"
  ])
  app_blob_read_condition = length(var.require_clean_scan_containers) == 0 ? null : trimspace(<<-COND
    (
     (
      !(ActionMatches{'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'} AND NOT SubOperationMatches{'Blob.List'})
     )
     OR
     (
      ${local.clean_scan_container_clause}
     )
     OR
     (
      @Resource[Microsoft.Storage/storageAccounts/blobServices/containers/blobs/tags:Malware Scanning scan result<$key_case_sensitive$>] StringEquals 'No threats found'
     )
    )
  COND
  )
}

resource "azurerm_role_assignment" "app_blob_contributor" {
  scope                = azurerm_storage_account.this.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = var.app_principal_id
  condition            = local.app_blob_read_condition
  condition_version    = local.app_blob_read_condition == null ? null : "2.0"
}
