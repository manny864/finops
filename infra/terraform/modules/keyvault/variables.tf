variable "name_base_short" {
  description = "Base SIN región: el Key Vault tiene un límite de 24 caracteres."
  type        = string

  validation {
    condition     = length("${var.name_base_short}-kv") <= 24
    error_message = "El nombre del Key Vault supera los 24 caracteres que permite Azure."
  }
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "tenant_id" {
  type = string
}

variable "create" {
  description = "false = usar el Key Vault existente del proyecto."
  type        = bool
  default     = false
}

variable "existing_vault_name" {
  type    = string
  default = ""
}

variable "existing_vault_resource_group" {
  type    = string
  default = ""
}

variable "private_endpoint_enabled" {
  type    = bool
  default = false
}

variable "subnet_id" {
  type    = string
  default = null
}

variable "private_dns_zone_id" {
  type    = string
  default = null
}

variable "app_principal_id" {
  description = "principalId de la managed identity de la app."
  type        = string
}

variable "tags" {
  type = map(string)
}

# ── Firewall del vault (opción 4 de docs/keyvault-network-hardening.md) ─────
#
# Cerrar el acceso público del todo (private_endpoint_enabled sin esto) deja
# fuera a los runners de GitHub, y Terraform gestiona dos secretos en el PLANO
# DE DATOS del vault: el drift de los lunes y el apply empiezan a fallar.
#
# Con el firewall activo el vault queda en default_action = Deny —cerrado a
# internet— pero el pipeline puede agregarse a la allowlist por la duración
# del plan/apply y sacarse después. La app entra por el private endpoint, que
# no está sujeto a estas reglas.
variable "network_acls_enabled" {
  description = "Activa el firewall del vault (default_action = Deny). Requiere que el pipeline abra su IP; ver infra/docs/keyvault-network-hardening.md."
  type        = bool
  default     = false
}

# IPs o CIDRs permanentes (oficina, VPN). La IP efímera del runner NO va acá:
# la agrega y la quita el workflow, y `lifecycle` la ignora para que Terraform
# no se cierre la puerta a sí mismo en mitad del apply.
variable "allowed_ip_rules" {
  description = "IPs/CIDRs con acceso permanente al vault cuando network_acls_enabled = true."
  type        = list(string)
  default     = []
}
