import type { AdvisorRecommendation } from "@/types/azureAdvisor.types";
import { resolveRecommendedSku } from "./advisorI18n";

export function buildAdvisorRemediationCommand(rec: Partial<AdvisorRecommendation>): {
  cli: string;
  powerShell: string;
} {
  const actionType = rec.actionType || "OPTIMIZE";
  const rg = rec.resourceGroup || "rg-default";
  const name = rec.resourceName || "resource-01";
  const subId = rec.subscriptionId || "00000000-0000-0000-0000-000000000000";
  const ext = rec.extendedProperties || {};
  const targetSku =
    resolveRecommendedSku(ext, rec.descriptionTranslated || rec.titleTranslated) ||
    ext.targetSku ||
    "Standard_D4s_v5";

  if (actionType === "PURCHASE_RESERVATION" || actionType === "SIMULATE_RESERVATION") {
    const term = rec.selectedTerm?.includes("3") ? "P3Y" : "P1Y";
    return {
      cli: `az reservations reservation-order calculate \\
  --applied-scope-type Single \\
  --applied-scope "/subscriptions/${subId}" \\
  --sku "${targetSku}" \\
  --term "${term}" \\
  --quantity 1 \\
  --display-name "RI-${name}-${targetSku}"`,
      powerShell: `New-AzReservation \\
  -AppliedScopeType Single \\
  -AppliedScope "/subscriptions/${subId}" \\
  -Sku "${targetSku}" \\
  -Term "${term}" \\
  -Quantity 1 \\
  -DisplayName "RI-${name}-${targetSku}"`,
    };
  }

  if (actionType === "APPLY_AHUB") {
    return {
      cli: `az vm update \\
  --resource-group "${rg}" \\
  --name "${name}" \\
  --license-type Windows_Server`,
      powerShell: `Update-AzVM \\
  -ResourceGroupName "${rg}" \\
  -Name "${name}" \\
  -LicenseType "Windows_Server"`,
    };
  }

  if (actionType === "RESIZE") {
    return {
      cli: `az vm resize \\
  --resource-group "${rg}" \\
  --name "${name}" \\
  --size "${targetSku}"`,
      powerShell: `Update-AzVM \\
  -ResourceGroupName "${rg}" \\
  -Name "${name}" \\
  -Size "${targetSku}"`,
    };
  }

  if (actionType === "DELETE_DISK") {
    return {
      cli: `az disk delete \\
  --resource-group "${rg}" \\
  --name "${name}" \\
  --yes`,
      powerShell: `Remove-AzDisk \\
  -ResourceGroupName "${rg}" \\
  -DiskName "${name}" \\
  -Force`,
    };
  }

  if (actionType === "DELETE_IP") {
    return {
      cli: `az network public-ip delete \\
  --resource-group "${rg}" \\
  --name "${name}"`,
      powerShell: `Remove-AzPublicIpAddress \\
  -ResourceGroupName "${rg}" \\
  -Name "${name}" \\
  -Force`,
    };
  }

  if (actionType === "ENABLE_LIFECYCLE") {
    return {
      cli: `az storage account management-policy create \\
  --account-name "${name}" \\
  --resource-group "${rg}" \\
  --policy @lifecycle-policy.json`,
      powerShell: `Set-AzStorageAccountManagementPolicy \\
  -ResourceGroupName "${rg}" \\
  -StorageAccountName "${name}" \\
  -Rule $lifecycleRules`,
    };
  }

  // Fallback genérico
  const resId =
    rec.resourceId ||
    `/subscriptions/${subId}/resourceGroups/${rg}/providers/Microsoft.Resources/default/${name}`;
  return {
    cli: `az resource update --ids "${resId}" --set tags.FinOpsOptimized=true`,
    powerShell: `Set-AzResource -ResourceId "${resId}" -Tag @{ FinOpsOptimized = "true" } -Force`,
  };
}
