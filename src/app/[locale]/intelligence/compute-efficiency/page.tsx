import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from '@/components/MockBanner';
import ComputeEfficiencyDashboard from "@/components/dashboard/ComputeEfficiencyDashboard";

export default async function ComputeEfficiencyPage() {
    const t = await getTranslations("ComputeEfficiency");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">🖥️</span>
                        {t("title")}
                    </div>
                    <div className="vs">{t("subtitle")}</div>
                </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <ComputeEfficiencyDashboard />
            </div>
        </div>
    );
}
