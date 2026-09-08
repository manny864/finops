"use client";

import React, { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  IconSparkles,
  IconCopy,
  IconCheck,
  IconX,
  IconTerminal2,
  IconCode,
  IconInfoCircle,
} from "@tabler/icons-react";
import { useCurrency } from "@/components/CurrencyProvider";
import type { WhiteboardQuickWin } from "@/types/whiteboard.types";
import { translateAdvisorText } from "@/lib/advisorI18n";

export default function WhiteboardQuickWinsWidget({
  quickWins,
}: {
  quickWins: WhiteboardQuickWin[];
}) {
  const t = useTranslations("WhiteBoard");
  const locale = useLocale();
  const { format } = useCurrency();
  const [selectedWin, setSelectedWin] = useState<WhiteboardQuickWin | null>(null);
  const [copiedScript, setCopiedScript] = useState<"cli" | "ps" | null>(null);
  const [activeTab, setActiveTab] = useState<"cli" | "ps">("cli");

  const top3Wins = (quickWins || []).slice(0, 3);

  const handleCopy = (text: string, type: "cli" | "ps") => {
    navigator.clipboard.writeText(text);
    setCopiedScript(type);
    setTimeout(() => setCopiedScript(null), 2000);
  };

  // El servidor resuelve el comando con buildAdvisorRemediationCommand según el
  // tipo real del recurso (Redis, SQL, Storage, VM…). Los generadores locales de
  // abajo son solo fallback para payloads sin comando (mocks/caches previos) y
  // asumen VM/disco, por eso nunca deben pisar al comando del servidor.
  const getCliCommand = (win: WhiteboardQuickWin) => {
    if (win.commandCli) return win.commandCli;
    if (win.actionType === "rightsizing") {
      return `az vm update \\\n  --name "${win.resourceName}" \\\n  --resource-group "${win.resourceGroup || "rg-prod"}" \\\n  --set hardwareProfile.vmSize="Standard_D4s_v5"`;
    }
    if (win.actionType === "delete_orphan") {
      return `az disk delete \\\n  --name "${win.resourceName}" \\\n  --resource-group "${win.resourceGroup || "rg-storage"}" \\\n  --yes`;
    }
    if (win.actionType === "apply_tags") {
      return `az tag update \\\n  --resource-id "/subscriptions/.../resourceGroups/${win.resourceName}" \\\n  --operation Merge \\\n  --tags CostCenter="Infrastructure" Environment="Production"`;
    }
    return `az advisor recommendation list --query "[?contains(id, '${win.resourceName}')]" -o table`;
  };

  const getPowerShellCommand = (win: WhiteboardQuickWin) => {
    if (win.commandPowerShell) return win.commandPowerShell;
    if (win.actionType === "rightsizing") {
      return `Update-AzVM -ResourceGroupName "${win.resourceGroup || "rg-prod"}" -Name "${win.resourceName}" -Size "Standard_D4s_v5"`;
    }
    if (win.actionType === "delete_orphan") {
      return `Remove-AzDisk -ResourceGroupName "${win.resourceGroup || "rg-storage"}" -DiskName "${win.resourceName}" -Force`;
    }
    if (win.actionType === "apply_tags") {
      return `Update-AzTag -ResourceId "/subscriptions/.../resourceGroups/${win.resourceName}" -Tag @{ CostCenter = "Infrastructure"; Environment = "Production" } -Operation Merge`;
    }
    return `Get-AzAdvisorRecommendation | Where-Object { $_.ImpactedValue -like "*${win.resourceName}*" }`;
  };

  if (!top3Wins || top3Wins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2 p-6">
        <IconSparkles className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        <p className="text-xs">{t("no_quick_wins")}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col justify-between">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {top3Wins.map((win, idx) => (
          <div
            key={win.id || idx}
            className="flex flex-col justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-[#0078D4]/50 hover:shadow-sm transition-all"
          >
            <div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#0078D4] bg-[#0078D4]/10 dark:bg-[#0078D4]/20 px-2 py-0.5 rounded-md">
                  {t("opportunity_rank", { rank: idx + 1 })}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
                  +{format(win.estimatedMonthlySavingsUSD || 0)}
                  <span className="text-[10px] font-normal">{t("per_month_short")}</span>
                </span>
              </div>

              <h4 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 line-clamp-2 mb-1">
                {translateAdvisorText(win.title, locale, 'solution')}
              </h4>
              <p className="text-xs text-slate-500 font-mono truncate" title={win.resourceName}>
                {win.resourceName}
              </p>
              {win.description && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2 line-clamp-2">
                  {translateAdvisorText(win.description, locale, 'problem')}
                </p>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setSelectedWin(win)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] dark:text-blue-400 hover:bg-[#0078D4] hover:text-white transition-all cursor-pointer shadow-xs"
              >
                <IconSparkles className="w-3.5 h-3.5" stroke={2} />
                {t("optimize")}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal de Remediación en 1-Clic (Z-Index 50 estricto sobre widgets flotantes) */}
      {selectedWin && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setSelectedWin(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full p-6 z-50 relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-[#0078D4]">
                  <IconSparkles className="w-5 h-5" stroke={2} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">
                    {translateAdvisorText(selectedWin.title, locale, 'solution')}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    {t("target_resource", { name: selectedWin.resourceName })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedWin(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="py-4 space-y-4">
              <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50">
                <div className="flex items-center gap-2">
                  <IconInfoCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-xs text-emerald-800 dark:text-emerald-300 font-medium">
                    {t("projectedMonthlySaving")}
                  </span>
                </div>
                <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                  {t("amountPerMonthPlus", { amount: format(selectedWin.estimatedMonthlySavingsUSD || 0) })}
                </span>
              </div>

              {selectedWin.description && (
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {translateAdvisorText(selectedWin.description, locale, 'problem')}
                </p>
              )}

              {/* Tabs CLI / PowerShell */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setActiveTab("cli")}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                        activeTab === "cli"
                          ? "bg-white dark:bg-slate-900 text-[#0078D4] dark:text-blue-400 shadow-xs"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      <IconTerminal2 className="w-3.5 h-3.5" />
                      Azure CLI
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("ps")}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                        activeTab === "ps"
                          ? "bg-white dark:bg-slate-900 text-[#0078D4] dark:text-blue-400 shadow-xs"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      <IconCode className="w-3.5 h-3.5" />
                      PowerShell
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(
                        activeTab === "cli"
                          ? getCliCommand(selectedWin)
                          : getPowerShellCommand(selectedWin),
                        activeTab
                      )
                    }
                    className="inline-flex items-center gap-1 text-xs font-bold text-[#0078D4] hover:text-[#0054A6] transition-colors cursor-pointer"
                  >
                    {copiedScript === activeTab ? (
                      <>
                        <IconCheck className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-600">{t("copied")}</span>
                      </>
                    ) : (
                      <>
                        <IconCopy className="w-3.5 h-3.5" />
                        <span>{t("copy_command")}</span>
                      </>
                    )}
                  </button>
                </div>

                <pre className="p-3 bg-slate-950 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed border border-slate-800">
                  <code>
                    {activeTab === "cli"
                      ? getCliCommand(selectedWin)
                      : getPowerShellCommand(selectedWin)}
                  </code>
                </pre>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <span className="text-[11px] text-slate-400">
                {t("runScriptHint")}
              </span>
              <button
                type="button"
                onClick={() => setSelectedWin(null)}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                {t("close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}