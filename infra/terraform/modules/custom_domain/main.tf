# Dominio propio sobre Container Apps.
#
# La secuencia NO es "aplicar y listo": Azure valida ownership contra DNS
# ANTES de emitir el certificado, así que hace falta un paso manual afuera de
# Terraform en el medio. Ver dns_setup_instructions en el output del
# environment para el runbook completo.
#
# Con enabled=false (default) este módulo no crea nada — sirve para leer el
# output con las instrucciones de DNS sin haber tocado el dominio todavía.

resource "azurerm_container_app_environment_managed_certificate" "this" {
  count                        = var.enabled ? 1 : 0
  name                         = replace(var.domain_name, ".", "-")
  container_app_environment_id = var.container_app_environment_id
  subject_name                 = var.domain_name

  # CNAME: Azure valida leyendo el CNAME del dominio (-> el hostname por
  # defecto del Container App) MÁS un TXT en asuid.<dominio> con el
  # customDomainVerificationId. Las dos cosas tienen que existir ANTES de este
  # apply — si no, Azure devuelve un error de validación acá mismo.
  domain_control_validation = "CNAME"

  tags = var.tags
}

resource "azurerm_container_app_custom_domain" "this" {
  count                                    = var.enabled ? 1 : 0
  name                                     = var.domain_name
  container_app_id                         = var.container_app_id
  container_app_environment_certificate_id = azurerm_container_app_environment_managed_certificate.this[0].id
  certificate_binding_type                 = "SniEnabled"
}
