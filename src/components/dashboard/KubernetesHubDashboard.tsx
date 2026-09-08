"use client";
import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Server, Layers, HelpCircle } from "lucide-react";
import AksIntelligence from "@/components/dashboard/AksIntelligence";
import AksChargebackPage from "@/app/[locale]/intelligence/aks-chargeback/page";

export default function KubernetesHubDashboard() {
    const [subTab, setSubTab] = useState<"aks" | "chargeback">("aks");
    const t = useTranslations("ComputeHub");

    return (
        <div className="w-full space-y-6 animate-in fade-in duration-300">
            {/* Sub-tab Navigation */}
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-800 pb-3 flex-wrap gap-4">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setSubTab("aks")}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all cursor-pointer ${
                            subTab === "aks"
                                ? "bg-[#0054A6] text-white shadow-xs"
                                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 border border-gray-200 dark:border-slate-700"
                        }`}
                    >
                        <Server className="w-4 h-4" />
                        <span>AKS (Azure Kubernetes Service)</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setSubTab("chargeback")}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all cursor-pointer ${
                            subTab === "chargeback"
                                ? "bg-[#0054A6] text-white shadow-xs"
                                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 border border-gray-200 dark:border-slate-700"
                        }`}
                    >
                        <Layers className="w-4 h-4" />
                        <span>AKS Chargeback</span>
                    </button>
                </div>

                <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>
                        {subTab === "aks" ? t("aksTabHint") : t("chargebackTabHint")}
                    </span>
                </div>
            </div>

            {/* Sub-tab Content */}
            <div className="w-full">
                {subTab === "aks" ? (
                    <div className="animate-in fade-in duration-200">
                        <AksIntelligence />
                    </div>
                ) : (
                    <div className="animate-in fade-in duration-200">
                        <AksChargebackPage />
                    </div>
                )}
            </div>
        </div>
    );
}
