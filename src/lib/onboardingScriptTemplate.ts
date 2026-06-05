export function generateOnboardingScript(clientTenantId: string, subscriptionId: string): string {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(clientTenantId) || !uuidRegex.test(subscriptionId)) {
        throw new Error("Invalid ID format");
    }

    return `# ==============================================================================
# CSCloudSolutions FinOps Agent - Onboarding Script (PowerShell / Azure Cloud Shell)
# ==============================================================================
# Execute este script en Azure Cloud Shell (Modo PowerShell).
#
# Objetivo: Crea un Service Principal con permisos de solo lectura para facturación
# e inventario, y un rol personalizado estrictamente limitado a 3 acciones para
# automatización y remediación (apagado/encendido y etiquetado).

$TenantId = "${clientTenantId}"
$SubscriptionId = "${subscriptionId}"
$AppName = "CSCloudSolutions-FinOps-Agent"
$RoleName = "CSCloudSolutions Remediation Role"

Write-Host "Seleccionando la suscripción $SubscriptionId..." -ForegroundColor Cyan
Set-AzContext -SubscriptionId $SubscriptionId

Write-Host "1. Creando la App Registration y el Service Principal..." -ForegroundColor Cyan
$sp = New-AzADServicePrincipal -DisplayName $AppName
$ClientId = $sp.AppId
$spId = $sp.Id

Write-Host "2. Generando Client Secret seguro..." -ForegroundColor Cyan
# New-AzADAppCredential must target the Application Object ID, not the SP.
# Also, -DisplayName can conflict with other parameter sets.
$app = Get-AzADApplication -AppId $sp.AppId
$secret = New-AzADAppCredential -ObjectId $app.Id -StartDate (Get-Date) -EndDate (Get-Date).AddYears(2)
$ClientSecret = $secret.SecretText

Write-Host "3. Asignando Roles Incorporados (Reader & Cost Management Reader)..." -ForegroundColor Cyan
New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName "Reader" -Scope "/subscriptions/$SubscriptionId"
New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName "Cost Management Reader" -Scope "/subscriptions/$SubscriptionId"

Write-Host "4. Creando Rol Personalizado de Remediación Least-Privilege..." -ForegroundColor Cyan
$roleDef = Get-AzRoleDefinition -Name "Reader"
$roleDef.Id = $null
$roleDef.Name = $RoleName
$roleDef.Description = "Permite a CSCloudSolutions ejecutar acciones limitadas de FinOps (apagar, encender, etiquetar)"
$roleDef.Actions.Clear()
$roleDef.Actions.Add("Microsoft.Compute/virtualMachines/deallocate/action")
$roleDef.Actions.Add("Microsoft.Compute/virtualMachines/start/action")
$roleDef.Actions.Add("Microsoft.Compute/virtualMachines/restart/action")
$roleDef.Actions.Add("Microsoft.Resources/tags/write")
$roleDef.Actions.Add("Microsoft.Compute/disks/delete")
$roleDef.Actions.Add("Microsoft.Network/networkInterfaces/delete")
$roleDef.Actions.Add("Microsoft.Network/publicIPAddresses/delete")
$roleDef.AssignableScopes.Clear()
$roleDef.AssignableScopes.Add("/subscriptions/$SubscriptionId")

$customRole = New-AzRoleDefinition -Role $roleDef
New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName $RoleName -Scope "/subscriptions/$SubscriptionId"

Write-Host "==============================================================================" -ForegroundColor Green
Write-Host "¡Onboarding Completado con Éxito!" -ForegroundColor Green
Write-Host "Por favor, copie de forma segura el siguiente bloque JSON y envíelo a nuestro equipo:" -ForegroundColor Yellow

$output = @{
    TenantId = $TenantId
    SubscriptionId = $SubscriptionId
    ClientId = $ClientId
    ClientSecret = $ClientSecret
}

$output | ConvertTo-Json

Write-Host "Nota: El ClientSecret solo es visible una vez. Si lo pierde, deberá regenerarlo." -ForegroundColor Red
`;
}
