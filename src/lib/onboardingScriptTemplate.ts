import { hasAccess } from '@/lib/tierLogic';

// Acciones del custom role de remediación por tier. Única fuente de verdad,
// compartida entre el generador del script de onboarding y el verificador de
// permisos (check-sp-roles), para no duplicar/desincronizar la lista.
export const BUSINESS_CUSTOM_ACTIONS: string[] = [
    "Microsoft.Compute/virtualMachines/deallocate/action",
    "Microsoft.Compute/virtualMachines/start/action",
    "Microsoft.Compute/virtualMachines/restart/action",
    "Microsoft.Compute/virtualMachines/write",
    "Microsoft.Resources/tags/write",
    "Microsoft.Consumption/budgets/read",
    "Microsoft.Consumption/budgets/write",
    "Microsoft.Consumption/budgets/delete",
    // Remediación de Recursos Zombis y Networking Zombies: habilitada desde
    // Business (ver canDeleteResources en src/lib/tierLogic.ts) — sin estas
    // acciones, el DELETE contra Azure devuelve AuthorizationFailed (403)
    // aunque el tenant sea Business/Enterprise.
    "Microsoft.Compute/virtualMachines/delete",
    "Microsoft.Compute/disks/delete",
    "Microsoft.Compute/snapshots/delete",
    "Microsoft.Web/serverfarms/delete",
    "Microsoft.Network/networkInterfaces/delete",
    "Microsoft.Network/publicIPAddresses/delete",
    "Microsoft.Network/networkSecurityGroups/delete",
    // Networking Zombies (expansión): resto de tipos de red con soporte de
    // eliminación en la plataforma (ver armType en
    // src/app/api/cleanup/zombies/networking/route.ts).
    "Microsoft.Network/loadBalancers/delete",
    "Microsoft.Network/applicationGateways/delete",
    "Microsoft.Network/virtualNetworkGateways/delete",
    "Microsoft.Network/virtualNetworks/delete",
    "Microsoft.Network/virtualNetworks/subnets/delete",
    "Microsoft.Network/virtualHubs/delete",
    "Microsoft.Network/expressRouteCircuits/delete",
    "Microsoft.Network/virtualNetworks/virtualNetworkPeerings/delete",
    "Microsoft.Network/azureFirewalls/delete",
    "Microsoft.Network/applicationSecurityGroups/delete",
    "Microsoft.Network/privateEndpoints/delete",
    "Microsoft.Network/privateDnsZones/delete",
    "Microsoft.Network/bastionHosts/delete",
    "Microsoft.Network/ddosProtectionPlans/delete",
    "Microsoft.Network/applicationGatewayWebApplicationFirewallPolicies/delete",
    "Microsoft.Network/frontDoorWebApplicationFirewallPolicies/delete",
    "Microsoft.Network/frontDoors/delete",
    "Microsoft.Cdn/profiles/delete",
    "Microsoft.Network/trafficManagerProfiles/delete",
    "Microsoft.Network/natGateways/delete",
    "Microsoft.Network/dnsZones/delete",
    "Microsoft.Network/networkWatchers/delete",
    "Microsoft.Network/networkWatchers/flowLogs/delete",
];

export const ENTERPRISE_CUSTOM_ACTIONS: string[] = [
    ...BUSINESS_CUSTOM_ACTIONS,
    "Microsoft.Resources/subscriptions/resourceGroups/write",
];

// Nombre canónico del custom role creado por el script de onboarding.
export const CUSTOM_REMEDIATION_ROLE_NAME = 'CSCloudSolutions Remediation Role';

export type ScriptLocale = 'es' | 'en' | 'pt-BR';

// Textos (comentarios y mensajes Write-Host) del script de onboarding, por
// idioma. Se mantienen aquí (no en messages/*.json) porque son contenido de un
// script PowerShell generado server-side, fuera del contexto de request de
// next-intl. Las referencias a variables PowerShell ($RoleName, $Scope, etc.) y
// los nombres de roles RBAC de Azure se dejan literales a propósito.
const SCRIPT_I18N: Record<ScriptLocale, Record<string, string>> = {
    es: {
        hdrDesc1: 'Ejecutar en Azure Cloud Shell (PowerShell). Configura UN SOLO Service Principal',
        hdrDesc2: 'para N suscripciones, con los roles correspondientes al tier contratado.',
        hdrSubRoles: 'Roles que asigna a nivel SUSCRIPCIÓN:',
        hdrTenantRole: 'Rol que asigna a nivel TENANT (Microsoft.Capacity):',
        reservationsReaderDesc: '(lectura de Reservas/RIs Shared y Single para el panel de Compromisos)',
        hdrCustomRole: 'Custom role con permisos de remediación:',
        helperComment: '--- Helper: asigna rol y registra éxito/fallo (no oculta errores reales) ---',
        customRoleComment1: '--- Crear/Actualizar Custom Role UNA SOLA VEZ a nivel directorio ---',
        customRoleComment2: 'Los custom roles son directory-wide. AssignableScopes debe incluir TODAS las subs.',
        whCreatingCustomRole: '4b. Creando/Actualizando Rol Personalizado (directory-wide)...',
        customRoleContext: 'IMPORTANTE: los cmdlets *-AzRoleDefinition operan contra la suscripción del\n# CONTEXTO actual. Fijamos el contexto a la primera suscripción destino para que\n# la creación/actualización sea determinística y no dependa de la sub default de\n# Cloud Shell (que podría no estar en AssignableScopes o no ser controlada).',
        whRoleExists: '   -> Rol ya existe. Actualizando AssignableScopes y Actions...',
        commentEnsureScopes: 'Asegurar que todas las subs estén en AssignableScopes',
        commentEnsureActions: 'Asegurar Actions',
        whRoleUpdated: '   [OK] Rol actualizado.',
        whRoleUpdateFail: '   [FAIL] No se pudo actualizar el rol: $($_.Exception.Message)',
        whCreatingNewRole: '   -> Creando nuevo rol personalizado...',
        roleDescription: 'Permite a CSCloudSolutions ejecutar acciones de FinOps (remediación controlada)',
        commentWaitProp: 'Esperar propagación (Azure tarda ~30-60s en hacer visible un rol nuevo)',
        whWaitProp: '   -> Esperando propagación del rol (máx 90s)...',
        whRoleCreatedProp: '   [OK] Rol creado y propagado.',
        whRoleCreatedNotProp: '   [WARN] Rol creado pero aún no propagado. Re-ejecute el script en unos minutos para asignar.',
        whRoleCreateFail: '   [FAIL] No se pudo crear el rol: $($_.Exception.Message)',
        whAlreadyAssigned: '     [OK] $RoleName ya asignado en $Scope',
        whAssigned: '     [OK] $RoleName asignado en $Scope',
        whAssignFail: '     [FAIL] $RoleName en $Scope -> $($_.Exception.Message)',
        whCheckingApp: 'Verificando si la App ya existe...',
        whCreatingApp: '1. Creando la App Registration y el Service Principal...',
        whAppExists: 'La App ya existe. Reutilizando Service Principal...',
        whGeneratingSecret: '2. Generando Client Secret seguro (2 años de validez)...',
        whAssigningGraph: '3. Asignando permisos de Microsoft Graph',
        whGraphAssigned: '   -> Permisos asignados. Requiere ADMIN CONSENT desde Azure Portal > App Registrations > $AppName > API Permissions',
        whGraphNotFoundPre: '   -> No se localizaron roles de MS Graph. Asigne',
        whGraphNotFoundPost: 'manualmente.',
        whMgmtGroup: '4. Intentando asignación a nivel MANAGEMENT GROUP raíz (opcional, mejora rendimiento)...',
        whAssigningPerSub: '5. Asignando roles por SUSCRIPCIÓN (scope autoritativo)...',
        whSubscription: '   Suscripción $sub',
        whReservations: '6. Asignando lectura de RESERVAS (RIs) a nivel TENANT (Microsoft.Capacity)...',
        whReservationsNote1: "   Necesario para el panel 'Descuentos por Compromiso (RIs)'. Las reservas viven a nivel tenant,",
        whReservationsNote2: '   NO por suscripcion; incluye reservas de scope Shared y Single. Requiere que quien ejecute',
        whReservationsNote3: "   sea Reservations Administrator u Owner/User Access Administrator en '/providers/Microsoft.Capacity'.",
        whSummary: 'RESUMEN DE ASIGNACIONES',
        whFailures: 'FALLOS (revisar permisos del usuario que ejecuta el script):',
        whCompleted: 'ONBOARDING COMPLETADO',
        whCopyJson: 'Copie de forma segura el siguiente JSON y envíelo a CSCloudSolutions:',
        noteSecret: 'NOTA: El ClientSecret solo es visible UNA VEZ. Si lo pierde, deberá regenerarlo.',
        noteEaMca: "NOTA: Si está usando una suscripción EA/MCA, pídale al Billing Admin que asigne 'Enrollment Reader' o 'Billing Account Reader' al SP para ver datos de billing-account scope.",
        noteReservations: "NOTA: Si 'Reservations Reader' aparece como [FAIL], un Reservations Administrator debe asignarlo manualmente al SP en el scope '/providers/Microsoft.Capacity' (Portal > Reservations > Access control, o 'New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName ''Reservations Reader'' -Scope ''/providers/Microsoft.Capacity'''). Sin este rol, las reservas (RIs) Shared/Single no aparecen en el panel.",
    },
    en: {
        hdrDesc1: 'Run in Azure Cloud Shell (PowerShell). Configures a SINGLE Service Principal',
        hdrDesc2: 'for N subscriptions, with the roles matching the contracted tier.',
        hdrSubRoles: 'Roles assigned at SUBSCRIPTION level:',
        hdrTenantRole: 'Role assigned at TENANT level (Microsoft.Capacity):',
        reservationsReaderDesc: '(reads Shared and Single Reservations/RIs for the Commitments panel)',
        hdrCustomRole: 'Custom role with remediation permissions:',
        helperComment: '--- Helper: assigns a role and logs success/failure (does not hide real errors) ---',
        customRoleComment1: '--- Create/Update Custom Role ONCE at the directory level ---',
        customRoleComment2: 'Custom roles are directory-wide. AssignableScopes must include ALL subscriptions.',
        whCreatingCustomRole: '4b. Creating/Updating Custom Role (directory-wide)...',
        customRoleContext: 'IMPORTANT: the *-AzRoleDefinition cmdlets operate against the CURRENT\n# context subscription. We pin the context to the first target subscription so\n# that creation/update is deterministic and does not depend on the Cloud Shell\n# default subscription (which might not be in AssignableScopes or under control).',
        whRoleExists: '   -> Role already exists. Updating AssignableScopes and Actions...',
        commentEnsureScopes: 'Ensure all subscriptions are in AssignableScopes',
        commentEnsureActions: 'Ensure Actions',
        whRoleUpdated: '   [OK] Role updated.',
        whRoleUpdateFail: '   [FAIL] Could not update the role: $($_.Exception.Message)',
        whCreatingNewRole: '   -> Creating new custom role...',
        roleDescription: 'Allows CSCloudSolutions to run FinOps actions (controlled remediation)',
        commentWaitProp: 'Wait for propagation (Azure takes ~30-60s to make a new role visible)',
        whWaitProp: '   -> Waiting for role propagation (max 90s)...',
        whRoleCreatedProp: '   [OK] Role created and propagated.',
        whRoleCreatedNotProp: '   [WARN] Role created but not yet propagated. Re-run the script in a few minutes to assign.',
        whRoleCreateFail: '   [FAIL] Could not create the role: $($_.Exception.Message)',
        whAlreadyAssigned: '     [OK] $RoleName already assigned at $Scope',
        whAssigned: '     [OK] $RoleName assigned at $Scope',
        whAssignFail: '     [FAIL] $RoleName at $Scope -> $($_.Exception.Message)',
        whCheckingApp: 'Checking whether the App already exists...',
        whCreatingApp: '1. Creating the App Registration and the Service Principal...',
        whAppExists: 'The App already exists. Reusing Service Principal...',
        whGeneratingSecret: '2. Generating a secure Client Secret (valid for 2 years)...',
        whAssigningGraph: '3. Assigning Microsoft Graph permissions',
        whGraphAssigned: '   -> Permissions assigned. Requires ADMIN CONSENT from Azure Portal > App Registrations > $AppName > API Permissions',
        whGraphNotFoundPre: '   -> MS Graph roles not found. Assign',
        whGraphNotFoundPost: 'manually.',
        whMgmtGroup: '4. Attempting assignment at the root MANAGEMENT GROUP level (optional, improves performance)...',
        whAssigningPerSub: '5. Assigning roles per SUBSCRIPTION (authoritative scope)...',
        whSubscription: '   Subscription $sub',
        whReservations: '6. Assigning RESERVATIONS (RIs) read access at TENANT level (Microsoft.Capacity)...',
        whReservationsNote1: "   Required for the 'Commitment Discounts (RIs)' panel. Reservations live at tenant level,",
        whReservationsNote2: '   NOT per subscription; includes Shared and Single scope reservations. Requires the executor',
        whReservationsNote3: "   to be Reservations Administrator or Owner/User Access Administrator at '/providers/Microsoft.Capacity'.",
        whSummary: 'ASSIGNMENT SUMMARY',
        whFailures: 'FAILURES (review the permissions of the user running the script):',
        whCompleted: 'ONBOARDING COMPLETED',
        whCopyJson: 'Securely copy the following JSON and send it to CSCloudSolutions:',
        noteSecret: 'NOTE: The ClientSecret is visible ONLY ONCE. If you lose it, you must regenerate it.',
        noteEaMca: "NOTE: If you are using an EA/MCA subscription, ask the Billing Admin to assign 'Enrollment Reader' or 'Billing Account Reader' to the SP to see billing-account scope data.",
        noteReservations: "NOTE: If 'Reservations Reader' shows as [FAIL], a Reservations Administrator must assign it manually to the SP at scope '/providers/Microsoft.Capacity' (Portal > Reservations > Access control, or 'New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName ''Reservations Reader'' -Scope ''/providers/Microsoft.Capacity'''). Without this role, Shared/Single reservations (RIs) do not appear in the panel.",
    },
    'pt-BR': {
        hdrDesc1: 'Execute no Azure Cloud Shell (PowerShell). Configura UM ÚNICO Service Principal',
        hdrDesc2: 'para N assinaturas, com os papéis correspondentes ao tier contratado.',
        hdrSubRoles: 'Papéis atribuídos no nível de ASSINATURA:',
        hdrTenantRole: 'Papel atribuído no nível de TENANT (Microsoft.Capacity):',
        reservationsReaderDesc: '(leitura de Reservas/RIs Shared e Single para o painel de Compromissos)',
        hdrCustomRole: 'Papel personalizado com permissões de remediação:',
        helperComment: '--- Helper: atribui papel e registra sucesso/falha (não oculta erros reais) ---',
        customRoleComment1: '--- Criar/Atualizar Papel Personalizado UMA ÚNICA VEZ no nível do diretório ---',
        customRoleComment2: 'Papéis personalizados são directory-wide. AssignableScopes deve incluir TODAS as assinaturas.',
        whCreatingCustomRole: '4b. Criando/Atualizando Papel Personalizado (directory-wide)...',
        customRoleContext: 'IMPORTANTE: os cmdlets *-AzRoleDefinition operam contra a assinatura do\n# CONTEXTO atual. Fixamos o contexto na primeira assinatura de destino para que\n# a criação/atualização seja determinística e não dependa da assinatura padrão\n# do Cloud Shell (que pode não estar em AssignableScopes ou não ser controlada).',
        whRoleExists: '   -> Papel já existe. Atualizando AssignableScopes e Actions...',
        commentEnsureScopes: 'Garantir que todas as assinaturas estejam em AssignableScopes',
        commentEnsureActions: 'Garantir Actions',
        whRoleUpdated: '   [OK] Papel atualizado.',
        whRoleUpdateFail: '   [FAIL] Não foi possível atualizar o papel: $($_.Exception.Message)',
        whCreatingNewRole: '   -> Criando novo papel personalizado...',
        roleDescription: 'Permite que a CSCloudSolutions execute ações de FinOps (remediação controlada)',
        commentWaitProp: 'Aguardar propagação (o Azure leva ~30-60s para tornar um papel novo visível)',
        whWaitProp: '   -> Aguardando propagação do papel (máx 90s)...',
        whRoleCreatedProp: '   [OK] Papel criado e propagado.',
        whRoleCreatedNotProp: '   [WARN] Papel criado mas ainda não propagado. Re-execute o script em alguns minutos para atribuir.',
        whRoleCreateFail: '   [FAIL] Não foi possível criar o papel: $($_.Exception.Message)',
        whAlreadyAssigned: '     [OK] $RoleName já atribuído em $Scope',
        whAssigned: '     [OK] $RoleName atribuído em $Scope',
        whAssignFail: '     [FAIL] $RoleName em $Scope -> $($_.Exception.Message)',
        whCheckingApp: 'Verificando se o App já existe...',
        whCreatingApp: '1. Criando o App Registration e o Service Principal...',
        whAppExists: 'O App já existe. Reutilizando Service Principal...',
        whGeneratingSecret: '2. Gerando Client Secret seguro (2 anos de validade)...',
        whAssigningGraph: '3. Atribuindo permissões do Microsoft Graph',
        whGraphAssigned: '   -> Permissões atribuídas. Requer ADMIN CONSENT no Azure Portal > App Registrations > $AppName > API Permissions',
        whGraphNotFoundPre: '   -> Papéis do MS Graph não localizados. Atribua',
        whGraphNotFoundPost: 'manualmente.',
        whMgmtGroup: '4. Tentando atribuição no nível do MANAGEMENT GROUP raiz (opcional, melhora o desempenho)...',
        whAssigningPerSub: '5. Atribuindo papéis por ASSINATURA (escopo autoritativo)...',
        whSubscription: '   Assinatura $sub',
        whReservations: '6. Atribuindo leitura de RESERVAS (RIs) no nível de TENANT (Microsoft.Capacity)...',
        whReservationsNote1: "   Necessário para o painel 'Descontos por Compromisso (RIs)'. As reservas ficam no nível do tenant,",
        whReservationsNote2: '   NÃO por assinatura; inclui reservas de escopo Shared e Single. Requer que quem executa',
        whReservationsNote3: "   seja Reservations Administrator ou Owner/User Access Administrator em '/providers/Microsoft.Capacity'.",
        whSummary: 'RESUMO DAS ATRIBUIÇÕES',
        whFailures: 'FALHAS (revise as permissões do usuário que executa o script):',
        whCompleted: 'ONBOARDING CONCLUÍDO',
        whCopyJson: 'Copie com segurança o JSON a seguir e envie-o à CSCloudSolutions:',
        noteSecret: 'NOTA: O ClientSecret só é visível UMA VEZ. Se você o perder, deverá regenerá-lo.',
        noteEaMca: "NOTA: Se estiver usando uma assinatura EA/MCA, peça ao Billing Admin que atribua 'Enrollment Reader' ou 'Billing Account Reader' ao SP para ver dados de escopo billing-account.",
        noteReservations: "NOTA: Se 'Reservations Reader' aparecer como [FAIL], um Reservations Administrator deve atribuí-lo manualmente ao SP no escopo '/providers/Microsoft.Capacity' (Portal > Reservations > Access control, ou 'New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName ''Reservations Reader'' -Scope ''/providers/Microsoft.Capacity'''). Sem esse papel, as reservas (RIs) Shared/Single não aparecem no painel.",
    },
};

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

export function generateOnboardingScript(clientTenantId: string, subscriptionIdsStr: string, tier: string = 'Essential', locale: string = 'es'): string {
    const S = SCRIPT_I18N[(locale as ScriptLocale)] ?? SCRIPT_I18N.es;
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
        'Security Reader',         // lectura de Microsoft.Security/* (Defender/WAF posture)
    ];

    const baseRoles = [...essentialRoles];
    const customActions: string[] = getCustomRoleActionsForTier(tier);

    // Tag Contributor (auto-fix de Cumplimiento de Etiquetas): remediación
    // habilitada desde Business (ver canRemediateTags en tierLogic.ts) —
    // Essential/Professional solo ven el score de cumplimiento.
    if (tier === 'Business') {
        baseRoles.push('Tag Contributor'); // auto-tagging + custom role (power mgmt + budgets)
    } else if (tier === 'Enterprise') {
        baseRoles.push('Tag Contributor');
        baseRoles.push('Monitoring Contributor'); // workbooks deploy + métricas avanzadas
    }

    // AuditLog.Read.All habilita signInActivity en la lectura de usuarios de
    // Microsoft Graph (ver m365UsersService.ts), consumido únicamente por
    // "Usuarios y Licencias" (/intelligence/licenses, requiredTier: Enterprise
    // en Sidebar.tsx). Se otorga solo a los tiers con acceso a esa página.
    const needsAuditLog = hasAccess(tier, 'Enterprise');
    const graphPermsLabel = needsAuditLog
        ? 'Directory.Read.All, Reports.Read.All, User.Read.All, Organization.Read.All, AuditLog.Read.All'
        : 'Directory.Read.All, Reports.Read.All, User.Read.All, Organization.Read.All';
    const auditLogRoleLookup = needsAuditLog
        ? `$AuditRole = $GraphSp.AppRole | Where-Object { $_.Value -eq "AuditLog.Read.All" -and $_.AllowedMemberType -contains "Application" }\n`
        : '';
    const auditLogCondition = needsAuditLog ? ' -and $AuditRole' : '';
    const auditLogAssignBlock = needsAuditLog
        ? `\n    $bodyAudit = @{ principalId = $sp.Id; resourceId = $GraphSp.Id; appRoleId = $AuditRole.Id } | ConvertTo-Json -Depth 5\n    Invoke-AzRestMethod -Method Post -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$($sp.Id)/appRoleAssignments" -Payload $bodyAudit -ErrorAction SilentlyContinue | Out-Null`
        : '';
    const graphPermsManualHint = needsAuditLog
        ? 'Directory.Read.All, Reports.Read.All, User.Read.All, Organization.Read.All y AuditLog.Read.All'
        : 'Directory.Read.All, Reports.Read.All, User.Read.All y Organization.Read.All';

    const subList = subscriptions.map(s => `"${s}"`).join(", ");

    const customRoleActionsBlock = customActions.length > 0
        ? customActions.map(a => `        "${a}"`).join(',\n')
        : '';

    const customRoleBootstrapScript = customActions.length > 0 ? `
# ${S.customRoleComment1}
# ${S.customRoleComment2}
Write-Host "${S.whCreatingCustomRole}" -ForegroundColor Cyan

# ${S.customRoleContext}
Set-AzContext -SubscriptionId $Subscriptions[0] -ErrorAction SilentlyContinue | Out-Null

$customActions = @(
${customRoleActionsBlock}
)
$assignableScopes = $Subscriptions | ForEach-Object { "/subscriptions/$_" }

$existingCustom = Get-AzRoleDefinition -Name $RoleName -ErrorAction SilentlyContinue

if ($existingCustom) {
    Write-Host "${S.whRoleExists}" -ForegroundColor Yellow
    try {
        # ${S.commentEnsureScopes}
        $currentScopes = @($existingCustom.AssignableScopes)
        $merged = ($currentScopes + $assignableScopes) | Select-Object -Unique
        $existingCustom.AssignableScopes.Clear()
        foreach ($s in $merged) { $existingCustom.AssignableScopes.Add($s) }

        # ${S.commentEnsureActions}
        if ($null -ne $existingCustom.Permissions -and $existingCustom.Permissions.Count -gt 0) {
            $existingCustom.Permissions[0].Actions.Clear()
            foreach ($a in $customActions) { $existingCustom.Permissions[0].Actions.Add($a) }
        } elseif ($null -ne $existingCustom.Actions) {
            $existingCustom.Actions.Clear()
            foreach ($a in $customActions) { $existingCustom.Actions.Add($a) }
        }

        Set-AzRoleDefinition -Role $existingCustom -ErrorAction Stop | Out-Null
        Write-Host "${S.whRoleUpdated}" -ForegroundColor Green
        $customRoleReady = $true
    } catch {
        Write-Host "${S.whRoleUpdateFail}" -ForegroundColor Red
        $customRoleReady = $false
    }
} else {
    Write-Host "${S.whCreatingNewRole}" -ForegroundColor Cyan
    try {
        $roleDef = Get-AzRoleDefinition -Name "Reader"
        $roleDef.Id = $null
        $roleDef.IsCustom = $true
        $roleDef.Name = $RoleName
        $roleDef.Description = "${S.roleDescription}"

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

        # ${S.commentWaitProp}
        Write-Host "${S.whWaitProp}" -ForegroundColor DarkGray
        $customRoleReady = $false
        for ($i = 0; $i -lt 18; $i++) {
            Start-Sleep -Seconds 5
            $check = Get-AzRoleDefinition -Name $RoleName -ErrorAction SilentlyContinue
            if ($check) { $customRoleReady = $true; break }
        }
        if ($customRoleReady) {
            Write-Host "${S.whRoleCreatedProp}" -ForegroundColor Green
        } else {
            Write-Host "${S.whRoleCreatedNotProp}" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "${S.whRoleCreateFail}" -ForegroundColor Red
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
# ${S.hdrDesc1}
# ${S.hdrDesc2}
#
# ${S.hdrSubRoles}
#   ${baseRoles.map(r => `* ${r}`).join('\n#   ')}
#
# ${S.hdrTenantRole}
#   * Reservations Reader  ${S.reservationsReaderDesc}
${customActions.length > 0 ? `#
# ${S.hdrCustomRole}
#   ${customActions.map(a => `* ${a}`).join('\n#   ')}` : ''}
# ==============================================================================

$TenantId = "${clientTenantId}"
$Subscriptions = @(${subList})
$AppName = "CSCloudSolutions-FinOps-Agent"
$RoleName = "${CUSTOM_REMEDIATION_ROLE_NAME}"

# Silenciar warnings cosméticos de breaking changes de Az PowerShell
$WarningPreference = 'SilentlyContinue'
$env:SuppressAzurePowerShellBreakingChangeWarnings = 'true'

# ${S.helperComment}
$script:assignmentLog = @()
function Try-AssignRole {
    param([string]$ObjectId, [string]$RoleName, [string]$Scope)
    try {
        $existing = Get-AzRoleAssignment -ObjectId $ObjectId -Scope $Scope -RoleDefinitionName $RoleName -ErrorAction SilentlyContinue
        if ($existing) {
            Write-Host "${S.whAlreadyAssigned}" -ForegroundColor DarkGray
            $script:assignmentLog += [PSCustomObject]@{ Role=$RoleName; Scope=$Scope; Status='AlreadyExists' }
            return
        }
        New-AzRoleAssignment -ObjectId $ObjectId -RoleDefinitionName $RoleName -Scope $Scope -ErrorAction Stop | Out-Null
        Write-Host "${S.whAssigned}" -ForegroundColor Green
        $script:assignmentLog += [PSCustomObject]@{ Role=$RoleName; Scope=$Scope; Status='Assigned' }
    } catch {
        Write-Host "${S.whAssignFail}" -ForegroundColor Red
        $script:assignmentLog += [PSCustomObject]@{ Role=$RoleName; Scope=$Scope; Status='Failed'; Error=$_.Exception.Message }
    }
}

Write-Host "${S.whCheckingApp}" -ForegroundColor Cyan
$spList = Get-AzADServicePrincipal -DisplayName $AppName -ErrorAction SilentlyContinue

if (-not $spList) {
    Write-Host "${S.whCreatingApp}" -ForegroundColor Cyan
    $sp = New-AzADServicePrincipal -DisplayName $AppName
} else {
    Write-Host "${S.whAppExists}" -ForegroundColor Yellow
    if ($spList.Count -gt 1) { $sp = $spList[0] } else { $sp = $spList }
}

$ClientId = $sp.AppId
$spId = $sp.Id

Write-Host "${S.whGeneratingSecret}" -ForegroundColor Cyan
$app = Get-AzADApplication -AppId $sp.AppId
$secret = New-AzADAppCredential -ObjectId $app.Id -StartDate (Get-Date) -EndDate (Get-Date).AddYears(2)
$ClientSecret = $secret.SecretText

Write-Host "${S.whAssigningGraph} (${graphPermsLabel})..." -ForegroundColor Cyan
$GraphSp = Get-AzADServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'"
$DirRole = $GraphSp.AppRole | Where-Object { $_.Value -eq "Directory.Read.All" -and $_.AllowedMemberType -contains "Application" }
$RepRole = $GraphSp.AppRole | Where-Object { $_.Value -eq "Reports.Read.All" -and $_.AllowedMemberType -contains "Application" }
$UserRole = $GraphSp.AppRole | Where-Object { $_.Value -eq "User.Read.All" -and $_.AllowedMemberType -contains "Application" }
$OrgRole = $GraphSp.AppRole | Where-Object { $_.Value -eq "Organization.Read.All" -and $_.AllowedMemberType -contains "Application" }
${auditLogRoleLookup}
if ($DirRole -and $RepRole -and $UserRole -and $OrgRole${auditLogCondition}) {
    $bodyDir = @{ principalId = $sp.Id; resourceId = $GraphSp.Id; appRoleId = $DirRole.Id } | ConvertTo-Json -Depth 5
    $bodyRep = @{ principalId = $sp.Id; resourceId = $GraphSp.Id; appRoleId = $RepRole.Id } | ConvertTo-Json -Depth 5
    $bodyUser = @{ principalId = $sp.Id; resourceId = $GraphSp.Id; appRoleId = $UserRole.Id } | ConvertTo-Json -Depth 5
    $bodyOrg = @{ principalId = $sp.Id; resourceId = $GraphSp.Id; appRoleId = $OrgRole.Id } | ConvertTo-Json -Depth 5

    Invoke-AzRestMethod -Method Post -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$($sp.Id)/appRoleAssignments" -Payload $bodyDir -ErrorAction SilentlyContinue | Out-Null
    Invoke-AzRestMethod -Method Post -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$($sp.Id)/appRoleAssignments" -Payload $bodyRep -ErrorAction SilentlyContinue | Out-Null
    Invoke-AzRestMethod -Method Post -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$($sp.Id)/appRoleAssignments" -Payload $bodyUser -ErrorAction SilentlyContinue | Out-Null${auditLogAssignBlock}
    Invoke-AzRestMethod -Method Post -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$($sp.Id)/appRoleAssignments" -Payload $bodyOrg -ErrorAction SilentlyContinue | Out-Null
    Write-Host "${S.whGraphAssigned}" -ForegroundColor Green
} else {
    Write-Host "${S.whGraphNotFoundPre} ${graphPermsManualHint} ${S.whGraphNotFoundPost}" -ForegroundColor Yellow
}

Write-Host "${S.whMgmtGroup}" -ForegroundColor Cyan
foreach ($r in @('Reader', 'Cost Management Reader')) {
    Try-AssignRole -ObjectId $spId -RoleName $r -Scope "/providers/Microsoft.Management/managementGroups/$TenantId"
}

Write-Host "${S.whAssigningPerSub}" -ForegroundColor Cyan
${customRoleBootstrapScript}
foreach ($sub in $Subscriptions) {
    Write-Host ""
    Write-Host "${S.whSubscription}" -ForegroundColor Cyan
    Set-AzContext -SubscriptionId $sub -ErrorAction SilentlyContinue | Out-Null

${baseRoles.map(role => `    Try-AssignRole -ObjectId $spId -RoleName "${role}" -Scope "/subscriptions/$sub"`).join('\n')}
${customRoleAssignPerSub}
}

Write-Host ""
Write-Host "${S.whReservations}" -ForegroundColor Cyan
Write-Host "${S.whReservationsNote1}" -ForegroundColor DarkGray
Write-Host "${S.whReservationsNote2}" -ForegroundColor DarkGray
Write-Host "${S.whReservationsNote3}" -ForegroundColor DarkGray
Try-AssignRole -ObjectId $spId -RoleName "Reservations Reader" -Scope "/providers/Microsoft.Capacity"

Write-Host ""
Write-Host "==============================================================================" -ForegroundColor Green
Write-Host "${S.whSummary}" -ForegroundColor Green
Write-Host "==============================================================================" -ForegroundColor Green
$script:assignmentLog | Group-Object Status | ForEach-Object {
    $color = if ($_.Name -eq 'Failed') { 'Red' } elseif ($_.Name -eq 'Assigned') { 'Green' } else { 'DarkGray' }
    Write-Host "$($_.Name): $($_.Count)" -ForegroundColor $color
}
$failures = $script:assignmentLog | Where-Object { $_.Status -eq 'Failed' }
if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "${S.whFailures}" -ForegroundColor Red
    $failures | Format-Table Role, Scope, Error -AutoSize -Wrap
}

Write-Host ""
Write-Host "==============================================================================" -ForegroundColor Green
Write-Host "${S.whCompleted}" -ForegroundColor Green
Write-Host "${S.whCopyJson}" -ForegroundColor Yellow

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
Write-Host "${S.noteSecret}" -ForegroundColor Red
Write-Host "${S.noteEaMca}" -ForegroundColor Yellow
Write-Host "${S.noteReservations}" -ForegroundColor Yellow
`;
}
