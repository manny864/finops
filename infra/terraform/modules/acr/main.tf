resource "azurerm_container_registry" "this" {
  # Igual que Storage: sólo alfanumérico.
  name                = "${var.name_compact}cr"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = var.sku
  # Sin usuario admin: el pull va con managed identity, no con password.
  admin_enabled = false
  tags          = var.tags

  # La imagen pesa ~965 MB (PowerShell + módulos EXO/Teams). Basic da 10 GB:
  # entran ~10 tags. La retención automática sólo existe en Premium; en Basic
  # hay que purgar tags viejos desde el pipeline.
  retention_policy_in_days = var.sku == "Premium" ? 30 : null

  # Geo-replicación: baja el tiempo de pull del stamp europeo. Sólo Premium
  # (~USD 500/mes) — con Basic el stamp EU hace pull cross-region y tarda más
  # en el primer arranque de cada revisión, nada más.
  dynamic "georeplications" {
    for_each = var.sku == "Premium" ? toset(var.geo_replication_locations) : toset([])
    content {
      location                = georeplications.value
      zone_redundancy_enabled = false
    }
  }
}

# Purga diaria de las imágenes por commit (2026-10-05). Cada deploy sube dos
# (<sha> y <sha>-builder) y nadie las borraba: el 05/10 el registry de prod
# tenía 201 GB contra los 10 que incluye Basic, unos US$18/mes de excedente.
#
# Deja los 20 tags por commit más nuevos de cada repositorio (unos 10 deploys,
# para volver atrás con `az containerapp update --image`) y no toca latest,
# builder ni cron, que no matchean el filtro. --keep cuenta por repositorio y
# por fecha de modificación (learn.microsoft.com, "Purge tags and manifests").
# Es el mismo comando que se probó a mano con --dry-run antes de la purga del
# 05/10; el YAML sigue la referencia de ACR Tasks (alias `acr`, paso `cmd`).
resource "azurerm_container_registry_task" "purga" {
  name                  = "purga-imagenes-por-commit"
  container_registry_id = azurerm_container_registry.this.id

  platform {
    os = "Linux"
  }

  encoded_step {
    task_content = base64encode(<<-YAML
      version: v1.1.0
      steps:
        - cmd: acr purge --registry $RegistryName --filter '.*:^[0-9a-f]{40}(-builder)?$' --ago 0d --keep 20 --untagged
          disableWorkingDirectoryOverride: true
          timeout: 3600
    YAML
    )
  }

  timer_trigger {
    name     = "diaria"
    schedule = "0 5 * * *"
  }

  tags = var.tags
}
