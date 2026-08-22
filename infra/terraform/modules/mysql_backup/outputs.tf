output "resource_group_name" {
  value = azurerm_resource_group.this.name
}

output "vm_name" {
  value = azurerm_windows_virtual_machine.this.name
}

output "vm_admin_username" {
  value = var.vm_admin_username
}

output "vm_admin_password_key_vault_secret_name" {
  description = "Nombre del secret en el Key Vault existente — buscar ahí, no en el state."
  value       = azurerm_key_vault_secret.vm_admin_password.name
}

output "bastion_name" {
  value = var.bastion_enabled ? azurerm_bastion_host.this[0].name : null
}

output "automation_account_name" {
  value = azurerm_automation_account.this.name
}

output "hybrid_worker_group_name" {
  value = azurerm_automation_hybrid_runbook_worker_group.this.name
}

output "logic_app_name" {
  value = "la-backup-alerts"
}

output "office365_connection_authorize_url" {
  description = "Ir acá después del apply para autorizar la conexión de Office 365 (no automatizable — ver comentario en main.tf)."
  value       = "https://portal.azure.com/#@/resource${azurerm_api_connection.office365.id}"
}

output "sas_expiry_warning" {
  description = "Fecha en la que vence el SAS del contenedor de backups. Agendar renovación antes de esta fecha."
  value       = time_rotating.sas_reference.rotation_rfc3339
}

output "next_manual_steps" {
  description = "Lo que Terraform NO puede automatizar — hacer una sola vez después del apply."
  value       = <<-EOT
    1. Autorizar la conexión de Office 365 (ver output office365_connection_authorize_url).
    2. Conectarse a la VM por Bastion (Portal → Bastion → Connect, con
       vm_admin_username y la password en el Key Vault) e instalar, siguiendo
       la Fase 4 del manual:
         - MySQL client (mysqldump) — verificar que la ruta coincida con
           var.vm_tool_path_mysqldump.
         - Git for Windows (gzip) — verificar var.vm_tool_path_gzip.
         - AzCopy v10 en var.vm_tool_path_azcopy.
       Si alguna ruta queda distinta a la configurada, ajustar la variable y
       re-aplicar — sólo actualiza el contenido del runbook, no la VM.
    3. Probar el Orquestador manualmente una vez (Automation Account → Runbooks
       → Orchestrator-Start-Backup-Stop → Iniciar) antes de confiar en el
       schedule diario.
  EOT
}
