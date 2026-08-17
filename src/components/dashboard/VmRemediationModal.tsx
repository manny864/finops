"use client";

import React, { useState } from "react";
import {
  IconTerminal2,
  IconBrandTerraform,
  IconBrandPowershell,
  IconCopy,
  IconCheck,
  IconX,
  IconInfoCircle,
  IconSparkles,
  IconShieldCheck,
  IconAlertTriangle,
  IconFlame,
  IconServer2,
} from "@tabler/icons-react";
import type { VmRemediationAction } from "@/lib/computeWorkloadTypes";
import { useCurrency } from "@/components/CurrencyProvider";

interface VmRemediationModalProps {
  isOpen: boolean;
  onClose: () => void;
  action: VmRemediationAction | null;
  resourceName: string;
}

export default function VmRemediationModal({
  isOpen,
  onClose,
  action,
  resourceName,
}: VmRemediationModalProps) {
  const { format } = useCurrency();
  const [activeTab, setActiveTab] = useState<"cli" | "terraform" | "powershell" | "details">("cli");
  const [copied, setCopied] = useState(false);

  if (!isOpen || !action) return null;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getCodeContent = () => {
    switch (activeTab) {
      case "cli":
        return action.commandCli || `# Comando Azure CLI para ${action.title}\naz vm update --name ${resourceName} ...`;
      case "terraform":
        return action.commandTerraform || `# Configuración Terraform HCL para ${action.title}\nresource "azurerm_virtual_machine" "example" {\n  # ...\n}`;
      case "powershell":
        return action.commandPowerShell || `# Script PowerShell / Az PowerShell para ${action.title}\nUpdate-AzVM -ResourceGroupName "rg" -VM (Get-AzVM -Name "${resourceName}")`;
      default:
        return "";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in overflow-y-auto">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/75 px-6 py-4 dark:border-slate-800 dark:bg-slate-800/50">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-[#0054A6] dark:bg-blue-900/30 dark:text-blue-400">
              <IconSparkles className="h-5 w-5" />
            </span>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">{action.title}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">{resourceName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="space-y-4 p-6 max-h-[calc(85vh-130px)] overflow-y-auto">
          {/* Summary Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3.5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <div className="flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-300">
              <IconShieldCheck className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{action.description}</span>
            </div>
            <div className="text-right">
              <span className="text-xs text-emerald-600 dark:text-emerald-400">Ahorro mensual est.</span>
              <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
                {format(action.monthlySavingsUsd)}
              </p>
            </div>
          </div>

          {/* Technical Gotchas / Box */}
          {action.type === "rightsizing_sku" && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-4 text-xs dark:border-blue-900/50 dark:bg-blue-950/30">
              <div className="flex items-center gap-2 font-semibold text-[#0054A6] dark:text-blue-300 mb-1.5">
                <IconFlame className="h-4 w-4 shrink-0 text-[#0054A6] dark:text-blue-400" />
                <span>Consideración de Redimensionamiento (Serie B Burstable)</span>
              </div>
              <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                Las instancias <strong>Serie B (Burstable)</strong> acumulan créditos de CPU cuando la máquina está ociosa y los gastan durante ráfagas de procesamiento. Son ideales para servidores de desarrollo, QA o cargas que promedian menos del 15% de CPU. El cambio de SKU requiere reiniciar la máquina virtual.
              </p>
            </div>
          )}

          {action.type === "deallocated_disk" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-xs dark:border-amber-900/50 dark:bg-amber-950/30">
              <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-300 mb-1.5">
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>Fuga de Costo de Almacenamiento en VMs Apagadas</span>
              </div>
              <p className="text-amber-800 dark:text-amber-200 leading-relaxed">
                En Azure, cuando una VM está en estado <code>PowerState/deallocated</code>, el cómputo se desfactura a $0.00, pero los <strong>Discos Administrados (OS Disk y Data Disks) continúan facturándose al 100%</strong> de su tarifa mensual. Degradar discos de <code>Premium_LRS</code> a <code>Standard_LRS</code> reduce el costo de retención en más de un 65%.
              </p>
            </div>
          )}

          {action.type === "ahub" && (
            <div className="rounded-xl border border-purple-200 bg-purple-50/80 p-4 text-xs dark:border-purple-900/50 dark:bg-purple-950/30">
              <div className="flex items-center gap-2 font-semibold text-purple-900 dark:text-purple-300 mb-1.5">
                <IconServer2 className="h-4 w-4 shrink-0 text-purple-600 dark:text-purple-400" />
                <span>Azure Hybrid Benefit (Software Assurance)</span>
              </div>
              <p className="text-purple-800 dark:text-purple-200 leading-relaxed">
                La activación de AHUB se aplica en caliente sin tiempo de inactividad (Zero Downtime). Solo requiere contar con licencias válidas de Windows Server Core o Datacenter con Software Assurance activo en su contrato de licenciamiento.
              </p>
            </div>
          )}

          {/* Code Tabs */}
          <div>
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700">
              <div className="flex gap-2">
                {action.commandCli && (
                  <button
                    onClick={() => setActiveTab("cli")}
                    className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
                      activeTab === "cli"
                        ? "border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-400"
                        : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400"
                    }`}
                  >
                    <IconTerminal2 className="h-4 w-4" />
                    Azure CLI
                  </button>
                )}
                {action.commandTerraform && (
                  <button
                    onClick={() => setActiveTab("terraform")}
                    className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
                      activeTab === "terraform"
                        ? "border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-400"
                        : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400"
                    }`}
                  >
                    <IconBrandTerraform className="h-4 w-4" />
                    Terraform (IaC)
                  </button>
                )}
                {action.commandPowerShell && (
                  <button
                    onClick={() => setActiveTab("powershell")}
                    className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
                      activeTab === "powershell"
                        ? "border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-400"
                        : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400"
                    }`}
                  >
                    <IconBrandPowershell className="h-4 w-4" />
                    PowerShell
                  </button>
                )}
                <button
                  onClick={() => setActiveTab("details")}
                  className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
                    activeTab === "details"
                      ? "border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-400"
                      : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400"
                  }`}
                >
                  <IconInfoCircle className="h-4 w-4" />
                  Impacto & Riesgo
                </button>
              </div>

              {activeTab !== "details" && (
                <button
                  onClick={() => handleCopy(getCodeContent())}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#10B981] bg-white px-2.5 py-1 text-xs font-medium text-[#10B981] shadow-sm transition-all hover:bg-emerald-50 dark:bg-slate-900 dark:hover:bg-emerald-950/30"
                >
                  {copied ? (
                    <>
                      <IconCheck className="h-3.5 w-3.5" />
                      Copiado
                    </>
                  ) : (
                    <>
                      <IconCopy className="h-3.5 w-3.5" />
                      Copiar
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Code Box or Details Box */}
            <div className="mt-3">
              {activeTab === "details" ? (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
                  <div className="flex justify-between border-b border-slate-200 pb-2 dark:border-slate-700">
                    <span className="font-semibold text-slate-600 dark:text-slate-400">Nivel de Riesgo:</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold uppercase text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      {action.risk}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-slate-200 pb-2 dark:border-slate-700">
                    <span className="font-semibold text-slate-600 dark:text-slate-400">Nivel de Confianza:</span>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 font-bold uppercase text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                      {action.confidence}
                    </span>
                  </div>
                  <div className="pt-1 space-y-2">
                    <p className="leading-relaxed">
                      💡 <strong>FinOps Best Practice:</strong> Antes de eliminar una máquina virtual desasignada, genere un <strong>Snapshot administrado del Disco OS</strong>. Esto garantiza la persistencia del estado histórico de la máquina para auditoría o restauración rápida a una fracción del costo de mantener los discos aprovisionados.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-slate-100 shadow-inner">
                  <pre className="overflow-x-auto whitespace-pre-wrap leading-relaxed">
                    {getCodeContent()}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/50 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-800/30">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
