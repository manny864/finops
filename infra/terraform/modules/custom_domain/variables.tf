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
