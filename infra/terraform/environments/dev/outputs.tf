output "stamp_hostnames" {
  value = local.stamp_hostnames
}

output "stamp_outbound_ips" {
  description = "La IP que ven las ARM APIs de Azure y los webhooks de Paddle/marketplace."
  value       = { for k, s in module.stamp : k => s.outbound_ip }
}

output "cron_schedules" {
  description = "Contrastar contra `crontab -l` del VPS antes del corte."
  value       = { for k, s in module.stamp : k => s.cron_schedules }
}

output "cron_job_names" {
  value = { for k, s in module.stamp : k => s.cron_job_names }
}

output "migrate_jobs" {
  value = { for k, s in module.stamp : k => { job = s.migrate_job_name, resource_group = s.resource_group_name } }
}

output "web_apps" {
  value = { for k, s in module.stamp : k => { app = s.app_name, resource_group = s.resource_group_name } }
}

output "storage_accounts" {
  description = "Destino de los adjuntos de soporte y logos que hoy están en data/."
  value       = { for k, s in module.stamp : k => s.storage_account_name }
}

output "mysql_fqdns" {
  value = { for k, s in module.stamp : k => s.mysql_fqdn }
}

output "acr_login_server" {
  value = module.acr.login_server
}

output "appinsights_ids" {
  value = { for k, s in module.stamp : k => s.appinsights_id }
}

output "frontdoor_hostname" {
  value = module.frontdoor.endpoint_hostname
}

# Lo consume .github/workflows/terraform.yml para abrir y cerrar el firewall
# del vault alrededor del plan/apply.
output "key_vault_names" {
  value = { for k, s in module.stamp : k => s.key_vault_name }
}
