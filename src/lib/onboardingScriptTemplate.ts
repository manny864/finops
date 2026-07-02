// Acciones del custom role de remediación por tier. Única fuente de verdad,
// compartida entre el generador del script de onboarding y el verificador de
// permisos (check-sp-roles), para no duplicar/desincronizar la lista.
export const BUSINESS_CUSTOM_ACTIONS: string[] = [
    "Microsoft.Compute/virtualMachines/deallocate/action",
    "Microsoft.Compute/virtualMachines/start/action",
    "Microsoft.Compute/virtualMachines/restart/action",
    "Microsoft.Resources/tags/write",
    "Microsoft.Consumption/budgets/read",
    "Microsoft.Consumption/budgets/write",
    "Microsoft.Consumption/budgets/delete",
];

export const ENTERPRISE_CUSTOM_ACTIONS: string[] = [
    ...BUSINESS_CUSTOM_ACTIONS,
    "Microsoft.Resources/subscriptions/resourceGroups/write",
    "Microsoft.Compute/disks/delete",
    "Microsoft.Compute/snapshots/delete",
    "Microsoft.Network/networkInterfaces/delete",
    "Microsoft.Network/publicIPAddresses/delete",
    "Microsoft.Network/networkSecurityGroups/delete",
];

// Nombre canónico del custom role creado por el script de onboarding.
export const CUSTOM_REMEDIATION_ROLE_NAME = 'CSCloudSolutions Remediation Role';

/** Devuelve las acciones que el custom role de remediación debe tener para el tier dado. */
export function getCustomRoleActionsForTier(tier: string): string[] {
    switch ((tier || 'Essential').toLowerCase()) {
        case 'business':
            return [...BUSINESS_CUSTOM_ACTIONS];
        case 'enterprise':
            return [...ENTERPRISE_CUSTOM_ACTIONS];
        default:
            return [];
    }
}

export function generateOnboardingScript(clientTenantId: string, subscriptionIdsStr: string, tier: string = 'Essential'): string {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    const subscriptions = subscriptionIdsStr.split(',').map(s => s.trim());
    for (const sub of subscriptions) {
        if (!uuidRegex.test(clientTenantId) || !uuidRegex.test(sub)) {
            throw new Error(`Invalid ID format for tenant ${clientTenantId} or subscription ${sub}`);
        }
    }

    // ------------------------------------------------------------------------
    // Roles por tier
    // ------------------------------------------------------------------------
    // Todos: lectura completa para FinOps (Cost Mgmt + Resource Graph + métricas)
    const essentialRoles = [
        'Reader',                  // Resource Graph, Advisor, listar recursos
        'Cost Management Reader',  // /api/intelligence/billing
        'Monitoring Reader',       // métricas para rightsizing
        'Billing Reader',          // visibilidad de facturación a nivel sub (MCA-friendly)
    ];

    const baseRoles = [...essentialRoles];
    const customActions: string[] = getCustomRoleActionsForTier(tier);

    if (tier === 'Professional') {
        baseRoles.push('Tag Contributor'); // auto-tagging
    } else if (tier === 'Business') {
        baseRoles.push('Tag Contributor'); // auto-tagging + custom role (power mgmt + budgets)
    } else if (tier === 'Enterprise') {
        baseRoles.push('Tag Contributor');
        baseRoles.push('Monitoring Contributor'); // workbooks deploy + métricas avanzadas
    }

    const subList = subscriptions.map(s => `"${s}"`).join(", ");

    const customRoleActionsBlock = customActions.length > 0
        ? customActions.map(a => `        "${a}"`).join(',\n')
        : '';

    const customRoleBootstrapScript = customActions.length > 0 ? `
# --- Crear/Actualizar Custom Role UNA SOLA VEZ a nivel directorio ---
# Los custom roles son directory-wide. AssignableScopes debe incluir TODAS las subs.
Write-Host "4b. Creando/Actualizando Rol Personalizado (directory-wide)..." -ForegroundColor Cyan

# IMPORTANTE: los cmdlets *-AzRoleDefinition operan contra la suscripción del
# CONTEXTO actual. Fijamos el contexto a la primera suscripción destino para que
# la creación/actualización sea determinística y no dependa de la sub default de
# Cloud Shell (que podría no estar en AssignableScopes o no ser controlada).
Set-AzContext -SubscriptionId $Subscriptions[0] -ErrorAction SilentlyContinue | Out-Null

$customActions = @(
${customRoleActionsBlock}
)
$assignableScopes = $Subscriptions | ForEach-Object { "/subscriptions/$_" }

$existingCustom = Get-AzRoleDefinition -Name $RoleName -ErrorAction SilentlyContinue

if ($existingCustom) {
    Write-Host "   -> Rol ya existe. Actualizando AssignableScopes y Actions..." -ForegroundColor Yellow
    try {
        # Asegurar que todas las subs estén en AssignableScopes
        $currentScopes = @($existingCustom.AssignableScopes)
        $merged = ($currentScopes + $assignableScopes) | Select-Object -Unique
        $existingCustom.AssignableScopes.Clear()
        foreach ($s in $merged) { $existingCustom.AssignableScopes.Add($s) }

        # Asegurar Actions
        if ($null -ne $existingCustom.Permissions -and $existingCustom.Permissions.Count -gt 0) {
            $existingCustom.Permissions[0].Actions.Clear()
            foreach ($a in $customActions) { $existingCustom.Permissions[0].Actions.Add($a) }
        } elseif ($null -ne $existingCustom.Actions) {
            $existingCustom.Actions.Clear()
            foreach ($a in $customActions) { $existingCustom.Actions.Add($a) }
        }

        Set-AzRoleDefinition -Role $existingCustom -ErrorAction Stop | Out-Null
        Write-Host "   [OK] Rol actualizado." -ForegroundColor Green
        $customRoleReady = $true
    } catch {
        Write-Host "   [FAIL] No se pudo actualizar el rol: $($_.Exception.Message)" -ForegroundColor Red
        $customRoleReady = $false
    }
} else {
    Write-Host "   -> Creando nuevo rol personalizado..." -ForegroundColor Cyan
    try {
        $roleDef = Get-AzRoleDefinition -Name "Reader"
        $roleDef.Id = $null
        $roleDef.IsCustom = $true
        $roleDef.Name = $RoleName
        $roleDef.Description = "Permite a CSCloudSolutions ejecutar acciones de FinOps (remediación controlada)"

        if ($null -ne $roleDef.Permissions -and $roleDef.Permissions.Count -gt 0) {
            $roleDef.Permissions[0].Actions.Clear()
            foreach ($a in $customActions) { $roleDef.Permissions[0].Actions.Add($a) }
            if ($null -ne $roleDef.Permissions[0].NotActions) { $roleDef.Permissions[0].NotActions.Clear() }
        } elseif ($null -ne $roleDef.Actions) {
            $roleDef.Actions.Clear()
            foreach ($a in $customActions) { $roleDef.Actions.Add($a) }
            if ($null -ne $roleDef.NotActions) { $roleDef.NotActions.Clear() }
        }

        $roleDef.AssignableScopes.Clear()
        foreach ($s in $assignableScopes) { $roleDef.AssignableScopes.Add($s) }

        New-AzRoleDefinition -Role $roleDef -ErrorAction Stop | Out-Null

        # Esperar propagación (Azure tarda ~30-60s en hacer visible un rol nuevo)
        Write-Host "   -> Esperando propagación del rol (máx 90s)..." -ForegroundColor DarkGray
        $customRoleReady = $false
        for ($i = 0; $i -lt 18; $i++) {
            Start-Sleep -Seconds 5
            $check = Get-AzRoleDefinition -Name $RoleName -ErrorAction SilentlyContinue
            if ($check) { $customRoleReady = $true; break }
        }
        if ($customRoleReady) {
            Write-Host "   [OK] Rol creado y propagado." -ForegroundColor Green
        } else {
            Write-Host "   [WARN] Rol creado pero aún no propagado. Re-ejecute el script en unos minutos para asignar." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "   [FAIL] No se pudo crear el rol: $($_.Exception.Message)" -ForegroundColor Red
        $customRoleReady = $false
    }
}
` : '\n$customRoleReady = $false\n';

    const customRoleAssignPerSub = customActions.length > 0
        ? `    if ($customRoleReady) { Try-AssignRole -ObjectId $spId -RoleName $RoleName -Scope "/subscriptions/$sub" }`
        : '';

    return `# ==============================================================================
# CSCloudSolutions FinOps Agent - Onboarding Script (PowerShell)
# Tier: ${tier}
# ==============================================================================
# Ejecutar en Azure Cloud Shell (PowerShell). Configura UN SOLO Service Principal
# para N suscripciones, con los roles correspondientes al tier contratado.
#
# Roles que asigna a nivel SUSCRIPCIÓN:
#   ${baseRoles.map(r => `* ${r}`).join('\n#   ')}
#
# Rol que asigna a nivel TENANT (Microsoft.Capacity):
#   * Reservations Reader  (lectura de Reservas/RIs Shared y Single para el panel de Compromisos)
${customActions.length > 0 ? `#
# Custom role con permisos de remediación:
#   ${customActions.map(a => `* ${a}`).join('\n#   ')}` : ''}
# ==============================================================================

$TenantId = "${clientTenantId}"
$Subscriptions = @(${subList})
$AppName = "CSCloudSolutions-FinOps-Agent"
$RoleName = "${CUSTOM_REMEDIATION_ROLE_NAME}"

# Silenciar warnings cosméticos de breaking changes de Az PowerShell
$WarningPreference = 'SilentlyContinue'
$env:SuppressAzurePowerShellBreakingChangeWarnings = 'true'

# --- Helper: asigna rol y registra éxito/fallo (no oculta errores reales) ---
$script:assignmentLog = @()
function Try-AssignRole {
    param([string]$ObjectId, [string]$RoleName, [string]$Scope)
    try {
        $existing = Get-AzRoleAssignment -ObjectId $ObjectId -Scope $Scope -RoleDefinitionName $RoleName -ErrorAction SilentlyContinue
        if ($existing) {
            Write-Host "     [OK] $RoleName ya asignado en $Scope" -ForegroundColor DarkGray
            $script:assignmentLog += [PSCustomObject]@{ Role=$RoleName; Scope=$Scope; Status='AlreadyExists' }
            return
        }
        New-AzRoleAssignment -ObjectId $ObjectId -RoleDefinitionName $RoleName -Scope $Scope -ErrorAction Stop | Out-Null
        Write-Host "     [OK] $RoleName asignado en $Scope" -ForegroundColor Green
        $script:assignmentLog += [PSCustomObject]@{ Role=$RoleName; Scope=$Scope; Status='Assigned' }
    } catch {
        Write-Host "     [FAIL] $RoleName en $Scope -> $($_.Exception.Message)" -ForegroundColor Red
        $script:assignmentLog += [PSCustomObject]@{ Role=$RoleName; Scope=$Scope; Status='Failed'; Error=$_.Exception.Message }
    }
}

Write-Host "Verificando si la App ya existe..." -ForegroundColor Cyan
$spList = Get-AzADServicePrincipal -DisplayName $AppName -ErrorAction SilentlyContinue

if (-not $spList) {
    Write-Host "1. Creando la App Registration y el Service Principal..." -ForegroundColor Cyan
    $sp = New-AzADServicePrincipal -DisplayName $AppName
} else {
    Write-Host "La App ya existe. Reutilizando Service Principal..." -ForegroundColor Yellow
    if ($spList.Count -gt 1) { $sp = $spList[0] } else { $sp = $spList }
}

$ClientId = $sp.AppId
$spId = $sp.Id

Write-Host "2. Generando Client Secret seguro (2 años de validez)..." -ForegroundColor Cyan
$app = Get-AzADApplication -AppId $sp.AppId
$secret = New-AzADAppCredential -ObjectId $app.Id -StartDate (Get-Date) -EndDate (Get-Date).AddYears(2)
$ClientSecret = $secret.SecretText

Write-Host "3. Asignando permisos de Microsoft Graph (Directory.Read.All, Reports.Read.All, User.Read.All)..." -ForegroundColor Cyan
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
    Write-Host "   -> Permisos asignados. Requiere ADMIN CONSENT desde Azure Portal > App Registrations > $AppName > API Permissions" -ForegroundColor Green
} else {
    Write-Host "   -> No se localizaron roles de MS Graph. Asigne Directory.Read.All, Reports.Read.All y User.Read.All manualmente." -ForegroundColor Yellow
}

Write-Host "4. Intentando asignación a nivel MANAGEMENT GROUP raíz (opcional, mejora rendimiento)..." -ForegroundColor Cyan
foreach ($r in @('Reader', 'Cost Management Reader')) {
    Try-AssignRole -ObjectId $spId -RoleName $r -Scope "/providers/Microsoft.Management/managementGroups/$TenantId"
}

Write-Host "5. Asignando roles por SUSCRIPCIÓN (scope autoritativo)..." -ForegroundColor Cyan
${customRoleBootstrapScript}
foreach ($sub in $Subscriptions) {
    Write-Host ""
    Write-Host "   Suscripción $sub" -ForegroundColor Cyan
    Set-AzContext -SubscriptionId $sub -ErrorAction SilentlyContinue | Out-Null

${baseRoles.map(role => `    Try-AssignRole -ObjectId $spId -RoleName "${role}" -Scope "/subscriptions/$sub"`).join('\n')}
${customRoleAssignPerSub}
}

Write-Host ""
Write-Host "6. Asignando lectura de RESERVAS (RIs) a nivel TENANT (Microsoft.Capacity)..." -ForegroundColor Cyan
Write-Host "   Necesario para el panel 'Descuentos por Compromiso (RIs)'. Las reservas viven a nivel tenant," -ForegroundColor DarkGray
Write-Host "   NO por suscripcion; incluye reservas de scope Shared y Single. Requiere que quien ejecute" -ForegroundColor DarkGray
Write-Host "   sea Reservations Administrator u Owner/User Access Administrator en '/providers/Microsoft.Capacity'." -ForegroundColor DarkGray
Try-AssignRole -ObjectId $spId -RoleName "Reservations Reader" -Scope "/providers/Microsoft.Capacity"

Write-Host ""
Write-Host "==============================================================================" -ForegroundColor Green
Write-Host "RESUMEN DE ASIGNACIONES" -ForegroundColor Green
Write-Host "==============================================================================" -ForegroundColor Green
$script:assignmentLog | Group-Object Status | ForEach-Object {
    $color = if ($_.Name -eq 'Failed') { 'Red' } elseif ($_.Name -eq 'Assigned') { 'Green' } else { 'DarkGray' }
    Write-Host "$($_.Name): $($_.Count)" -ForegroundColor $color
}
$failures = $script:assignmentLog | Where-Object { $_.Status -eq 'Failed' }
if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "FALLOS (revisar permisos del usuario que ejecuta el script):" -ForegroundColor Red
    $failures | Format-Table Role, Scope, Error -AutoSize -Wrap
}

Write-Host ""
Write-Host "==============================================================================" -ForegroundColor Green
Write-Host "ONBOARDING COMPLETADO" -ForegroundColor Green
Write-Host "Copie de forma segura el siguiente JSON y envíelo a CSCloudSolutions:" -ForegroundColor Yellow

$output = @{
    TenantId = $TenantId
    Subscriptions = $Subscriptions
    ClientId = $ClientId
    ClientSecret = $ClientSecret
    Tier = "${tier}"
    AssignmentsOk = ($script:assignmentLog | Where-Object { $_.Status -ne 'Failed' }).Count
    AssignmentsFailed = $failures.Count
}

$output | ConvertTo-Json -Depth 5

Write-Host ""
Write-Host "NOTA: El ClientSecret solo es visible UNA VEZ. Si lo pierde, deberá regenerarlo." -ForegroundColor Red
Write-Host "NOTA: Si está usando una suscripción EA/MCA, pídale al Billing Admin que asigne 'Enrollment Reader' o 'Billing Account Reader' al SP para ver datos de billing-account scope." -ForegroundColor Yellow
Write-Host "NOTA: Si 'Reservations Reader' aparece como [FAIL], un Reservations Administrator debe asignarlo manualmente al SP en el scope '/providers/Microsoft.Capacity' (Portal > Reservations > Access control, o 'New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName ''Reservations Reader'' -Scope ''/providers/Microsoft.Capacity'''). Sin este rol, las reservas (RIs) Shared/Single no aparecen en el panel." -ForegroundColor Yellow
`;
}

