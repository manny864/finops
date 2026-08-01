# Directiva: mysql_backup_automation_SOP

## Objetivo
Gestionar el sistema de backups automatizados de MySQL mediante Azure Automation:
un Orchestrator (runbook en Azure sandbox) prende la VM Worker, dispara el
runbook hijo en el Hybrid Runbook Worker, monitorea hasta completar, y apaga la
VM. Todo declarado en Terraform (`infra/terraform/modules/mysql_backup/main.tf`).

## Componentes Clave
- **Automation Account:** `aa-mysql-backups` (Basic SKU, System Assigned Identity)
- **Orchestrator Runbook:** `Orchestrator-Start-Backup-Stop` — corre en Azure sandbox (PS 7.2)
- **Worker Runbook:** `Backup-MySQL-Smart` — corre en Hybrid Runbook Worker dentro de `vm-mysql-worker`
- **VM:** `vm-mysql-worker` (Windows Server 2022, Standard_D2s_v5)
- **Alertas:** Logic App `la-backup-alerts` con conexión Office 365

## Restricciones / Casos Borde Conocidos

### ⚠️ CRÍTICO: Runtime de módulos Az vs runbooks (descubierto 2026-08-01)
- **Problema:** Los cmdlets `Connect-AzAccount`, `Start-AzVM`, `Stop-AzVM` no se
  reconocen si los módulos Az se importan con `azurerm_automation_module` (PS 5.1)
  pero el runbook corre en PS 7.2.
- **Causa raíz:** `azurerm_automation_module` importa módulos en el runtime de
  PS 5.1. Los runbooks de tipo `PowerShell72` solo ven módulos importados para
  el runtime 7.2.
- **Solución:** Usar `azurerm_automation_powershell72_module` para importar
  `Az.Accounts`, `Az.Compute` y `Az.Automation`. Los runbooks deben tener
  `runbook_type = "PowerShell72"`.
- **⚠️ Schema diferente:** `azurerm_automation_powershell72_module` usa
  `automation_account_id` (el ID completo del Automation Account), NO
  `resource_group_name` + `automation_account_name` como el viejo
  `azurerm_automation_module`. Si se copian los argumentos del resource viejo
  sin adaptarlos, Terraform falla con "Missing required argument:
  automation_account_id" y "Unsupported argument: resource_group_name".
- **Nota:** No mezclar `azurerm_automation_module` y
  `azurerm_automation_powershell72_module` para el mismo módulo — si se importa
  en ambos runtimes, el provisioning puede fallar por conflicto de dependencias.

### Conexión OAuth de Office 365
- La API Connection de Office 365 se crea por Terraform pero NO se autoriza.
- Requiere un paso manual único post-apply: Portal → Resource Group →
  `api-connection-office365` → Editar → Autorizar con la cuenta que enviará
  los correos de alerta.

### SAS Token
- El SAS no se auto-rota. Vence según `sas_validity_years` desde el primer apply.
- La variable `STORAGE_SAS_TOKEN` se actualiza automáticamente con `terraform apply`
  cuando `time_rotating.sas_reference` rota.

### Variables de Automation
- `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASS`, `STORAGE_ACCOUNT_NAME`,
  `STORAGE_SAS_TOKEN`, `ALERT_WEBHOOK_URL` — todas encrypted.
- El Worker runbook las lee con `Get-AutomationVariable -Name "..."`.

### Escape de variables en heredoc
- **Nota (descubierto 2026-07-31):** PowerShell dentro de un heredoc `<<-PS1`
  de Terraform requiere `$$` para escapar `$` de PowerShell. Sin el doble `$`,
  Terraform interpola la variable y el script falla con errores de parsing
  como `Unexpected token 'toolPath_MysqlDump'`.

## Procedimiento de Deploy
1. `terraform plan -target=module.mysql_backup` — verificar que los módulos se
   recrean como `azurerm_automation_powershell72_module`.
2. `terraform apply` — los módulos se importan asincrónicamente; puede tardar
   hasta 5 minutos por módulo.
3. Verificar en el Portal: Automation Account → Modules → filtrar por Runtime 7.2
   → confirmar que `Az.Accounts`, `Az.Compute`, `Az.Automation` están en
   `Succeeded`.
4. Ejecutar manualmente el Orchestrator y verificar que pasa la fase de
   autenticación (`Connect-AzAccount -Identity`).

## Checklist
- [ ] ¿Los 3 módulos Az usan `azurerm_automation_powershell72_module`?
- [ ] ¿Ambos runbooks tienen `runbook_type = "PowerShell72"`?
- [ ] ¿El `depends_on` del orchestrator referencia los módulos `powershell72`?
- [ ] ¿La conexión OAuth de Office 365 está autorizada en el Portal?
- [ ] ¿El SAS token tiene fecha de vencimiento dentro del rango esperado?
