import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from "@/components/MockBanner";
import KubernetesHubDashboard from "@/components/dashboard/KubernetesHubDashboard";
import PageHeaderTierBadge from "@/components/dashboard/PageHeaderTierBadge";
import { Server } from "lucide-react";

export default async function KubernetesPage() {
    const t = await getTranslations("ComputeHub");

    return (
        <div className="content animate-in fade-in px-6 pb-12">
            <MockBanner />
            <div className="vhead mb-6">
                <div>
                    <div className="vt text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <span className="vico">
                            <Server className="w-5 h-5 text-[#0054A6]" />
                        </span>
                        {t("tabKubernetes", { fallback: "Kubernetes (AKS)" })}
                    </div>
                    <div className="vs text-sm text-slate-500 dark:text-slate-400 mt-1">
                        {t("kubernetesSubtitle", { fallback: "Cockpit de costos, capacidad, salud y chargeback por Namespace para Azure Kubernetes Service." })}
                        {" "}<PageHeaderTierBadge tier="Enterprise" />
                    </div>
                </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-xs">
                <KubernetesHubDashboard />
            </div>
        </div>
    );
}
