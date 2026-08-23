import type { AdvisorRecommendation } from "@/types/azureAdvisor.types";
import { resolveRecommendedSku } from "./advisorI18n";

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

  // 6. Redimensionamiento / Rightsizing de VM
  if (
    actionType === "RESIZE" ||
    title.includes("redimensionar") ||
    title.includes("right-size") ||
    title.includes("rightsize") ||
    title.includes("subutilizada") ||
    title.includes("underutilized") ||
    service.includes("virtual machine") ||
    service.includes("compute")
  ) {
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
  return {
    cli: `# Azure CLI: Diagnosticar y optimizar configuración de ${name}
az resource show --resource-group "${rg}" --name "${name}" --resource-type "Microsoft.Resources/resources" -o table

# Aplicar optimización recomendada por Azure Advisor:
az resource update \\
  --resource-group "${rg}" \\
  --name "${name}" \\
  --resource-type "Microsoft.Resources/resources" \\
  --set tags.FinOpsOptimized="true" tags.AutoManaged="true"`,
    powerShell: `# Azure PowerShell: Diagnosticar y optimizar ${name}
$res = Get-AzResource -ResourceGroupName "${rg}" -Name "${name}"
Update-AzTag -ResourceId $res.ResourceId -Tag @{ "FinOpsOptimized" = "true"; "RemediationDate" = (Get-Date).ToString("yyyy-MM-dd") } -Operation Merge`,
  };
}
