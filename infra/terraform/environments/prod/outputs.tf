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

output "custom_domain_dns_instructions" {
  # Terraform obliga a marcar sensitive porque el provider marca
  # custom_domain_verification_id como tal (ver modules/containerapp/outputs.tf).
  # Para verlo: `terraform output -json custom_domain_dns_instructions`.
  sensitive   = true
  description = <<-DESC
    Runbook para activar el dominio propio de cada stamp que lo tenga
    configurado (custom_domain_name != ""). Correr `terraform output -json
    custom_domain_dns_instructions` para ver esto formateado.

    Orden obligatorio, no intercambiable:
      1. Cargar el CNAME y el TXT en Cloudflare EN MODO DNS-ONLY (nube gris,
         sin proxy). Si el proxy está prendido, Azure no puede validar y el
         apply del paso 2 falla.
      2. Poner custom_domain_enabled=true para ese stamp en el .tfvars y
         aplicar. Azure valida contra el DNS del paso 1 y emite el
         certificado gestionado.
      3. Recién ahí prender el proxy de Cloudflare (nube naranja), modo
         SSL/TLS "Full (strict)".
      4. Registrar el mismo FQDN como redirect URI adicional en la app
         registration de MSAL (876d8a5b-..., tenant 8b41364f-...) — sin esto
         el login falla con AADSTS50011 al entrar por el dominio nuevo.
  DESC
  value = {
    for k, s in module.stamp : k => {
      domain            = var.stamps[k].custom_domain_name
      cname_target      = s.hostname
      txt_record_name   = "asuid.${split(".", var.stamps[k].custom_domain_name)[0]}"
      txt_record_value  = s.custom_domain_verification_id
      currently_enabled = var.stamps[k].custom_domain_enabled
    }
    if var.stamps[k].custom_domain_name != ""
  }
}
