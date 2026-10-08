# Cuenta de Azure AI services alcanzable sólo por private endpoint, con la
# identidad de la app como credencial (Entra ID, src/lib/azureAiCredential.ts).
# La usan la IA de plataforma (kind AIServices, con un deployment de chat) y
# Document Intelligence (kind FormRecognizer, sin deployment).
#
# Va por stamp: los prompts y los documentos llevan datos de los tenants y la
# cuenta sigue la residencia del stamp. Puede estar en otra región que el stamp
# (ai_services_location en modules/stamp) porque el private endpoint se queda
# en la VNet del stamp: Private Link admite el endpoint en otra región que el
# recurso.
resource "azurerm_cognitive_account" "this" {
  name                = var.name
  location            = var.location
  resource_group_name = var.resource_group_name
  kind                = var.kind
  sku_name            = "S0"
  # Sin subdominio propio no hay Entra ID ni private endpoint: los dos
  # funcionan sólo contra <subdominio>.cognitiveservices.azure.com (y, en
  # AIServices, sus pares de openai.azure.com y services.ai.azure.com), no
  # contra el endpoint regional compartido.
  custom_subdomain_name         = var.name
  public_network_access_enabled = false
  local_auth_enabled            = var.local_auth_enabled
  tags                          = var.tags

  # Nadie la usa todavía: la pide Checkov (CKV_AZURE_238), no cuesta y es la
  # que usaría una customer-managed key.
  identity {
    type = "SystemAssigned"
  }
}

# El deployment se llama como el modelo a propósito: @ai-sdk/azure decide por
# el prefijo del id (gpt-5*) si es un modelo de razonamiento, y el id que
# recibe es el nombre del deployment. Con otro nombre manda max_tokens y
# temperature, que un modelo de razonamiento rechaza.
resource "azurerm_cognitive_deployment" "chat" {
  count                = var.chat_model_name == null ? 0 : 1
  name                 = var.chat_model_name
  cognitive_account_id = azurerm_cognitive_account.this.id
  # La versión queda fijada: Azure la cambia sólo al retirarse, y ese cambio
  # aparece en el drift check de los lunes. Ver chat_model_version.
  version_upgrade_option = "OnceCurrentVersionExpired"

  model {
    format  = "OpenAI"
    name    = var.chat_model_name
    version = var.chat_model_version
  }

  sku {
    name     = var.deployment_sku
    capacity = var.deployment_capacity
  }
}

resource "azurerm_private_endpoint" "this" {
  name                = "${var.name_base}-${var.short_name}-pe"
  location            = var.private_endpoint_location
  resource_group_name = var.resource_group_name
  subnet_id           = var.subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "psc-${var.short_name}"
    private_connection_resource_id = azurerm_cognitive_account.this.id
    subresource_names              = ["account"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = var.private_dns_zone_ids
  }
}

resource "azurerm_role_assignment" "app" {
  scope                = azurerm_cognitive_account.this.id
  role_definition_name = var.role_definition_name
  principal_id         = var.app_principal_id
}

module "diagnostics" {
  source             = "../diagnostics"
  name_base          = var.name_base
  workspace_id       = var.workspace_id
  log_category_group = "audit"
  targets = {
    (var.short_name) = azurerm_cognitive_account.this.id
  }
}

# Azure rechaza un start_date pasado fuera del mes en curso, y el
# budget_start_date del stamp ya quedó atrás: el presupuesto arranca el día 1
# del mes del primer apply y queda fijo en el state (timestamp() cambiaría en
# cada plan).
resource "time_static" "budget_start" {}

module "budget" {
  source            = "../budget"
  name_base         = "${var.name_base}-${var.short_name}"
  resource_group_id = var.resource_group_id
  amount            = var.monthly_budget_amount
  start_date        = formatdate("YYYY-MM-01'T'00:00:00'Z'", time_static.budget_start.rfc3339)
  alert_email       = var.alert_email
  resource_ids      = [lower(azurerm_cognitive_account.this.id)]
}
