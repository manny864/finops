output "domain_bound" {
  value = var.enabled
}

output "certificate_source" {
  value = var.certificate_source
}

output "byo_certificate_name" {
  description = "Nombre del certificado propio en el entorno (para `az containerapp hostname bind --certificate`), o null."
  value       = local.use_byo ? azurerm_container_app_environment_certificate.byo[0].name : null
}

