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
    # Ejecutar código en una VM sin entrar por la red, publicar un runbook (la VM de backups ejecuta lo
    # publicado como SYSTEM), abrir una regla de NSG y rotar las claves de Storage. Nombres verificados el
    # 2026-10-12 con `az provider operation show`. La rotación de claves va a sonar cuando se rote la
    # clave filtrada de Storage (C-01): es lo esperado.
    vm-run-command    = "Microsoft.Compute/virtualMachines/runCommand/action"
    runbook-publish   = "Microsoft.Automation/automationAccounts/runbooks/publish/action"
    nsg-rule-write    = "Microsoft.Network/networkSecurityGroups/securityRules/write"
    storage-key-regen = "Microsoft.Storage/storageAccounts/regeneratekey/action"
  }
}

resource "azurerm_monitor_activity_log_alert" "audit" {
  # El for_each NO puede depender de action_group_id: en un ambiente nuevo ese id no existe hasta
  # el apply, y Terraform no puede decidir las claves del mapa ("Invalid for_each argument", visto
  # en el primer plan de staging, 2026-10-12; en prod el action group ya está en el state y nunca
  # falló). Mismo motivo por el que el resto del módulo usa un flag y no el id. Si falta el action
  # group con el flag encendido, la precondición de abajo lo dice en voz alta en vez de no crear
  # nada en silencio.
  for_each = var.activity_alerts_enabled ? local.activity_alert_operations : {}

  lifecycle {
    precondition {
      condition     = var.action_group_id != null
      error_message = "activity_alerts_enabled = true exige action_group_id: las alertas de Activity Log necesitan a quién avisar."
    }
  }

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

# ---------------------------------------------------------------------------
# Exportación del Activity Log al workspace (hallazgo H-05 de la auditoría del 2026-10-11).
# ---------------------------------------------------------------------------
#
# Sin esto el Activity Log sólo vive 90 días en Azure y no se puede cruzar con los logs del Key Vault, de
# Storage y de MySQL: investigar una credencial filtrada o una asignación de Owner queda con ese horizonte.
# Las cuatro categorías son las de seguridad: Administrative (escrituras, borrados y acciones, incluidos
# los cambios de RBAC), Security (alertas de Defender), Policy y Alert. No se exportan Recommendation,
# Autoscale ni ResourceHealth: ruido sin valor de seguridad. Nombres verificados con la ayuda de
# `az monitor diagnostic-settings subscription create`. Exportar el Activity Log no cobra ingesta.
resource "azurerm_monitor_diagnostic_setting" "activity_log" {
  count = var.activity_log_export_enabled ? 1 : 0

  name                       = "${var.name_base}-activity-log"
  target_resource_id         = data.azurerm_subscription.current.id
  log_analytics_workspace_id = var.workspace_id

  enabled_log {
    category = "Administrative"
  }
  enabled_log {
    category = "Security"
  }
  enabled_log {
    category = "Policy"
  }
  enabled_log {
    category = "Alert"
  }

  lifecycle {
    precondition {
      condition     = var.workspace_id != null
      error_message = "activity_log_export_enabled = true exige workspace_id: el Activity Log necesita un destino."
    }
  }
}
