import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from '@/components/MockBanner';
import CostByCategoryDashboard from "@/components/dashboard/CostByCategoryDashboard";
import { IconChartBar } from "@tabler/icons-react";

export default async function CostByCategoryPage() {
    const t = await getTranslations("CostByCategory");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico">
                            <IconChartBar className="w-5 h-5" />
                        </span>
                        {t("title")}
                    </div>
                    <div className="vs">{t("subtitle")}</div>
                </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <CostByCategoryDashboard />
            </div>
        </div>
    );
}
