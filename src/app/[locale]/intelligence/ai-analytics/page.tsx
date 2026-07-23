import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from '@/components/MockBanner';
import AIAnalyticsDashboard from "@/components/dashboard/AIAnalyticsDashboard";

export default async function AIAnalyticsPage() {
    const t = await getTranslations("AIAnalytics");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054a6] to-[#8b5cf6]">🤖</span>
                        {t("title")}
                    </div>
                    <div className="vs">{t("subtitle")}</div>
                </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <AIAnalyticsDashboard />
            </div>
        </div>
    );
}
