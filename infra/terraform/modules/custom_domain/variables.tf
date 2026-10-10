variable "enabled" {
  description = <<-DESC
    Apagado por defecto. La validación de dominio de Azure exige que el CNAME
    y el TXT ya resuelvan ANTES de aplicar — con enabled=true y el DNS todavía
    sin propagar, el apply se cae con un error de validación de Azure, no de
    Terraform. Ver el runbook en la salida `dns_setup_instructions` del
    environment: primero se cargan los registros en Cloudflare (DNS-only, sin
    proxy), después se prende esto.
  DESC
  type        = bool
  default     = false
}

variable "container_app_id" {
  type = string
}

variable "container_app_environment_id" {
  type = string
}

variable "domain_name" {
  description = "FQDN completo, ej. finops.cscloudsolutions.com.ar"
  type        = string
}

variable "certificate_name" {
  description = <<-DESC
    Nombre del recurso managed certificate. Si se crea por primera vez desde
    Terraform, cualquier nombre válido sirve (Azure lo acepta tal cual). Si se
    va a importar uno creado a mano (portal/az cli), usar el nombre real que
    Azure le asignó — suele traer un sufijo de timestamp que no se puede
    predecir de antemano.
  DESC
  type        = string
  default     = ""
}

variable "tags" {
  type = map(string)
}

variable "certificate_source" {
  description = <<-DESC
    managed (default): certificado gestionado de Azure, validado por CNAME.
    byo_staged: crea el certificado propio y mantiene el gestionado (el dominio sigue con el gestionado).
    byo: certificado propio y nada más (borra el gestionado: sólo después de asociar el propio al hostname).
    El propio sale de dos secretos de Key Vault; ver el encabezado de main.tf y "Cerrar el origen" en docs/security/.
  DESC
  type        = string
  default     = "managed"

  validation {
    condition     = contains(["managed", "byo_staged", "byo"], var.certificate_source)
    error_message = "certificate_source es \"managed\", \"byo_staged\" o \"byo\"."
  }
}

variable "byo_certificate_name" {
  description = "Nombre del certificado propio en el entorno. Vacío = <dominio con guiones>-byo. Para rotar el certificado, un nombre nuevo."
  type        = string
  default     = ""
}

variable "key_vault_id" {
  description = "Key Vault donde viven los secretos del certificado propio. Sólo se usa con certificate_source = byo."
  type        = string
  default     = null
}

variable "byo_pfx_secret_name" {
  description = "Secreto con el .pfx en base64 (az keyvault secret set --encoding base64 --file origen.pfx)."
  type        = string
  default     = "origin-cert-pfx"
}

variable "byo_password_secret_name" {
  description = "Secreto con la contraseña del .pfx."
  type        = string
  default     = "origin-cert-pfx-password"
}

