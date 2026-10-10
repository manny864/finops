output "endpoint_hostname" {
  value = var.enabled ? azurerm_cdn_frontdoor_endpoint.this[0].host_name : null
}

output "profile_id" {
  value = var.enabled ? azurerm_cdn_frontdoor_profile.this[0].id : null
}

output "custom_domain_host_name" {
  value = var.enabled && var.custom_domain_host_name != "" ? azurerm_cdn_frontdoor_custom_domain.this[0].host_name : null
}

output "custom_domain_validation_token" {
  description = "Valor del TXT _dnsauth.<subdominio> con el que Front Door valida el dominio."
  value       = var.enabled && var.custom_domain_host_name != "" ? azurerm_cdn_frontdoor_custom_domain.this[0].validation_token : null
}

