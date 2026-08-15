# Storage Account del stamp: reemplaza el volumen Docker `support_uploads` del
# VPS. El filesystem de un contenedor en Container Apps es efímero, así que los
# adjuntos de soporte y los logos de tenant no pueden quedarse en disco local.
#
# No hace falta cambiar código: src/lib/supportAttachments.ts y
# src/lib/tenantLogo.ts ya conmutan a Blob cuando isBlobStorageEnabled()
# (src/lib/azureBlobStorage.ts) ve AZURE_STORAGE_CONNECTION_STRING. Lo único
# pendiente es copiar los archivos que hoy están en data/.
resource "azurerm_storage_account" "this" {
  # Storage Account: sólo minúsculas y números, máximo 24. De ahí la variante
  # compacta de la convención.
  name                            = "${var.name_compact}sa"
  resource_group_name             = var.resource_group_name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = var.replication_type
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  public_network_access_enabled   = true

  # La app usa connection string (clave de cuenta) porque así está escrito
  # azureBlobStorage.ts. Para poder apagar esto hace falta migrarlo a
  # DefaultAzureCredential — ver infra/docs/pendientes-de-app.md.
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

  rule {
    name    = "backups-cool-then-delete"
    enabled = true

    filters {
      prefix_match = ["db-backups/"]
      blob_types   = ["blockBlob"]
    }

    actions {
      base_blob {
        tier_to_cool_after_days_since_modification_greater_than = 7
        delete_after_days_since_modification_greater_than       = var.backup_retention_days
      }
      version {
        delete_after_days_since_creation = 7
      }
    }
  }
}

resource "azurerm_role_assignment" "app_blob_contributor" {
  scope                = azurerm_storage_account.this.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = var.app_principal_id
}
