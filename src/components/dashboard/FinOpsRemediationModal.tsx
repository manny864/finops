"use client";

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
    IconAlertTriangle,
    IconExternalLink,
    IconServer,
    IconDatabase,
    IconCloudComputing,
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
    const { format } = useCurrency();
    const [activeTab, setActiveTab] = useState<"cli" | "powershell" | "terraform" | "steps">("cli");
    const [copied, setCopied] = useState(false);

    if (!isOpen || !target) return null;

    const resourceName = target.resourceName || "recurso-azure";
    const resourceGroup = target.resourceGroup || "rg-production";
    const region = target.region || "eastus";
    const title = target.remediationTitle || "Optimización de Capacidad y Eficiencia FinOps";
    const description =
        target.remediationDescription ||
        `Aplicar rightsizing, purga de recursos huérfanos o reserva de capacidad para ${resourceName}.`;
    const savings = target.monthlySavings || 45.0;
    const risk = target.riskLevel || "low";

    // Generador de scripts deterministas según el servicio y acción
    const generateCliCommand = () => {
        const key = (target.actionKey || "").toLowerCase();
        const service = (target.service || target.category || "").toLowerCase();

        if (key.includes("sqldb") || service.includes("sql") || service.includes("database")) {
            return `# Azure CLI: Optimización de SKU / Capacidad en Azure SQL Database
# Paso 1: Escalar base de datos a SKU optimizado
az sql db update \\
  --resource-group "${resourceGroup}" \\
  --server "${resourceName.split("/")[0] || "sql-server-prod"}" \\
  --name "${resourceName.split("/")[1] || resourceName}" \\
  --service-objective "GP_Gen5_2" \\
  --max-size "100GB"

# Paso 2: Habilitar Azure Hybrid Benefit si aplica
az sql db update \\
  --resource-group "${resourceGroup}" \\
  --server "${resourceName.split("/")[0] || "sql-server-prod"}" \\
  --name "${resourceName.split("/")[1] || resourceName}" \\
  --license-type "BasePrice"`;
        }

        if (key.includes("appservice") || service.includes("app") || service.includes("web")) {
            return `# Azure CLI: Optimización de Plan App Service
# Paso 1: Cambiar nivel de escalado a SKU Premium v3 o Básico eficiente
az appservice plan update \\
  --name "${resourceName}" \\
  --resource-group "${resourceGroup}" \\
  --sku "P1v3"

# Paso 2: Activar autoescalado dinámico basado en CPU (>75%)
az monitor autoscale create \\
  --resource-group "${resourceGroup}" \\
  --resource "${resourceName}" \\
  --resource-type "Microsoft.Web/serverfarms" \\
  --min-count 1 \\
  --max-count 3 \\
  --count 1`;
        }

        if (key.includes("storage") || service.includes("storage")) {
            return `# Azure CLI: Optimización de ciclo de vida en Storage Account
# Paso 1: Aplicar política de transición a Cool / Archive para blobs >30 días
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
            return `# Azure CLI: Redimensionamiento / Optimización de Máquina Virtual
# Paso 1: Detener y desasignar VM de forma segura
az vm deallocate --resource-group "${resourceGroup}" --name "${resourceName}"

# Paso 2: Cambiar tamaño de VM a serie eficiente (ej. Standard_B2s o Standard_D2as_v5)
az vm update --resource-group "${resourceGroup}" --name "${resourceName}" --size "Standard_D2as_v5"

# Paso 3: Iniciar la VM optimizada
az vm start --resource-group "${resourceGroup}" --name "${resourceName}"`;
        }

        return `# Azure CLI: Comando de remediación para ${resourceName}
az resource update \\
  --resource-group "${resourceGroup}" \\
  --name "${resourceName}" \\
  --resource-type "Microsoft.Resources/resources" \\
  --set tags.FinOpsOptimized="true" tags.AutoManaged="true"`;
    };

    const generatePowerShellCommand = () => {
        return `# Azure PowerShell: Optimización de ${resourceName}
$rg = "${resourceGroup}"
$resName = "${resourceName}"

# 1. Autenticar y seleccionar contexto
Connect-AzAccount
Select-AzContext -TenantId "<Tu-Tenant-ID>"

# 2. Aplicar cambio de configuración
Get-AzResource -ResourceGroupName $rg -Name $resName | ForEach-Object {
    Write-Host "Aplicando optimización FinOps sobre $($_.Name)..."
    Update-AzTag -ResourceId $_.ResourceId -Tag @{ "FinOpsOptimized" = "true"; "RemediationDate" = (Get-Date).ToString("yyyy-MM-dd") } -Operation Merge
}
Write-Host "Remediación completada con éxito." -ForegroundColor Green`;
    };

    const generateTerraformSnippet = () => {
        return `# Terraform / OpenTofu: Ajuste de infraestructura declarativa
# Actualizar el bloque de recurso en tu repositorio IaC:

resource "azurerm_resource_group" "main" {
  name     = "${resourceGroup}"
  location = "${region}"
}

# Parámetros recomendados por el motor de FinOps:
# - SKU optimizado según demanda real
# - Tags de trazabilidad de costos

tags = {
  Environment     = "Production"
  CostCenter      = "FinOps-CMP"
  FinOpsOptimized = "true"
}`;
    };

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success("Script copiado al portapapeles");
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
                                    Nivel de Riesgo Operativo:{" "}
                                    <strong className="uppercase font-bold">{risk}</strong>
                                </span>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="text-xs text-emerald-700 dark:text-emerald-400 block font-medium">
                                Ahorro estimado mensual
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
                            Paso a Paso (Portal)
                        </button>
                    </div>

                    {/* Tab Content */}
                    {activeTab === "steps" ? (
                        <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
                            <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                                Procedimiento de Remediación en Azure Portal:
                            </h4>
                            <ol className="list-decimal list-inside space-y-2 leading-relaxed">
                                <li>
                                    Accede al <strong>Azure Portal</strong> y navega al grupo de recursos{" "}
                                    <code className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-[11px]">
                                        {resourceGroup}
                                    </code>
                                    .
                                </li>
                                <li>
                                    Selecciona el recurso{" "}
                                    <code className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-[11px]">
                                        {resourceName}
                                    </code>
                                    .
                                </li>
                                <li>
                                    En la barra lateral izquierda, localiza la sección de{" "}
                                    <strong>Escalado / Configuración de Tamaño (Scale up/down)</strong>.
                                </li>
                                <li>
                                    Ajusta el nivel de servicio al SKU recomendado y guarda los cambios para
                                    hacer efectivo el ahorro inmediato.
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
                                        <span className="text-emerald-600">Copiado</span>
                                    </>
                                ) : (
                                    <>
                                        <IconCopy className="w-3.5 h-3.5" />
                                        <span>Copiar Script</span>
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
                        Abrir en Azure Portal
                    </a>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 transition-all"
                        >
                            Cerrar
                        </button>
                        <button
                            type="button"
                            onClick={() => handleCopy(getActiveCode())}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-[#0054A6] bg-white px-4 py-2 text-xs font-bold text-[#0054A6] shadow-sm hover:bg-blue-50 dark:bg-slate-900 dark:hover:bg-slate-800 transition-all font-heading"
                        >
                            <IconSparkles className="h-4 w-4" />
                            Aplicar Optimización
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
