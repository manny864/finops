# Outputs de staging.
#
# El conjunto y la FORMA de cada uno se reconstruyeron desde
# staging/terraform.tfstate (serial 24, 2026-08-06) para que coincidan con los
# que ya están guardados. La versión anterior de este archivo declaraba
# outputs que el módulo stamp no expone (container_app_env_id, web_app_id,
# managed_identity_id, redis_hostname, mysql_database_name) y usaba nombres
# que no existen (keyvault_id en vez de key_vault_id, mysql_hostname en vez de
# mysql_fqdn, log_analytics_workspace_id en vez de workspace_id): la
# configuración no llegaba ni a validar.

output "acr_login_server" {
  description = "ACR compartido con prod — acá se referencia, no se crea."
  value       = data.azurerm_container_registry.acr.login_server
}

output "stamp_hostnames" {
  value = local.stamp_hostnames
}

output "stamp_outbound_ips" {
  description = "La IP que ven las ARM APIs de Azure y los webhooks."
  value       = { for k, s in module.stamp : k => s.outbound_ip }
}

output "web_apps" {
  value = {
    for k, s in module.stamp : k => {
      app            = s.app_name
      hostname       = s.hostname
      resource_group = s.resource_group_name
    }
  }
}

output "migrate_jobs" {
  value = { for k, s in module.stamp : k => { job = s.migrate_job_name, resource_group = s.resource_group_name } }
}

output "cron_job_names" {
  value = { for k, s in module.stamp : k => s.cron_job_names }
}

output "cron_schedules" {
  description = "Cada job con su expresión en hora local y en UTC."
  value       = { for k, s in module.stamp : k => s.cron_schedules }
}

output "mysql_fqdns" {
  value = { for k, s in module.stamp : k => s.mysql_fqdn }
}

output "storage_accounts" {
  value = { for k, s in module.stamp : k => s.storage_account_name }
}

output "identity_client_ids" {
  description = "Managed identity de cada stamp — es la que lee el Key Vault."
  value       = { for k, s in module.stamp : k => s.identity_client_id }
}

output "key_vault_ids" {
  value = { for k, s in module.stamp : k => s.key_vault_id }
}

output "key_vault_uris" {
  value = { for k, s in module.stamp : k => s.key_vault_uri }
}

# Lo consume .github/workflows/terraform.yml para abrir y cerrar el firewall
# del vault alrededor del plan/apply. No estaba en el state anterior: es un
# output nuevo, y agregar un output no toca ningún recurso.
output "key_vault_names" {
  value = { for k, s in module.stamp : k => s.key_vault_name }
}
