output "endpoint_hostname" {
  value = var.enabled ? azurerm_cdn_frontdoor_endpoint.this[0].host_name : null
}

output "profile_id" {
  value = var.enabled ? azurerm_cdn_frontdoor_profile.this[0].id : null
}
