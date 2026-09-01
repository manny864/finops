import type { AdvisorAiActionType, AdvisorRecommendation, AdvisorSuggestedAction } from "@/types/azureAdvisor.types";
import { resolveRecommendedSku } from "./advisorI18n";

/** Reemplaza `{clave}` por `vars.clave` (o "" si falta). Usado tanto para
 *  interpolar la plantilla determinista como, en advisorRemediationNarration.ts,
 *  la plantilla reescrita por IA -- mismo formato de placeholder en los dos
 *  lados para no duplicar la logica de sustitucion. */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

/**
 * Sintetiza la accion concreta de remediacion para una recomendacion de Advisor.
 *
 * Es un motor deterministico, no una llamada a un LLM: se ejecuta sobre cada
 * recomendacion de cada suscripcion en cada carga (cientos por tenant), donde una
 * inferencia por item costaria segundos y dinero para producir exactamente la
 * misma respuesta que estas reglas — el payload de Advisor ya trae el tipo de
 * recurso, `extendedProperties.targetSku`, la utilizacion de CPU y el ahorro.
 *
 * MEJ-06: `actionType`/`targetSku`/`estimatedMonthlySavingsUSD`/`actionTitle`
 * siguen 100% deterministicos siempre. Solo `actionDescription` puede llegar
 * reescrito con IA de forma opcional y best-effort -- ver
 * advisorRemediationNarration.ts, que usa `ruleKey`/`descriptionTemplate` para
 * cachear la reescritura por regla (no por recurso ni por tenant) y nunca le
 * manda a la IA datos concretos del recurso. Si en el futuro se quiere ademas
 * adaptar el tono al interlocutor (tecnico vs financiero), envolver esta salida con
 * `src/modules/core/aiProvider.ts` y cachearla por recommendationTypeId.
 *
 * Regla dura (bug reportado): NUNCA sugerir gobernanza de etiquetas salvo que la
 * recomendacion venga explicitamente de una regla de etiquetado — antes cualquier
 * recomendacion sin rama propia caia en "gestion de etiquetas".
 */
export function generateAdvisorRemediationAction(
  rec: Partial<AdvisorRecommendation>
): AdvisorSuggestedAction {
  const ext = rec.extendedProperties || {};
  const type = (rec.resource?.resourceType || rec.serviceName || "").toLowerCase();
  const title = `${rec.titleTranslated || rec.name || ""} ${rec.descriptionTranslated || ""}`.toLowerCase();
  const monthly = Number(rec.monthlySavingsUSD || 0);
  const targetSku = resolveRecommendedSku(ext, rec.descriptionTranslated || rec.titleTranslated) || ext.targetSku;
  const cpu = Number(
    ext.cpuUtilization ?? ext.CpuUtilization ?? ext.maxCpuUtilization ?? ext.p95CPU ?? NaN
  );
  const name = rec.resourceName && rec.resourceName !== "—" ? rec.resourceName : "el recurso";

  // `ruleKey` identifica la rama tomada (no siempre == actionType: DELETE_ZOMBIE
  // cubre dos textos distintos segun el tipo de recurso huerfano). `template`
  // lleva {name}/{skuText}/{cpuText} sin interpolar -- es lo unico que
  // advisorRemediationNarration.ts manda a reescribir con IA, cacheado por
  // ruleKey+locale y compartido entre recomendaciones (MEJ-06).
  const build = (
    actionType: AdvisorAiActionType,
    actionTitle: string,
    ruleKey: string,
    descriptionTemplate: string,
    descriptionVars: Record<string, string>
  ): AdvisorSuggestedAction => ({
    actionTitle,
    actionDescription: interpolate(descriptionTemplate, descriptionVars),
    actionType,
    targetSku: targetSku || undefined,
    estimatedMonthlySavingsUSD: monthly,
    ruleKey,
    descriptionTemplate,
    descriptionVars,
  });

  // Etiquetado: solo cuando la regla es de etiquetado de verdad.
  if (/\btags?\b|etiquet|tagging/i.test(title)) {
    return build(
      "UPDATE_TAGS",
      "Completar etiquetas FinOps obligatorias",
      "UPDATE_TAGS",
      "Aplicar las etiquetas de gobernanza (CostCenter, Environment, Owner) sobre {name} para habilitar showback y chargeback.",
      { name }
    );
  }

  if (/reserved|capacity|savings.?plan|reserva/i.test(title) || !!ext.term) {
    return build(
      "PURCHASE_RESERVATION",
      "Adquirir Instancia Reservada / Savings Plan",
      "PURCHASE_RESERVATION",
      "El consumo de {name} es estable y sostenido: contratar el compromiso recomendado convierte tarifa on-demand en tarifa reservada.",
      { name }
    );
  }

  if (/hybrid.?benefit|ahub|licen/i.test(title)) {
    return build(
      "APPLY_AHUB",
      "Activar Ventaja Hibrida de Azure (AHUB)",
      "APPLY_AHUB",
      "Aplicar las licencias con Software Assurance ya adquiridas a {name} para dejar de pagar la licencia incluida en el precio de Azure.",
      { name }
    );
  }

  // Discos / IPs / recursos huerfanos.
  if (
    /disks?$|snapshots?$|publicipaddresses$/i.test(type) &&
    /unattached|sin conexi|hu[eé]rfan|no asociad|orphan|unused|no utilizada/i.test(title)
  ) {
    return build(
      "DELETE_ZOMBIE",
      "Instantanea de respaldo y purga del recurso huerfano",
      "DELETE_ZOMBIE_ORPHAN",
      "{name} no esta asociado a ningun recurso activo. Tomar una instantanea de resguardo y eliminarlo detiene el cargo recurrente.",
      { name }
    );
  }

  if (/serverfarms$|appserviceplan/i.test(type) || /app service plan/i.test(title)) {
    return build(
      "DELETE_ZOMBIE",
      "Consolidar o eliminar el App Service Plan",
      "DELETE_ZOMBIE_APPPLAN",
      "{name} no tiene instancias activas asociadas. Consolidar las apps en un plan compartido o eliminarlo libera el costo del plan completo.",
      { name }
    );
  }

  if (/backup|copia de seguridad|recuperaci|availability zone|zona de disponibilidad|redundan/i.test(title)) {
    return build(
      "ENABLE_HA",
      "Configurar respaldo y redundancia",
      "ENABLE_HA",
      "Habilitar la politica de respaldo en un Recovery Services Vault (o distribuir {name} en zonas de disponibilidad) para cumplir el objetivo de recuperacion.",
      { name }
    );
  }

  if (/storageaccounts$|blob/i.test(type) || /lifecycle|ciclo de vida|almacenamiento|storage/i.test(title)) {
    return build(
      "PURGE_STORAGE",
      "Aplicar politica de ciclo de vida al almacenamiento",
      "PURGE_STORAGE",
      "Mover los blobs frios de {name} a Cool/Archive y purgar versiones obsoletas segun la politica de retencion.",
      { name }
    );
  }

  if (
    /virtualmachines$|virtualmachinescalesets$|redis$|servers$|databases$|managedinstances$/i.test(type) ||
    /right.?size|redimensionar|subutilizad|underutilized|sku/i.test(title) ||
    (Number.isFinite(cpu) && cpu < 10)
  ) {
    const skuText = targetSku ? ` al SKU ${targetSku}` : " a un SKU de menor capacidad";
    const cpuText = Number.isFinite(cpu) ? ` La utilizacion de CPU observada es del ${cpu}%.` : "";
    return build(
      "RIGHTSIZE",
      `Redimensionar ${name}${targetSku ? ` a ${targetSku}` : ""}`,
      "RIGHTSIZE",
      "Reducir la capacidad aprovisionada{skuText} manteniendo el margen de cabecera.{cpuText}",
      { skuText, cpuText }
    );
  }

  return build(
    "REVIEW",
    "Revisar la recomendacion sobre el recurso",
    "REVIEW",
    "Azure Advisor detecto una desviacion en {name}. Inspeccionar la configuracion actual antes de aplicar el cambio.",
    { name }
  );
}

export function buildAdvisorRemediationCommand(rec: Partial<AdvisorRecommendation>): {
  cli: string;
  powerShell: string;
} {
  const actionType = rec.actionType || "OPTIMIZE";
  const rg = rec.resourceGroup || "rg-prod";
  const name = rec.resourceName || "recurso-azure";
  const subId = rec.subscriptionId || "00000000-0000-0000-0000-000000000000";
  const service = (rec.serviceName || "").toLowerCase();
  const category = (rec.category || "").toLowerCase();
  const title = (rec.titleTranslated || rec.name || "").toLowerCase();
  const desc = (rec.descriptionTranslated || "").toLowerCase();
  const ext = rec.extendedProperties || {};
  const resourceId = rec.resourceId || "";
  // `serviceName` viene del ARM id (segmento de tipo: "virtualMachines",
  // "Redis", "servers"), no del nombre comercial del servicio. Solo emitimos
  // comandos de VM cuando el recurso realmente es una VM (o cuando no sabemos
  // el tipo): un rightsizing de Redis con `az vm resize` es inejecutable.
  const isVmLike = !service || service.includes("virtualmachine") || service.includes("virtual machine") || service.includes("compute");
  const targetSku =
    resolveRecommendedSku(ext, rec.descriptionTranslated || rec.titleTranslated) ||
    ext.targetSku ||
    "Standard_D4s_v5";

  // 1. Reservas / Savings Plan / Compromiso
  if (
    actionType === "PURCHASE_RESERVATION" ||
    actionType === "SIMULATE_RESERVATION" ||
    title.includes("reservada") ||
    title.includes("reserved") ||
    title.includes("savings plan") ||
    desc.includes("instancias reservadas")
  ) {
    const term = rec.selectedTerm?.includes("3") ? "P3Y" : "P1Y";
    const psTerm = rec.selectedTerm?.includes("3") ? "P3Y" : "P1Y";
    return {
      cli: `# Azure CLI: Calcular y simular adquisición de Instancia Reservada
az reservations reservation-order calculate \\
  --applied-scope-type Single \\
  --applied-scope "/subscriptions/${subId}" \\
  --sku "${targetSku}" \\
  --term "${term}" \\
  --quantity 1 \\
  --display-name "RI-${name}-${targetSku}"`,
      powerShell: `# Azure PowerShell: Adquisición de Instancia Reservada (RI)
New-AzReservation \\
  -AppliedScopeType Single \\
  -AppliedScope "/subscriptions/${subId}" \\
  -Sku "${targetSku}" \\
  -Term "${psTerm}" \\
  -Quantity 1 \\
  -DisplayName "RI-${name}-${targetSku}"`,
    };
  }

  // 2. Ventaja Híbrida de Azure (AHUB)
  if (
    actionType === "APPLY_AHUB" ||
    title.includes("híbrida") ||
    title.includes("hybrid") ||
    title.includes("ahub") ||
    desc.includes("software assurance")
  ) {
    if (service.includes("sql") || title.includes("sql")) {
      return {
        cli: `# Azure CLI: Activar Ventaja Híbrida de Azure (AHUB) en Azure SQL
az sql db update \\
  --resource-group "${rg}" \\
  --server "${name}-srv" \\
  --name "${name}" \\
  --license-type BasePrice`,
        powerShell: `# Azure PowerShell: Activar Ventaja Híbrida (AHUB) en Azure SQL
Set-AzSqlDatabase \\
  -ResourceGroupName "${rg}" \\
  -ServerName "${name}-srv" \\
  -DatabaseName "${name}" \\
  -LicenseType "BasePrice"`,
      };
    }
    return {
      cli: `# Azure CLI: Activar Ventaja Híbrida de Azure (AHUB) para Windows Server
az vm update \\
  --resource-group "${rg}" \\
  --name "${name}" \\
  --license-type Windows_Server`,
      powerShell: `# Azure PowerShell: Activar Ventaja Híbrida (AHUB) en Máquina Virtual
Update-AzVM \\
  -ResourceGroupName "${rg}" \\
  -Name "${name}" \\
  -LicenseType "Windows_Server"`,
    };
  }

  // 3. Discos Huérfanos / Desconectados
  if (
    actionType === "DELETE_DISK" ||
    title.includes("disco") ||
    title.includes("disk") ||
    desc.includes("unattached") ||
    desc.includes("sin conexión") ||
    desc.includes("disco administrado")
  ) {
    return {
      cli: `# Azure CLI: Eliminar disco administrado huérfano / sin conexión
az disk delete \\
  --resource-group "${rg}" \\
  --name "${name}" \\
  --yes`,
      powerShell: `# Azure PowerShell: Eliminar disco huérfano
Remove-AzDisk \\
  -ResourceGroupName "${rg}" \\
  -DiskName "${name}" \\
  -Force`,
    };
  }

  // 4. IPs Públicas sin asociar
  if (
    actionType === "DELETE_IP" ||
    title.includes("ip pública") ||
    title.includes("public ip") ||
    desc.includes("ip no utilizada")
  ) {
    return {
      cli: `# Azure CLI: Liberar dirección IP pública no asociada
az network public-ip delete \\
  --resource-group "${rg}" \\
  --name "${name}"`,
      powerShell: `# Azure PowerShell: Liberar IP pública
Remove-AzPublicIpAddress \\
  -ResourceGroupName "${rg}" \\
  -Name "${name}" \\
  -Force`,
    };
  }

  // 5. Apagado / Desasignación de VM ociosa
  if (
    title.includes("apagar") ||
    title.includes("shut down") ||
    title.includes("desasignar") ||
    title.includes("deallocate") ||
    desc.includes("apagar instancias") ||
    desc.includes("detener y desasignar")
  ) {
    return {
      cli: `# Azure CLI: Desasignar (detener cómputo) máquina virtual ociosa
az vm deallocate \\
  --resource-group "${rg}" \\
  --name "${name}"`,
      powerShell: `# Azure PowerShell: Detener y desasignar VM ociosa
Stop-AzVM \\
  -ResourceGroupName "${rg}" \\
  -Name "${name}" \\
  -Force`,
    };
  }

  // 5b. Azure Cache for Redis — escalado de SKU / capacidad.
  if (service.includes("redis") || service.includes("cache") || title.includes("redis")) {
    return {
      cli: `# Azure CLI: Ajustar SKU / capacidad de Azure Cache for Redis
az redis update \\
  --resource-group "${rg}" \\
  --name "${name}" \\
  --set "sku.capacity=1"`,
      powerShell: `# Azure PowerShell: Ajustar tamaño de Azure Cache for Redis
Set-AzRedisCache \\
  -ResourceGroupName "${rg}" \\
  -Name "${name}" \\
  -Size "C1"`,
    };
  }

  // 6. Redimensionamiento / Rightsizing de VM
  if (
    actionType === "RESIZE" ||
    title.includes("redimensionar") ||
    title.includes("right-size") ||
    title.includes("rightsize") ||
    title.includes("subutilizada") ||
    title.includes("underutilized") ||
    service.includes("virtualmachine") ||
    service.includes("compute")
  ) {
    if (!isVmLike) {
      return resourceId
        ? {
            cli: `# Azure CLI: Revisar la recomendación de Advisor sobre este recurso
az resource show --ids "${resourceId}" -o jsonc`,
            powerShell: `# Azure PowerShell: Revisar el recurso alcanzado por la recomendación
Get-AzResource -ResourceId "${resourceId}" | Format-List *`,
          }
        : {
            cli: `# Azure CLI: Localizar el recurso de la recomendación
az resource list --resource-group "${rg}" --name "${name}" -o table`,
            powerShell: `# Azure PowerShell: Localizar el recurso de la recomendación
Get-AzResource -ResourceGroupName "${rg}" -Name "${name}" | Format-List *`,
          };
    }
    return {
      cli: `# Azure CLI: Redimensionar Máquina Virtual a SKU optimizado
az vm resize \\
  --resource-group "${rg}" \\
  --name "${name}" \\
  --size "${targetSku}"`,
      powerShell: `# Azure PowerShell: Redimensionar Máquina Virtual
Update-AzVM \\
  -ResourceGroupName "${rg}" \\
  -Name "${name}" \\
  -Size "${targetSku}"`,
    };
  }

  // 7. Azure SQL Database Scaling / DTU / vCore
  if (service.includes("sql") || title.includes("sql") || title.includes("database")) {
    return {
      cli: `# Azure CLI: Ajustar nivel de servicio / capacidad en Azure SQL Database
az sql db update \\
  --resource-group "${rg}" \\
  --server "${name}-srv" \\
  --name "${name}" \\
  --service-objective "${targetSku}"`,
      powerShell: `# Azure PowerShell: Ajustar escala en Azure SQL Database
Set-AzSqlDatabase \\
  -ResourceGroupName "${rg}" \\
  -ServerName "${name}-srv" \\
  -DatabaseName "${name}" \\
  -RequestedServiceObjectiveName "${targetSku}"`,
    };
  }

  // 8. Storage Lifecycle Management / Blobs
  if (
    actionType === "ENABLE_LIFECYCLE" ||
    service.includes("storage") ||
    title.includes("storage") ||
    title.includes("almacenamiento") ||
    title.includes("blob") ||
    title.includes("ciclo de vida") ||
    title.includes("lifecycle")
  ) {
    return {
      cli: `# Azure CLI: Configurar política de ciclo de vida (Tier Cool / Archive)
az storage account management-policy create \\
  --account-name "${name.toLowerCase().replace(/[^a-z0-9]/g, "")}" \\
  --resource-group "${rg}" \\
  --policy '{
    "rules": [
      {
        "enabled": true,
        "name": "tierToCoolAndArchive",
        "type": "Lifecycle",
        "definition": {
          "actions": {
            "baseBlob": {
              "tierToCool": { "daysAfterModificationGreaterThan": 30 },
              "tierToArchive": { "daysAfterModificationGreaterThan": 90 }
            }
          },
          "filters": { "blobTypes": [ "blockBlob" ] }
        }
      }
    ]
  }'`,
      powerShell: `# Azure PowerShell: Configurar regla de ciclo de vida en Storage Account
$rule = New-AzStorageAccountManagementPolicyFilter -BlobType blockBlob
$action = New-AzStorageAccountManagementPolicyAction -BaseBlobTierToCoolDaysAfterModificationGreaterThan 30 -BaseBlobTierToArchiveDaysAfterModificationGreaterThan 90
$ruleObj = New-AzStorageAccountManagementPolicyRule -Name "tierToCoolAndArchive" -Action $action -Filter $rule
Set-AzStorageAccountManagementPolicy -ResourceGroupName "${rg}" -StorageAccountName "${name.toLowerCase().replace(/[^a-z0-9]/g, "")}" -Rule $ruleObj`,
    };
  }

  // 9. App Service Plan Scaling
  if (service.includes("app service") || title.includes("app service") || title.includes("plan")) {
    return {
      cli: `# Azure CLI: Escalar App Service Plan a nivel optimizado
az appservice plan update \\
  --name "${name}" \\
  --resource-group "${rg}" \\
  --sku "B1"`,
      powerShell: `# Azure PowerShell: Escalar App Service Plan
Set-AzAppServicePlan \\
  -Name "${name}" \\
  -ResourceGroupName "${rg}" \\
  -Tier "Basic" \\
  -WorkerSize "Small"`,
    };
  }

  // 10. Seguridad: Key Vault Soft Delete & Purge Protection
  if (title.includes("key vault") || service.includes("key vault") || title.includes("soft-delete") || title.includes("eliminación temporal")) {
    return {
      cli: `# Azure CLI: Habilitar Soft-Delete y Protección de Purga en Key Vault
az keyvault update \\
  --resource-group "${rg}" \\
  --name "${name}" \\
  --enable-soft-delete true \\
  --enable-purge-protection true`,
      powerShell: `# Azure PowerShell: Habilitar Soft-Delete y Purge Protection en Key Vault
Update-AzKeyVault \\
  -ResourceGroupName "${rg}" \\
  -VaultName "${name}" \\
  -EnablePurgeProtection`,
    };
  }

  // 11. Seguridad: NSG Inbound Traffic Restrict
  if (title.includes("nsg") || title.includes("red") || title.includes("inbound") || title.includes("puerto") || title.includes("port")) {
    return {
      cli: `# Azure CLI: Restringir tráfico no seguro en Network Security Group (NSG)
az network nsg rule create \\
  --resource-group "${rg}" \\
  --nsg-name "nsg-${name}" \\
  --name "DenyAllUnsecureInbound" \\
  --priority 4000 \\
  --access Deny \\
  --direction Inbound \\
  --protocol "*" \\
  --source-address-prefixes Internet \\
  --destination-port-ranges "*"`,
      powerShell: `# Azure PowerShell: Restringir regla en NSG
$nsg = Get-AzNetworkSecurityGroup -ResourceGroupName "${rg}" -Name "nsg-${name}"
Add-AzNetworkSecurityRuleConfig -NetworkSecurityGroup $nsg -Name "DenyAllUnsecureInbound" -Access Deny -Direction Inbound -Priority 4000 -SourceAddressPrefix "Internet" -DestinationPortRange "*"
$nsg | Set-AzNetworkSecurityGroup`,
    };
  }

  // 12. Seguridad: MFA / Autenticación Multifactor
  if (title.includes("mfa") || title.includes("multifactor") || title.includes("autenticación") || desc.includes("mfa")) {
    return {
      cli: `# Azure CLI / MS Graph: Exigir MFA en Acceso Condicional de Microsoft Entra ID
az rest --method post \\
  --url "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies" \\
  --body '{
    "displayName": "Require MFA for Azure Management",
    "state": "enabled",
    "conditions": {
      "applications": { "includeApplications": ["797f3400-85eb-4947-8b0c-9778fb6267ad"] },
      "users": { "includeRoles": ["All"] }
    },
    "grantControls": { "operator": "OR", "builtInControls": ["mfa"] }
  }'`,
      powerShell: `# Azure PowerShell: Habilitar política de MFA condicional
Connect-MgGraph -Scopes "Policy.ReadWrite.ConditionalAccess"
New-MgIdentityConditionalAccessPolicy -DisplayName "Require MFA for Azure Management" -State "enabled"`,
    };
  }

  // 13. Confiabilidad: Backup en VMs
  if (title.includes("backup") || title.includes("copia de seguridad") || title.includes("recuperación")) {
    return {
      cli: `# Azure CLI: Habilitar Azure Backup en la Máquina Virtual
az backup protection enable-for-vm \\
  --resource-group "${rg}" \\
  --vault-name "rsv-${rg}-prod" \\
  --vm "${name}" \\
  --policy-name "DefaultPolicy"`,
      powerShell: `# Azure PowerShell: Habilitar protección de Backup
$vault = Get-AzRecoveryServicesVault -ResourceGroupName "${rg}" -Name "rsv-${rg}-prod"
Enable-AzRecoveryServicesBackupProtection -ResourceGroupName "${rg}" -Name "${name}" -VaultId $vault.ID -Policy (Get-AzRecoveryServicesBackupProtectionPolicy -VaultId $vault.ID -Name "DefaultPolicy")`,
    };
  }

  // 14. Excelencia Operativa: Azure Service Health Alerts
  if (title.includes("service health") || title.includes("estado del servicio") || title.includes("alerta")) {
    return {
      cli: `# Azure CLI: Crear alerta de Azure Service Health para incidentes y mantenimientos
az monitor activity-log alert create \\
  --resource-group "${rg}" \\
  --name "alert-service-health-${name}" \\
  --condition category=ServiceHealth \\
  --action-group "/subscriptions/${subId}/resourceGroups/${rg}/providers/microsoft.insights/actionGroups/ag-finops-alerts"`,
      powerShell: `# Azure PowerShell: Configurar regla de alerta de Service Health
$condition = New-AzActivityLogAlertCondition -Field "category" -Equal "ServiceHealth"
New-AzActivityLogAlert -ResourceGroupName "${rg}" -Name "alert-service-health-${name}" -Condition $condition`,
    };
  }

  // 15. Fallback con comando de diagnóstico detallado y optimización específica
  if (resourceId) {
    return {
      cli: `# Azure CLI: Diagnosticar el recurso alcanzado por la recomendación
az resource show --ids "${resourceId}" -o jsonc

# Marcar el recurso como revisado por FinOps:
az resource tag --ids "${resourceId}" --tags FinOpsReviewed="true"`,
      powerShell: `# Azure PowerShell: Diagnosticar y marcar ${name}
Get-AzResource -ResourceId "${resourceId}" | Format-List *
Update-AzTag -ResourceId "${resourceId}" -Tag @{ "FinOpsReviewed" = "true"; "RemediationDate" = (Get-Date).ToString("yyyy-MM-dd") } -Operation Merge`,
    };
  }

  return {
    cli: `# Azure CLI: Localizar el recurso de la recomendación en el grupo indicado
az resource list --resource-group "${rg}" --name "${name}" -o table`,
    powerShell: `# Azure PowerShell: Localizar el recurso de la recomendación
Get-AzResource -ResourceGroupName "${rg}" -Name "${name}" | Format-List *`,
  };
}
