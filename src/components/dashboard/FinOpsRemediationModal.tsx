"use client";
import { useTranslations } from "next-intl";

import React, { useState } from "react";
import {
    IconSparkles,
    IconTerminal2,
    IconBrandTerraform,
    IconFileCode,
    IconCopy,
    IconCheck,
    IconX,
    IconShieldCheck,
    IconExternalLink,
    IconListDetails,
} from "@tabler/icons-react";
import { useCurrency } from "@/components/CurrencyProvider";
import { toast } from "sonner";

export interface OptimizationTarget {
    resourceName: string;
    resourceGroup?: string;
    service?: string;
    category?: string;
    region?: string;
    currentSku?: string;
    targetSku?: string;
    remediationTitle?: string;
    remediationDescription?: string;
    actionKey?: string;
    monthlySavings?: number;
    riskLevel?: "low" | "medium" | "high";
}

interface FinOpsRemediationModalProps {
    isOpen: boolean;
    onClose: () => void;
    target: OptimizationTarget | null;
}

export default function FinOpsRemediationModal({
    isOpen,
    onClose,
    target,
}: FinOpsRemediationModalProps) {
  const t = useTranslations("RemediationModals");
    const { format } = useCurrency();
    const [activeTab, setActiveTab] = useState<"cli" | "powershell" | "terraform" | "steps">("cli");
    const [copied, setCopied] = useState(false);

    if (!isOpen || !target) return null;

    const resourceName = target.resourceName || "azure-resource";
    const resourceGroup = target.resourceGroup || "rg-production";
    const region = target.region || "eastus";
    const title = target.remediationTitle || t("fo_defaultTitle");
    const description = target.remediationDescription || t("fo_defaultDesc", { name: resourceName });
    const savings = target.monthlySavings || 45.0;
    const risk = target.riskLevel || "low";

    // Generador de scripts deterministas según el servicio y acción
    const generateCliCommand = () => {
        const key = (target.actionKey || "").toLowerCase();
        const service = (target.service || target.category || "").toLowerCase();

        if (key.includes("sqldb") || service.includes("sql") || service.includes("database")) {
            return `# ${t("sc_sql_h")}
# ${t("sc_sql_1")}
az sql db update \\
  --resource-group "${resourceGroup}" \\
  --server "${resourceName.split("/")[0] || "sql-server-prod"}" \\
  --name "${resourceName.split("/")[1] || resourceName}" \\
  --service-objective "GP_Gen5_2" \\
  --max-size "100GB"

# ${t("sc_sql_2")}
az sql db update \\
  --resource-group "${resourceGroup}" \\
  --server "${resourceName.split("/")[0] || "sql-server-prod"}" \\
  --name "${resourceName.split("/")[1] || resourceName}" \\
  --license-type "BasePrice"`;
        }

        if (key.includes("appservice") || service.includes("app") || service.includes("web")) {
            return `# ${t("sc_app_h")}
# ${t("sc_app_1")}
az appservice plan update \\
  --name "${resourceName}" \\
  --resource-group "${resourceGroup}" \\
  --sku "P1v3"

# ${t("sc_app_2")}
az monitor autoscale create \\
  --resource-group "${resourceGroup}" \\
  --resource "${resourceName}" \\
  --resource-type "Microsoft.Web/serverfarms" \\
  --min-count 1 \\
  --max-count 3 \\
  --count 1`;
        }

        if (key.includes("storage") || service.includes("storage")) {
            return `# ${t("sc_sto_h")}
# ${t("sc_sto_1")}
az storage account management-policy create \\
  --account-name "${resourceName.toLowerCase().replace(/[^a-z0-9]/g, "")}" \\
  --resource-group "${resourceGroup}" \\
  --policy '{
    "rules": [
      {
        "enabled": true,
        "name": "tierToCoolAfter30Days",
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
  }'`;
        }

        if (key.includes("vm") || service.includes("compute") || service.includes("virtual")) {
            return `# ${t("sc_vm_h")}
# ${t("sc_vm_1")}
az vm deallocate --resource-group "${resourceGroup}" --name "${resourceName}"

# ${t("sc_vm_2")}
az vm update --resource-group "${resourceGroup}" --name "${resourceName}" --size "Standard_D2as_v5"

# ${t("sc_vm_3")}
az vm start --resource-group "${resourceGroup}" --name "${resourceName}"`;
        }

        return `# ${t("sc_gen_h", { name: resourceName })}
az resource update \\
  --resource-group "${resourceGroup}" \\
  --name "${resourceName}" \\
  --resource-type "Microsoft.Resources/resources" \\
  --set tags.FinOpsOptimized="true" tags.AutoManaged="true"`;
    };

    const generatePowerShellCommand = () => {
        return `# ${t("sc_ps_h", { name: resourceName })}
$rg = "${resourceGroup}"
$resName = "${resourceName}"

# ${t("sc_ps_1")}
Connect-AzAccount
Select-AzContext -TenantId "<Tu-Tenant-ID>"

# ${t("sc_ps_2")}
Get-AzResource -ResourceGroupName $rg -Name $resName | ForEach-Object {
    Write-Host "${t("sc_ps_msg1")} $($_.Name)..."
    Update-AzTag -ResourceId $_.ResourceId -Tag @{ "FinOpsOptimized" = "true"; "RemediationDate" = (Get-Date).ToString("yyyy-MM-dd") } -Operation Merge
}
Write-Host "${t("sc_ps_msg2")}" -ForegroundColor Green`;
    };

    const generateTerraformSnippet = () => {
        return `# ${t("sc_tf_h")}
# ${t("sc_tf_1")}

resource "azurerm_resource_group" "main" {
  name     = "${resourceGroup}"
  location = "${region}"
}

# ${t("sc_tf_2")}
# - ${t("sc_tf_3")}
# - ${t("sc_tf_4")}

tags = {
  Environment     = "Production"
  CostCenter      = "FinOps-CMP"
  FinOpsOptimized = "true"
}`;
    };

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success(t("fo_toastCopied"));
        setTimeout(() => setCopied(false), 2500);
    };

    const getActiveCode = () => {
        switch (activeTab) {
            case "cli":
                return generateCliCommand();
            case "powershell":
                return generatePowerShellCommand();
            case "terraform":
                return generateTerraformSnippet();
            default:
                return "";
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in overflow-y-auto">
            <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 my-8">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4 dark:border-slate-800 dark:bg-slate-800/60">
                    <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-[#0054A6] dark:bg-blue-900/40 dark:text-blue-400">
                            <IconSparkles className="h-5 w-5" />
                        </span>
                        <div>
                            <h3
                                className="font-bold text-slate-900 dark:text-white text-base"
                                style={{ fontFamily: "Montserrat, sans-serif" }}
                            >
                                {title}
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                                {resourceName} · {resourceGroup} ({region})
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
                    >
                        <IconX className="h-5 w-5" />
                    </button>
                </div>

                {/* Content Body */}
                <div className="p-6 space-y-4 max-h-[calc(85vh-130px)] overflow-y-auto">
                    {/* Savings & Impact Summary Banner */}
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/30">
                        <div className="flex items-center gap-3 text-sm text-emerald-900 dark:text-emerald-300">
                            <IconShieldCheck className="h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400" />
                            <div className="space-y-0.5">
                                <span className="font-semibold block">{description}</span>
                                <span className="text-xs text-emerald-700/80 dark:text-emerald-400/80">
                                    {t("riskLevel")}{" "}
                                    <strong className="uppercase font-bold">{t(`fo_risk_${risk}`)}</strong>
                                </span>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="text-xs text-emerald-700 dark:text-emerald-400 block font-medium">
                                {t("fo_estMonthlySavings")}
                            </span>
                            <p className="text-xl font-extrabold text-emerald-800 dark:text-emerald-200 font-mono">
                                +{format(savings)}
                            </p>
                        </div>
                    </div>

                    {/* Navigation Tabs */}
                    <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2">
                        <button
                            onClick={() => setActiveTab("cli")}
                            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
                                activeTab === "cli"
                                    ? "border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-400"
                                    : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400"
                            }`}
                        >
                            <IconTerminal2 className="w-4 h-4" />
                            Azure CLI
                        </button>
                        <button
                            onClick={() => setActiveTab("powershell")}
                            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
                                activeTab === "powershell"
                                    ? "border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-400"
                                    : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400"
                            }`}
                        >
                            <IconFileCode className="w-4 h-4" />
                            PowerShell
                        </button>
                        <button
                            onClick={() => setActiveTab("terraform")}
                            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
                                activeTab === "terraform"
                                    ? "border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-400"
                                    : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400"
                            }`}
                        >
                            <IconBrandTerraform className="w-4 h-4" />
                            Terraform
                        </button>
                        <button
                            onClick={() => setActiveTab("steps")}
                            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
                                activeTab === "steps"
                                    ? "border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-400"
                                    : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400"
                            }`}
                        >
                            <IconListDetails className="w-4 h-4" />
                            {t("fo_tabSteps")}
                        </button>
                    </div>

                    {/* Tab Content */}
                    {activeTab === "steps" ? (
                        <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
                            <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                                {t("fo_procedure")}
                            </h4>
                            <ol className="list-decimal list-inside space-y-2 leading-relaxed">
                                <li>
                                    {t.rich("fo_step1", { rg: resourceGroup, b: (c) => <strong>{c}</strong>, code: (c) => <code className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-[11px]">{c}</code> })}
                                </li>
                                <li>
                                    {t.rich("fo_step2", { name: resourceName, code: (c) => <code className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-[11px]">{c}</code> })}
                                </li>
                                <li>
                                    {t.rich("fo_step3", { section: t("fo_scaleTitle"), b: (c) => <strong>{c}</strong> })}
                                </li>
                                <li>
                                    {t("fo_scaleBody")}
                                </li>
                            </ol>
                        </div>
                    ) : (
                        <div className="relative">
                            <pre className="p-4 rounded-xl bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed border border-slate-800">
                                <code>{getActiveCode()}</code>
                            </pre>
                            <button
                                onClick={() => handleCopy(getActiveCode())}
                                className="absolute top-3 right-3 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm"
                            >
                                {copied ? (
                                    <>
                                        <IconCheck className="w-3.5 h-3.5 text-emerald-600" />
                                        <span className="text-emerald-600">{t("fo_copied")}</span>
                                    </>
                                ) : (
                                    <>
                                        <IconCopy className="w-3.5 h-3.5" />
                                        <span>{t("fo_copyScript")}</span>
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>

                {/* Footer according to Rule #21 (white buttons with matching border/text) */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4 dark:border-slate-800 dark:bg-slate-800/40">
                    <a
                        href={`https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceId/${encodeURIComponent(resourceName)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[#00AEEF] bg-white px-3.5 py-2 text-xs font-bold text-[#00AEEF] shadow-sm hover:bg-cyan-50 dark:bg-slate-900 dark:hover:bg-slate-800 transition-all font-heading"
                    >
                        <IconExternalLink className="h-4 w-4" />
                        {t("fo_openPortal")}
                    </a>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 transition-all"
                        >
                            {t("close")}
                        </button>
                        <button
                            type="button"
                            onClick={() => handleCopy(getActiveCode())}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-[#0054A6] bg-white px-4 py-2 text-xs font-bold text-[#0054A6] shadow-sm hover:bg-blue-50 dark:bg-slate-900 dark:hover:bg-slate-800 transition-all font-heading"
                        >
                            <IconSparkles className="h-4 w-4" />
                            {t("applyOptimization")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
