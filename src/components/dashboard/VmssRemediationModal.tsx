"use client";

import React, { useState } from "react";
import {
  IconTerminal2,
  IconBrandTerraform,
  IconFileCode,
  IconCopy,
  IconCheck,
  IconX,
  IconInfoCircle,
  IconSparkles,
  IconShieldCheck,
  IconAlertTriangle,
  IconCpu,
} from "@tabler/icons-react";
import type { VmssRemediationAction } from "@/lib/computeWorkloadTypes";
import { useCurrency } from "@/components/CurrencyProvider";

interface VmssRemediationModalProps {
  isOpen: boolean;
  onClose: () => void;
  action: VmssRemediationAction | null;
  resourceName: string;
}

export default function VmssRemediationModal({
  isOpen,
  onClose,
  action,
  resourceName,
}: VmssRemediationModalProps) {
  const { format } = useCurrency();
  const [activeTab, setActiveTab] = useState<"cli" | "terraform" | "arm" | "details">("cli");
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
        return action.commandCli || `# Comando Azure CLI para ${action.title}\naz vmss update --name ${resourceName} ...`;
      case "terraform":
        return action.commandTerraform || `# Configuración Terraform HCL para ${action.title}\nresource "azurerm_linux_virtual_machine_scale_set" "example" {\n  # ...\n}`;
      case "arm":
        return action.commandArm || `{\n  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",\n  "contentVersion": "1.0.0.0",\n  "resources": []\n}`;
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

          {/* Technical Disclaimer / Gotcha Box */}
          {action.type === "spot" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-xs dark:border-amber-900/50 dark:bg-amber-950/30">
              <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-300 mb-1.5">
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>Disclaimer de Arquitectura Azure: Conversión a Spot</span>
              </div>
              <p className="text-amber-800 dark:text-amber-200 leading-relaxed">
                <strong>¿Qué puede pasar?</strong> En VMSS creados originalmente como <em>Regular</em>, el objeto <code>billingProfile</code> no existe en el esquema JSON, lo que causa el error <code>Couldn&apos;t find &apos;billingProfile&apos;</code> en Azure CLI. Además, ciertos modos de orquestación bloquean la mutación de prioridad en caliente.
              </p>
              <div className="mt-2.5 pt-2 border-t border-amber-200 dark:border-amber-900/40 space-y-1 text-amber-900 dark:text-amber-100">
                <p><strong>💡 Cómo solucionar:</strong></p>
                <ul className="list-disc pl-4 space-y-1">
                  <li><strong>Opción 1:</strong> Pasar el objeto JSON completo en el comando: <code>virtualMachineProfile.billingProfile=&apos;{`{"maxPrice":-1}`}&apos;</code>.</li>
                  <li><strong>Opción 2 (Recomendada):</strong> Desplegar un nuevo Scale Set Spot (<code>az vmss create --priority Spot --eviction-policy Deallocate --max-price -1</code>) y asociarlo al balanceador de carga antes de drenar y retirar el pool anterior.</li>
                </ul>
              </div>
            </div>
          )}

          {action.type === "os_disk" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-xs dark:border-amber-900/50 dark:bg-amber-950/30">
              <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-300 mb-1.5">
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>Disclaimer de Arquitectura Azure: Inmutabilidad de OS Disk</span>
              </div>
              <p className="text-amber-800 dark:text-amber-200 leading-relaxed">
                <strong>¿Qué puede pasar?</strong> Azure Resource Manager (ARM) bloquea la modificación directa de <code>osDisk.managedDisk.storageAccountType</code> en el modelo base arrojando <code>(PropertyChangeNotAllowed)</code>.
              </p>
              <div className="mt-2.5 pt-2 border-t border-amber-200 dark:border-amber-900/40 space-y-1 text-amber-900 dark:text-amber-100">
                <p><strong>💡 Cómo solucionar:</strong></p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Desasignar las instancias del VMSS para desbloquear el storage engine: <code>az vmss deallocate</code>.</li>
                  <li>Actualizar el SKU de los discos administrados individuales: <code>az disk update --name &lt;disk&gt; --sku StandardSSD_LRS</code>.</li>
                  <li>Volver a iniciar el Scale Set: <code>az vmss start</code>.</li>
                </ol>
              </div>
            </div>
          )}

          {/* Code Tabs */}
          <div>
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700">
              <div className="flex gap-2">
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
                {action.commandArm && (
                  <button
                    onClick={() => setActiveTab("arm")}
                    className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
                      activeTab === "arm"
                        ? "border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-400"
                        : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400"
                    }`}
                  >
                    <IconFileCode className="h-4 w-4" />
                    ARM Template
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
                      💡 <strong>Política de Actualización (Upgrade Policy):</strong> Las modificaciones al modelo base aplican de forma inmediata o progresiva según la directiva configurada (<code>Automatic</code>, <code>Rolling</code> o <code>Manual</code>).
                    </p>
                    <p className="leading-relaxed text-slate-500 dark:text-slate-400">
                      Si el Scale Set tiene política <code>Manual</code>, ejecute <code>az vmss update-instances --instance-ids &quot;*&quot;</code> para desplegar la nueva configuración a las instancias en ejecución.
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

