# Microsoft Defender for Cloud. Es de alcance SUSCRIPCIÓN, no de resource
# group: por eso vive en la capa global y se prende en un solo ambiente.
#
# Antes lo descartamos por costo. Con el crédito de Azure deja de ser objeción,
# y además cuenta como workload para los hitos de Microsoft for Startups.
# Azure le asigna un subplan por defecto a algunos planes. Si Terraform no lo
# declara, lo ve como null y marca "forces replacement": TODO apply destruía y
# recreaba estos planes de seguridad a nivel suscripción.
# Valores verificados 2026-07-28 contra la API (Microsoft.Security/pricings).
# Los tipos que no figuran acá devuelven subPlan vacío y van con null.
locals {
  default_subplans = {
    Arm             = "PerSubscription"
    KeyVaults       = "PerKeyVault"
    StorageAccounts = "DefenderForStorageV2"
  }
}

resource "azurerm_security_center_subscription_pricing" "this" {
  for_each      = var.enabled ? toset(var.resource_types) : toset([])
  tier          = "Standard"
  resource_type = each.value
  subplan       = lookup(local.default_subplans, each.value, null)
}

# Manda las alertas de Defender al mismo action group que el resto: si no
# llegan a un mail que alguien lee, no sirven de nada.
resource "azurerm_security_center_contact" "this" {
  count               = var.enabled ? 1 : 0
  name                = "default"
  email               = var.alert_email
  alert_notifications = true
  alerts_to_admins    = true
}
