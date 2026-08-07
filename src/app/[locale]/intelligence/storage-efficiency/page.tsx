import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from '@/components/MockBanner';
import StorageEfficiencyDashboard from "@/components/dashboard/StorageEfficiencyDashboard";
import PageHeaderTierBadge from "@/components/dashboard/PageHeaderTierBadge";
import { AlertCircle } from "lucide-react";
import { IconDatabaseCog } from "@tabler/icons-react";

export default async function StorageEfficiencyPage() {
    const t = await getTranslations("StorageEfficiency");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico">
                            <IconDatabaseCog className="w-5 h-5" />
                        </span>
                        {t("title")}
                    </div>
                    <div className="vs">{t("subtitle")} <PageHeaderTierBadge tier="Enterprise" /></div>
                </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-xl p-4 mt-6 flex gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800 dark:text-amber-300">
                    <p className="font-semibold mb-1">{t("dataRefreshNote")}</p>
                    <p className="text-amber-700 dark:text-amber-400 text-xs">{t("dataRefreshHint")}</p>
                </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <StorageEfficiencyDashboard />
            </div>
        </div>
    );
}
