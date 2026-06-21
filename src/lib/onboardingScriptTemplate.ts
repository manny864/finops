export function generateOnboardingScript(clientTenantId: string, subscriptionIdsStr: string, tier: string = 'Essential'): string {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    // Support multiple subscriptions separated by commas
    const subscriptions = subscriptionIdsStr.split(',').map(s => s.trim());
    for (const sub of subscriptions) {
        if (!uuidRegex.test(clientTenantId) || !uuidRegex.test(sub)) {
            throw new Error(`Invalid ID format for tenant ${clientTenantId} or subscription ${sub}`);
        }
    }

    let baseRoles = ['Reader', 'Cost Management Reader'];
    let customActions: string[] = [];

    if (tier === 'Professional') {
        baseRoles.push('Tag Contributor');
    } else if (tier === 'Business' || tier === 'Enterprise') {
        baseRoles.push('Tag Contributor');
        baseRoles.push('Virtual Machine Contributor');
        baseRoles.push('Desktop Virtualization Power On Off Contributor');
        
        customActions = [
            "Microsoft.Compute/virtualMachines/deallocate/action",
            "Microsoft.Compute/virtualMachines/start/action",
            "Microsoft.Compute/virtualMachines/restart/action",
            "Microsoft.Resources/tags/write",
            "Microsoft.Compute/disks/delete",
            "Microsoft.Network/networkInterfaces/delete",
            "Microsoft.Network/publicIPAddresses/delete"
        ];
    }

    const subList = subscriptions.map(s => `"${s}"`).join(", ");

    const customRoleScript = customActions.length > 0 ? `
    Write-Host "  -> Creando/Asignando Rol Personalizado de Remediación..."
    $customRole = Get-AzRoleDefinition -Name $RoleName -Scope "/subscriptions/$sub" -ErrorAction SilentlyContinue
    
    if (-not $customRole) {
        $roleDef = Get-AzRoleDefinition -Name "Reader"
        $roleDef.Id = $null
        $roleDef.Name = $RoleName
        $roleDef.Description = "Permite a CSCloudSolutions ejecutar acciones de FinOps"
        
        $newActions = @(
            ${customActions.map(a => `"${a}"`).join(',\n            ')}
        )

        if ($null -ne $roleDef.Permissions -and $roleDef.Permissions.Count -gt 0) {
            $roleDef.Permissions[0].Actions.Clear()
            foreach ($a in $newActions) { $roleDef.Permissions[0].Actions.Add($a) }
        } elseif ($null -ne $roleDef.Actions) {
            $roleDef.Actions.Clear()
            foreach ($a in $newActions) { $roleDef.Actions.Add($a) }
        }
        
        $roleDef.AssignableScopes.Clear()
        $roleDef.AssignableScopes.Add("/subscriptions/$sub")
        $customRole = New-AzRoleDefinition -Role $roleDef
    }
    
    New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName $RoleName -Scope "/subscriptions/$sub" -ErrorAction SilentlyContinue
` : '';

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

Write-Host "3. Asignando Permisos de Microsoft Graph (Directory.Read.All, Reports.Read.All y User.Read.All)..." -ForegroundColor Cyan
$GraphSp = Get-AzADServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'"
$DirRole = $GraphSp.AppRole | Where-Object { $_.Value -eq "Directory.Read.All" -and $_.AllowedMemberType -contains "Application" }
$RepRole = $GraphSp.AppRole | Where-Object { $_.Value -eq "Reports.Read.All" -and $_.AllowedMemberType -contains "Application" }
$UserRole = $GraphSp.AppRole | Where-Object { $_.Value -eq "User.Read.All" -and $_.AllowedMemberType -contains "Application" }

if ($DirRole -and $RepRole -and $UserRole) {
    $bodyDir = @{ principalId = $sp.Id; resourceId = $GraphSp.Id; appRoleId = $DirRole.Id } | ConvertTo-Json -Depth 5
    $bodyRep = @{ principalId = $sp.Id; resourceId = $GraphSp.Id; appRoleId = $RepRole.Id } | ConvertTo-Json -Depth 5
    $bodyUser = @{ principalId = $sp.Id; resourceId = $GraphSp.Id; appRoleId = $UserRole.Id } | ConvertTo-Json -Depth 5

    Invoke-AzRestMethod -Method Post -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$($sp.Id)/appRoleAssignments" -Payload $bodyDir -ErrorAction SilentlyContinue | Out-Null
    Invoke-AzRestMethod -Method Post -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$($sp.Id)/appRoleAssignments" -Payload $bodyRep -ErrorAction SilentlyContinue | Out-Null
    Invoke-AzRestMethod -Method Post -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$($sp.Id)/appRoleAssignments" -Payload $bodyUser -ErrorAction SilentlyContinue | Out-Null
    Write-Host "   -> Permisos asignados exitosamente. (Requiere Admin Consent desde el Portal de Azure)" -ForegroundColor Green
} else {
    Write-Host "   -> No se pudieron localizar los roles de MS Graph. Por favor, asigne Directory.Read.All, Reports.Read.All y User.Read.All manualmente." -ForegroundColor Yellow
}

Write-Host "4. Asignando 'Cost Management Reader' a nivel del Management Group raíz (Recomendado para FinOps global)..." -ForegroundColor Cyan
New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName "Cost Management Reader" -Scope "/providers/Microsoft.Management/managementGroups/$TenantId" -ErrorAction SilentlyContinue
if (-not $?) {
    Write-Host "   Aviso: No se pudo asignar el rol en el Management Group (falta de permisos). El sistema usará las suscripciones individuales (Fallback)." -ForegroundColor Yellow
}

Write-Host "4. Procesando asignaciones por suscripción..." -ForegroundColor Cyan
foreach ($sub in $Subscriptions) {
    Write-Host "Procesando la suscripción $sub..." -ForegroundColor Cyan
    Set-AzContext -SubscriptionId $sub | Out-Null
    
    Write-Host "  -> Asignando Roles Incorporados (${baseRoles.join(', ')})..."
${baseRoles.map(role => `    New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName "${role}" -Scope "/subscriptions/$sub" -ErrorAction SilentlyContinue`).join('\n')}
${customRoleScript}
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
