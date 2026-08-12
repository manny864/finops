import React from "react";
import { getTranslations } from "next-intl/server";
import { BrainCircuit } from "lucide-react";
import MockBanner from '@/components/MockBanner';

const AzureAIDashboard = React.lazy(() => import("./components/AzureAIDashboard"));

export default async function AzureAIPage() {
    const t = await getTranslations("AzureAI");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0078d4] to-[#50e6ff]"><BrainCircuit className="h-5 w-5" /></span>
                        {t("title")}
                    </div>
                    <div className="vs">{t("subtitle")}</div>
                </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <React.Suspense fallback={<div className="h-64 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />}>
                    <AzureAIDashboard />
                </React.Suspense>
            </div>
        </div>
    );
}
