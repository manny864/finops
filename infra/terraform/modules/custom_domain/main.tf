# Dominio propio sobre Container Apps.
#
# La secuencia NO es "aplicar y listo": Azure valida ownership contra DNS
# ANTES de emitir el certificado, así que hace falta un paso manual afuera de
# Terraform en el medio. Ver dns_setup_instructions en el output del
# environment para el runbook completo.
#
# Con enabled=false (default) este módulo no crea nada — sirve para leer el
# output con las instrucciones de DNS sin haber tocado el dominio todavía.
#
# TRES VALORES DE certificate_source:
#
#  - "managed" (default): certificado gestionado de Azure, validado por CNAME. Exige que
#    el dominio apunte DIRECTO al app y que las IP de DigiCert lleguen al ingress.
#    Microsoft documenta que un CNAME intermedio (cita a Cloudflare) impide la emisión y
#    la renovación, y un filtro de IP en el ingress también.
#  - "byo_staged": crea el certificado propio en el entorno y MANTIENE el gestionado. Es el
#    paso intermedio: el dominio sigue con el gestionado hasta que una persona lo asocia al
#    propio. Existe para no encadenar en un mismo apply "crear el nuevo" y "borrar el viejo
#    mientras todavía está en uso", que Azure rechaza.
#  - "byo": certificado propio y nada más, por ejemplo un Origin CA de Cloudflare (hasta 15
#    años, modo SSL "Full (strict)"). No depende de DigiCert ni del CNAME, y es el que
#    permite restringir el origen a Cloudflare. Borra el certificado gestionado.
#
# El .pfx y su contraseña salen de DOS secretos de Key Vault que carga una persona (la clave
# privada nunca pasa por Terraform ni por el repositorio): ver "Cerrar el origen" en
# docs/security/.
#
# CAMBIAR DE CERTIFICADO NO LO HACE TERRAFORM. El binding del dominio ignora
# container_app_environment_certificate_id (ver el lifecycle de abajo: es ForceNew y de
# sólo escritura, y recrearlo con el dominio en producción es downtime). La secuencia es:
# byo_staged (Terraform crea el propio), `az containerapp hostname bind --certificate`
# (una persona lo asocia), y recién entonces byo (Terraform borra el gestionado, que Azure
# no deja borrar mientras esté en uso).
locals {
  use_byo = var.enabled && var.certificate_source != "managed"
  # Sin nombre explícito: el del dominio con guiones. Para rotar el certificado hay que
  # dar un nombre NUEVO (byo_certificate_name): el recurso ignora cambios de contenido.
  byo_certificate_name = coalesce(var.byo_certificate_name != "" ? var.byo_certificate_name : null, "${replace(var.domain_name, ".", "-")}-byo")
}

# Los dos secretos los carga una persona antes de encender el modo byo. Si faltan, el
# plan falla con "secret not found": eso es lo esperado.
data "azurerm_key_vault_secret" "byo_pfx" {
  count        = local.use_byo ? 1 : 0
  name         = var.byo_pfx_secret_name
  key_vault_id = var.key_vault_id
}

data "azurerm_key_vault_secret" "byo_password" {
  count        = local.use_byo ? 1 : 0
  name         = var.byo_password_secret_name
  key_vault_id = var.key_vault_id
}

resource "azurerm_container_app_environment_certificate" "byo" {
  count                        = local.use_byo ? 1 : 0
  name                         = local.byo_certificate_name
  container_app_environment_id = var.container_app_environment_id
  certificate_blob_base64      = data.azurerm_key_vault_secret.byo_pfx[0].value
  certificate_password         = data.azurerm_key_vault_secret.byo_password[0].value
  tags                         = var.tags

  lifecycle {
    # El contenido no se puede releer de Azure y un cambio acá fuerza reemplazo, que
    # falla mientras el certificado esté asociado a un hostname. Rotar = nombre nuevo.
    ignore_changes = [certificate_blob_base64, certificate_password]
  }
}

resource "azurerm_container_app_environment_managed_certificate" "this" {
  count                        = var.enabled && var.certificate_source != "byo" ? 1 : 0
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
  container_app_environment_certificate_id = var.certificate_source == "byo" ? azurerm_container_app_environment_certificate.byo[0].id : replace(
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
