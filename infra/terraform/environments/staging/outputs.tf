output "web_apps" {
  value = {
    for k, s in module.stamp : k => {
      name            = s.web_app_name
      hostname        = s.hostname
      environment     = var.environment
      resource_group  = s.resource_group_name
    }
  }
  description = "Container Apps del web (staging)"
}

output "migrate_jobs" {
  value = {
    for k, s in module.stamp : k => s.migrate_job_name
  }
  description = "Container App Jobs para migraciones (staging)"
}

output "mysql_hostnames" {
  value = {
    for k, s in module.stamp : k => {
      hostname    = s.mysql_hostname
      admin_login = s.mysql_admin_login
      database    = s.mysql_database_name
    }
  }
  description = "Hostnames de MySQL Flexible Server (STAGING SEPARADA)"
}

output "redis_hostname" {
  value       = module.stamp[var.default_stamp].redis_hostname
  description = "Hostname de Redis (COMPARTIDO CON PROD, usar REDIS_PREFIX=staging: en env vars)"
}

output "storage_account_name" {
  value       = module.stamp[var.default_stamp].storage_account_name
  description = "Storage Account (compartida con prod)"
}

output "storage_account_id" {
  value       = module.stamp[var.default_stamp].storage_account_id
  description = "ID del Storage Account (compartida con prod)"
}

output "keyvault_id" {
  value       = module.stamp[var.default_stamp].keyvault_id
  description = "ID del Key Vault (compartida con prod)"
}

output "keyvault_name" {
  value       = module.stamp[var.default_stamp].keyvault_name
  description = "Nombre del Key Vault (compartida con prod)"
}

output "container_app_environment_id" {
  value       = module.stamp[var.default_stamp].container_app_env_id
  description = "ID del Container App Environment (COMPARTIDO CON PROD)"
}

output "container_app_environment_name" {
  value       = module.stamp[var.default_stamp].container_app_env_name
  description = "Nombre del CAE (COMPARTIDO CON PROD)"
}

output "acr_login_server" {
  value       = data.azurerm_container_registry.acr.login_server
  description = "ACR login server (COMPARTIDO CON PROD)"
}

output "managed_identity_client_id" {
  value       = module.stamp[var.default_stamp].managed_identity_client_id
  description = "Client ID de la Managed Identity"
}

output "resource_group_name" {
  value = {
    for k, s in module.stamp : k => s.resource_group_name
  }
  description = "Nombres de los Resource Groups de staging"
}

output "log_analytics_workspace_id" {
  value       = module.stamp[var.default_stamp].log_analytics_workspace_id
  description = "Log Analytics Workspace ID"
}

output "environment_info" {
  value = {
    environment     = var.environment
    location        = var.stamps[var.default_stamp].location
    zone_redundant  = var.stamps[var.default_stamp].zone_redundant
    web_cpu         = var.stamps[var.default_stamp].web_cpu
    web_memory      = var.stamps[var.default_stamp].web_memory
    web_replicas    = "${var.stamps[var.default_stamp].web_min_replicas}...${var.stamps[var.default_stamp].web_max_replicas}"
    mysql_sku       = var.stamps[var.default_stamp].mysql_sku_name
    redis_shared    = "true (con prefijo: staging:)"
    monthly_budget  = var.stamps[var.default_stamp].monthly_budget_amount
  }
  description = "Información general de la configuración de staging"
}

output "cli_commands" {
  value = {
    get_mysql_password = "az keyvault secret show --vault-name $(terraform output -raw keyvault_name) --name mysql-finops-staging-password --query value -o tsv"
    migrate_run        = "az containerapp job start -n $(terraform output -json migrate_jobs | jq -r '.us') -g $(terraform output -json resource_group_name | jq -r '.us')"
    logs_follow        = "az containerapp logs show -n $(terraform output -json web_apps | jq -r '.us.name') -g $(terraform output -json resource_group_name | jq -r '.us') --follow"
    web_url            = "https://$(terraform output -json web_apps | jq -r '.us.hostname')"
  }
  description = "Comandos útiles de Azure CLI para staging"
}
