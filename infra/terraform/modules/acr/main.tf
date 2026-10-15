resource "azurerm_container_registry" "this" {
  # checkov:skip=CKV_AZURE_237:owner=CloudOps; expires=2027-01-15; Dedicated data endpoints require Premium; Basic registry uses Entra identities and admin is disabled.
  # checkov:skip=CKV_AZURE_233:owner=CloudOps; expires=2027-01-15; Zone redundancy requires Premium; single-region Basic accepted.
  # checkov:skip=CKV_AZURE_164:owner=CloudOps; expires=2027-01-15; Content trust requires Premium; SHA-tag promotion gates remain, immutable artifacts pending INFRA-11.
  # checkov:skip=CKV_AZURE_165:owner=CloudOps; expires=2027-01-15; Geo-replication requires Premium; single-region Basic accepted.
  # checkov:skip=CKV_AZURE_166:owner=CloudOps; expires=2027-01-15; Quarantine policy requires Premium; Defender Containers scans images without SKU upgrade.
  # checkov:skip=CKV_AZURE_163:owner=CloudOps; expires=2027-01-15; Legacy SKU-based check; Defender Containers enabled by module.defender covers Basic registry.
  # checkov:skip=CKV_AZURE_139:owner=CloudOps; expires=2027-01-15; Private networking requires Premium; Basic public endpoint restricted by Entra RBAC, no admin credentials.
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

  # Geo-replicación: baja el tiempo de pull del stamp europeo. Sólo Premium:
  # ~USD 50/mes del registry unit más ~USD 50/mes por cada región replicada
  # (Retail Prices API, West US 2, 2026-10-10; Basic ronda ~USD 5/mes) — con
  # Basic el stamp EU hace pull cross-region y tarda más en el primer arranque
  # de cada revisión, nada más.
  dynamic "georeplications" {
    for_each = var.sku == "Premium" ? toset(var.geo_replication_locations) : toset([])
    content {
      location                = georeplications.value
      zone_redundancy_enabled = false
    }
  }
}
