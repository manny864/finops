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
  name                         = coalesce(var.certificate_name != "" ? var.certificate_name : null, replace(var.domain_name, ".", "-"))
  container_app_environment_id = var.container_app_environment_id
  subject_name                 = var.domain_name

  lifecycle {
    # El nombre lo asigna Azure al crear (portal o az cli) con un sufijo
    # de timestamp que Terraform no puede predecir — sólo importa.
    ignore_changes = [name]
  }

  # CNAME: Azure valida leyendo el CNAME del dominio (-> el hostname por
  # defecto del Container App) MÁS un TXT en asuid.<dominio> con el
  # customDomainVerificationId. Las dos cosas tienen que existir ANTES de este
  # apply — si no, Azure devuelve un error de validación acá mismo.
  domain_control_validation = "CNAME"

  tags = var.tags
}

resource "azurerm_container_app_custom_domain" "this" {
  count            = var.enabled ? 1 : 0
  name             = var.domain_name
  container_app_id = var.container_app_id
  # NO usar azurerm_container_app_environment_managed_certificate.this[0].id
  # directo: el provider guarda ese id con el segmento real de Azure
  # (.../managedCertificates/<nombre>), pero el atributo de ACÁ valida el id
  # contra el segmento "certificates" — dos parsers de ID distintos dentro
  # del mismo provider, desalineados entre sí. Con el id tal cual, hasta un
  # `terraform plan` revienta con un error duro de parseo, no un diff.
  # Verificado 2026-07-29, azurerm ~> 4.0.
  # Sin barras en el patrón: replace() trata un argumento delimitado por "/"
  # como regex, y "/managedCertificates/" calza justo con esa forma —
  # producía barras dobles en el resultado en vez de un reemplazo literal.
  container_app_environment_certificate_id = replace(
    azurerm_container_app_environment_managed_certificate.this[0].id,
    "managedCertificates", "certificates"
  )
  certificate_binding_type = "SniEnabled"

  lifecycle {
    # container_app_environment_certificate_id es de sólo-escritura: al
    # importar, Azure sólo devuelve su contraparte de sólo-lectura
    # (container_app_environment_managed_certificate_id), así que en
    # cualquier refresh este atributo vuelve a verse como "distinto" del que
    # puso el config, aunque apunten al mismo certificado. Y es ForceNew:
    # sin este ignore_changes, cada plan quiere destruir y recrear un
    # binding que YA está live y funcionando, sólo por prolijidad de estado.
    # No vale el riesgo de downtime / reprovisioning de certificado.
    ignore_changes = [container_app_environment_certificate_id]
  }
}
