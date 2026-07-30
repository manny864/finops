output "app_id" {
  value = azurerm_container_app.this.id
}

output "app_name" {
  value = azurerm_container_app.this.name
}

output "default_hostname" {
  value = azurerm_container_app.this.ingress[0].fqdn
}

output "internal_url" {
  description = "URL que usan los cron jobs para pegarle a la app dentro del entorno."
  value       = "https://${azurerm_container_app.this.ingress[0].fqdn}"
}

output "custom_domain_verification_id" {
  description = "Va en el TXT asuid.<subdominio> para que Azure valide ownership del dominio propio."
  value       = azurerm_container_app.this.custom_domain_verification_id
  # El provider lo marca sensitive por defecto — no es un secreto real (su
  # único uso es publicarse en un TXT público), pero Terraform exige
  # propagar la marca hasta la raíz. Ver custom_domain_dns_instructions.
  sensitive = true
}
