# Auditoría continua del plano de control y de la configuración. Los dos bloques
# vienen apagados (activity_alerts_enabled / policy_audit_enabled = false): apagado
# no crea nada, y encendido no bloquea ni cambia ningún recurso existente. Sólo avisa
# y mide, sin costo (no hay medidor facturable de reglas de Activity Log ni de Azure
# Policy en modo auditoría en la Retail Prices API).

# ---------------------------------------------------------------------------
# Alertas de Activity Log: cambios de privilegio y borrado de recursos con datos.
# ---------------------------------------------------------------------------
#
# Sin esto un cambio de privilegios (alguien se asigna Owner) o el borrado de un lock
# no le avisa a nadie: hoy la única alerta de Activity Log de la suscripción es la de
# Service Health. Los nombres de operación se verificaron el 2026-10-10 contra la API
# de operaciones de proveedor (`az provider operation show`); un nombre equivocado no
# da error, la alerta simplemente nunca salta.
#
# Alcance: la SUSCRIPCIÓN, porque el principal de Terraform puede asignar roles en toda
# ella. Por eso se enciende en UN solo stamp (security_activity_alerts_enabled en el
# mapa `stamps`): dos stamps con el flag duplicarían cada aviso.
#
# Sólo status Succeeded: cada operación deja varias entradas (Started, Accepted,
# Succeeded) y sin el filtro llegarían tres mails por evento. NO se alerta sobre
# Microsoft.KeyVault/vaults/write a propósito: el workflow de Terraform abre y cierra
# la IP del runner en el firewall del vault en cada plan, apply y drift, y esa alerta
# sonaría varias veces por semana hasta que nadie la lea.
data "azurerm_subscription" "current" {}

locals {
  activity_alert_operations = {
    role-assignment-write  = "Microsoft.Authorization/roleAssignments/write"
    role-assignment-delete = "Microsoft.Authorization/roleAssignments/delete"
    role-definition-write  = "Microsoft.Authorization/roleDefinitions/write"
    lock-delete            = "Microsoft.Authorization/locks/delete"
    keyvault-delete        = "Microsoft.KeyVault/vaults/delete"
    mysql-delete           = "Microsoft.DBforMySQL/flexibleServers/delete"
    storage-delete         = "Microsoft.Storage/storageAccounts/delete"
  }
}

resource "azurerm_monitor_activity_log_alert" "audit" {
  for_each = var.activity_alerts_enabled && var.action_group_id != null ? local.activity_alert_operations : {}

  name                = "${var.name_base}-audit-${each.key}"
  resource_group_name = var.resource_group_name
  location            = "global"
  scopes              = [data.azurerm_subscription.current.id]
  description         = "Activity Log: ${each.value} terminó con éxito."

  criteria {
    category       = "Administrative"
    operation_name = each.value
    status         = "Succeeded"
  }

  action {
    action_group_id = var.action_group_id
  }

  tags = var.tags
}

# ---------------------------------------------------------------------------
# Azure Policy en modo auditoría (enforce = false) sobre el resource group del stamp.
# ---------------------------------------------------------------------------
#
# `enforce = false` es enforcementMode DoNotEnforce: la política se evalúa y el
# cumplimiento aparece en el portal y en `az policy state summarize`, pero no deniega
# ni modifica nada. Es el paso "Audit con alcance acotado" antes de pensar en Deny.
# Todas son definiciones integradas cuyo efecto por defecto es Audit o
# AuditIfNotExists; los GUID y nombres se verificaron el 2026-10-10 con
# `az policy definition list`.
#
# Quedan afuera a propósito: el ACR (vive en el resource group global, no en el del
# stamp) y Redis (las definiciones integradas son de Azure Cache for Redis clásico,
# Microsoft.Cache/Redis, no de Azure Managed Redis, que es redisEnterprise).
locals {
  policy_audit_definitions = {
    storage-red-restringida = "34c877ad-507e-4c82-993e-3452a6e0ad3c" # Storage accounts should restrict network access
    storage-sin-shared-key  = "8c6a50c6-9ffd-4ae7-986f-5fa6111f9a54" # Storage accounts should prevent shared key access
    storage-solo-https      = "404c3081-a854-4457-ae30-26a93ef643f9" # Secure transfer to storage accounts should be enabled
    storage-sin-acceso-anon = "4fa4b6c0-31ca-4c0d-b10d-24b96f62a751" # Storage account public access should be disallowed
    keyvault-purge          = "0b60c0b2-2dc2-4e1c-b5c9-abbed971de53" # Key vaults should have deletion protection enabled
    keyvault-firewall       = "55615ac9-af46-4a59-874e-391cc3dfb490" # Azure Key Vault should have firewall enabled or public network access disabled
    keyvault-rbac           = "12d4fa5e-1f9f-4c21-97a9-b99b3c6611b5" # Azure Key Vault should use RBAC permission model
    keyvault-logs           = "cf820ca0-f99e-4f3e-84fb-66e913812d21" # Resource logs in Key Vault should be enabled
    mysql-red-privada       = "c9299215-ae47-4f50-9c54-8a392f68a052" # Public network access should be disabled for MySQL flexible servers
    containerapp-https      = "0e80e269-43a4-4ae9-b5bc-178126b8a5cb" # Container Apps should only be accessible over HTTPS
  }
}

resource "azurerm_resource_group_policy_assignment" "audit" {
  for_each = var.policy_audit_enabled ? local.policy_audit_definitions : {}

  name                 = "${var.name_base}-aud-${each.key}"
  resource_group_id    = var.resource_group_id
  policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/${each.value}"
  display_name         = "Auditoría ${each.key} (${var.name_base})"
  description          = "Modo auditoría (enforce = false): mide cumplimiento, no bloquea."
  enforce              = false
}
