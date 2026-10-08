variable "name" {
  description = "Nombre de la cuenta y de su subdominio. Lleva la región de la cuenta, que puede no ser la del stamp."
  type        = string
}

variable "short_name" {
  description = "Sufijo de los nombres con la base del stamp (private endpoint, diagnóstico y presupuesto): ai, di."
  type        = string
  default     = "ai"
}

variable "kind" {
  description = "AIServices (IA de plataforma) o FormRecognizer (Document Intelligence)."
  type        = string
  default     = "AIServices"
}

variable "name_base" {
  description = "Base de nombres del stamp: private endpoint, diagnóstico y presupuesto."
  type        = string
}

variable "location" {
  description = "Región de la cuenta. Ver ai_services_location en modules/stamp."
  type        = string
}

variable "private_endpoint_location" {
  description = "Región de la VNet del stamp: el private endpoint va ahí aunque la cuenta esté en otra."
  type        = string
}

variable "resource_group_name" {
  type = string
}

variable "resource_group_id" {
  type = string
}

variable "local_auth_enabled" {
  description = <<-DESC
    Keys de la cuenta. true es el paso 1 de la transición: la app usa Entra
    ID y la key queda de fallback. El paso 2, validado en prod, la pone en
    false (sólo Entra ID) y se sacan las keys de GlobalSettings y del
    entorno. Ese día sale CKV_AZURE_236 de la lista de Checkov del workflow.
  DESC
  type        = bool
  default     = true
}

# Modelo por defecto, verificado el 2026-10-08:
#  - West US 2 no ofrece ningún modelo de Azure OpenAI (no figura en ninguna
#    tabla de disponibilidad, para ningún tipo de deployment): el stamp us
#    lleva ai_services_location = "westus3".
#  - gpt-5.4-mini 2026-03-17 es el "mini" GA más nuevo y se retira el
#    2027-09-21. gpt-5-mini se retira antes (2027-02-09) y gpt-4.1-mini y
#    gpt-4o-mini ya están deprecados (2027-04-14).
#  - DataZoneStandard y no GlobalStandard: Global puede procesar el pedido en
#    cualquier región del mundo y el trust center declara el procesamiento en
#    Estados Unidos. Data Zone lo deja dentro de la zona de EE. UU.
# https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability
# https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirement-schedule
# https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types
variable "chat_model_name" {
  description = "Modelo y, a la vez, nombre del deployment (ver main.tf). null: sin deployment, como Document Intelligence."
  type        = string
  default     = "gpt-5.4-mini"
}

variable "chat_model_version" {
  description = "Fijada: sin upgrades sorpresa. Subirla antes de la fecha de retiro."
  type        = string
  default     = "2026-03-17"
}

variable "deployment_sku" {
  description = "GlobalStandard, DataZoneStandard o Standard. Decide dónde se procesa el pedido (residencia)."
  type        = string
  default     = "DataZoneStandard"
}

variable "deployment_capacity" {
  description = "Miles de tokens por minuto (TPM). Es el tope duro de throughput y del gasto por minuto; consume cuota de la suscripción en la región."
  type        = number
  default     = 100
}

variable "subnet_id" {
  description = "Subnet de private endpoints del stamp (modules/network)."
  type        = string
}

variable "private_dns_zone_ids" {
  description = "Zonas de modules/private_dns: cognitiveservices, openai y services.ai para AIServices; a FormRecognizer le alcanza cognitiveservices."
  type        = list(string)
}

variable "app_principal_id" {
  description = "Identidad de la app (azurerm_user_assigned_identity.app del stamp)."
  type        = string
}

variable "role_definition_name" {
  description = <<-DESC
    Rol de la app sobre la cuenta. Cognitive Services OpenAI User: inferencia
    sí; gestionar la cuenta o leer las keys, no. Document Intelligence pide
    Cognitive Services User, que además lista las keys: con
    local_auth_enabled = false no sirven de nada.
  DESC
  type        = string
  default     = "Cognitive Services OpenAI User"
}

variable "workspace_id" {
  type = string
}

variable "alert_email" {
  type = string
}

variable "monthly_budget_amount" {
  type    = number
  default = 50
}

variable "tags" {
  type = map(string)
}
