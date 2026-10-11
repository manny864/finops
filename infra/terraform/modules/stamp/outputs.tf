output "hostname" {
  value = module.app.default_hostname
}

output "app_name" {
  value = module.app.app_name
}

output "identity_principal_id" {
  value = azurerm_user_assigned_identity.app.principal_id
}

output "identity_client_id" {
  value = azurerm_user_assigned_identity.app.client_id
}

output "resource_group_name" {
  value = module.network.resource_group_name
}

output "migrate_job_name" {
  value = azurerm_container_app_job.migrate.name
}

output "cron_job_names" {
  value = module.cronjobs.job_names
}

output "cron_schedules" {
  description = "Contrastar contra `crontab -l` del VPS antes del corte."
  value       = module.cronjobs.schedules
}

output "mysql_fqdn" {
  value = module.mysql.fqdn
}

output "storage_account_name" {
  value = module.storage.account_name
}

output "key_vault_name" {
  value = module.keyvault.name
}

output "key_vault_uri" {
  value = module.keyvault.vault_uri
}

output "key_vault_id" {
  value = module.keyvault.id
}

output "vnet_id" {
  value = module.network.vnet_id
}

output "vnet_name" {
  value = module.network.vnet_name
}

output "vnet_resource_group_name" {
  value = module.network.resource_group_name
}

output "storage_account_id" {
  value = module.storage.id
}

output "backups_container_resource_manager_id" {
  value = module.storage.backups_container_resource_manager_id
}

output "storage_account_primary_connection_string" {
  value     = module.storage.primary_connection_string
  sensitive = true
}

output "mysql_admin_login" {
  value = var.mysql_admin_login
}

output "mysql_admin_password" {
  value     = random_password.mysql.result
  sensitive = true
}

output "workspace_id" {
  value = module.monitoring.workspace_id
}

output "appinsights_id" {
  value = module.monitoring.appinsights_id
}

output "outbound_ip" {
  # OJO con el nombre: es la IP pública de ENTRADA del entorno (la de capp-svc-lb-ip, en
  # el resource group ME_...), no la de salida. Se mantiene el nombre por compatibilidad.
  # La de salida es nat_gateway_public_ip (null mientras el NAT Gateway esté apagado).
  description = "IP pública de ENTRADA del entorno de Container Apps (a donde apunta el DNS). No es la de salida."
  value       = azurerm_container_app_environment.this.static_ip_address
}

output "nat_gateway_public_ip" {
  description = "IP pública fija de SALIDA del entorno (NAT Gateway), o null si está apagado."
  value       = module.network.nat_gateway_public_ip
}

output "custom_domain_verification_id" {
  value     = module.app.custom_domain_verification_id
  sensitive = true
}

