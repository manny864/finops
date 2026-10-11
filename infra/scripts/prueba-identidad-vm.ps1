# Prueba de humo de la identidad administrada de la VM de backups contra Blob Storage.
#
# Se corre con `az vm run-command invoke` (como SYSTEM, igual que el Hybrid Worker) y NO toca los
# backups: sube un archivo de prueba a db-backups/_prueba-identidad/ y lo borra. Sirve para
# comprobar, antes de publicar el runbook nuevo, tres cosas que el código no demuestra: que el rol
# de datos de la VM ya propagó, que AzCopy 10.x hace el login por IMDS con
# AZCOPY_AUTO_LOGIN_TYPE=MSI y que la VM llega a la cuenta.
#
# Uso (docs/security/endurecimiento-infraestructura-saas-2026-10-09.md, 7.6, fase 3):
#   az vm run-command invoke -g cscs-finops-prod-westus2-backup-rg -n vm-mysql-worker \
#     --command-id RunPowerShellScript --scripts @infra/scripts/prueba-identidad-vm.ps1 \
#     --query 'value[0].message' -o tsv
#
# Es PowerShell 5.1 a propósito (run-command usa powershell.exe): nada de sintaxis de PowerShell 7.
$cuenta = "cscsfinopsprodwestus2sa"
$azcopy = "C:\Tools\AzCopy\azcopy.exe"

"--- version de AzCopy"
& $azcopy --version

$archivo = Join-Path $env:TEMP "prueba-identidad.txt"
"prueba de identidad $(Get-Date -Format o)" | Set-Content -Path $archivo

# Igual que el runbook: login implicito con la identidad de sistema de la VM.
$env:AZCOPY_AUTO_LOGIN_TYPE = "MSI"
$destino = "https://$cuenta.blob.core.windows.net/db-backups/_prueba-identidad/$(Get-Date -Format yyyyMMdd-HHmmss).txt"

"--- subida a $destino"
& $azcopy copy $archivo $destino --log-level=ERROR
"azcopy copy: exit $LASTEXITCODE"

"--- borrado"
& $azcopy remove $destino --log-level=ERROR
"azcopy remove: exit $LASTEXITCODE"

Remove-Item -Path $archivo -Force -ErrorAction SilentlyContinue
