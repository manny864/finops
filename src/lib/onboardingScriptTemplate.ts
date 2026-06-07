export function generateOnboardingScript(clientTenantId: string, subscriptionIdsStr: string): string {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    // Support multiple subscriptions separated by commas
    const subscriptions = subscriptionIdsStr.split(',').map(s => s.trim());
    for (const sub of subscriptions) {
        if (!uuidRegex.test(clientTenantId) || !uuidRegex.test(sub)) {
            throw new Error(`Invalid ID format for tenant ${clientTenantId} or subscription ${sub}`);
        }
    }

    const subList = subscriptions.map(s => `"${s}"`).join(", ");

    return `# ==============================================================================
# CSCloudSolutions FinOps Agent - Onboarding Script (PowerShell)
# ==============================================================================
# Execute este script en Azure Cloud Shell (Modo PowerShell).
# Configura UN SOLO Service Principal para N suscripciones.

$TenantId = "${clientTenantId}"
$Subscriptions = @(${subList})
$AppName = "CSCloudSolutions-FinOps-Agent"
$RoleName = "CSCloudSolutions Remediation Role"

Write-Host "Verificando si la App ya existe..." -ForegroundColor Cyan
$spList = Get-AzADServicePrincipal -DisplayName $AppName -ErrorAction SilentlyContinue

if (-not $spList) {
    Write-Host "1. Creando la App Registration y el Service Principal..." -ForegroundColor Cyan
    $sp = New-AzADServicePrincipal -DisplayName $AppName
} else {
    Write-Host "La App ya existe. Reutilizando Service Principal..." -ForegroundColor Yellow
    # Si hay múltiples con el mismo nombre, tomamos el primero
    if ($spList.Count -gt 1) {
        $sp = $spList[0]
    } else {
        $sp = $spList
    }
}

$ClientId = $sp.AppId
$spId = $sp.Id

Write-Host "2. Generando Client Secret seguro..." -ForegroundColor Cyan
$app = Get-AzADApplication -AppId $sp.AppId
$secret = New-AzADAppCredential -ObjectId $app.Id -StartDate (Get-Date) -EndDate (Get-Date).AddYears(2)
$ClientSecret = $secret.SecretText

foreach ($sub in $Subscriptions) {
    Write-Host "Procesando la suscripción $sub..." -ForegroundColor Cyan
    Set-AzContext -SubscriptionId $sub | Out-Null
    
    Write-Host "  -> Asignando Roles Incorporados (Reader & Cost Management Reader)..."
    New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName "Reader" -Scope "/subscriptions/$sub" -ErrorAction SilentlyContinue
    New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName "Cost Management Reader" -Scope "/subscriptions/$sub" -ErrorAction SilentlyContinue

    Write-Host "  -> Creando/Asignando Rol Personalizado de Remediación..."
    $customRole = Get-AzRoleDefinition -Name $RoleName -Scope "/subscriptions/$sub" -ErrorAction SilentlyContinue
    
    if (-not $customRole) {
        $roleDef = Get-AzRoleDefinition -Name "Reader"
        $roleDef.Id = $null
        $roleDef.Name = $RoleName
        $roleDef.Description = "Permite a CSCloudSolutions ejecutar acciones de FinOps"
        $roleDef.Actions.Clear()
        $roleDef.Actions.Add("Microsoft.Compute/virtualMachines/deallocate/action")
        $roleDef.Actions.Add("Microsoft.Compute/virtualMachines/start/action")
        $roleDef.Actions.Add("Microsoft.Compute/virtualMachines/restart/action")
        $roleDef.Actions.Add("Microsoft.Resources/tags/write")
        $roleDef.Actions.Add("Microsoft.Compute/disks/delete")
        $roleDef.Actions.Add("Microsoft.Network/networkInterfaces/delete")
        $roleDef.Actions.Add("Microsoft.Network/publicIPAddresses/delete")
        $roleDef.AssignableScopes.Clear()
        $roleDef.AssignableScopes.Add("/subscriptions/$sub")
        $customRole = New-AzRoleDefinition -Role $roleDef
    }
    
    New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName $RoleName -Scope "/subscriptions/$sub" -ErrorAction SilentlyContinue
}

Write-Host "==============================================================================" -ForegroundColor Green
Write-Host "¡Onboarding Completado con Éxito!" -ForegroundColor Green
Write-Host "Por favor, copie de forma segura el siguiente bloque JSON y envíelo a nuestro equipo:" -ForegroundColor Yellow

$output = @{
    TenantId = $TenantId
    Subscriptions = $Subscriptions
    ClientId = $ClientId
    ClientSecret = $ClientSecret
}

$output | ConvertTo-Json

Write-Host "Nota: El ClientSecret solo es visible una vez. Si lo pierde, deberá regenerarlo." -ForegroundColor Red
`;
}
