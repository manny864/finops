import React from "react";
import MockBanner from "@/components/MockBanner";
import NetworkAnalyticsDashboard from "@/components/dashboard/NetworkAnalyticsDashboard";
import PageHeaderTierBadge from "@/components/dashboard/PageHeaderTierBadge";
import TelemetryDisclaimerBanner from "@/components/TelemetryDisclaimerBanner";
import { getTranslations } from "next-intl/server";
import { IconNetwork } from "@tabler/icons-react";

export default async function NetworkAnalysisFinopsPage() {
    const t = await getTranslations("NetworkFamilies");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico">
                            <IconNetwork className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
                        </span>
                        {t("analysisTitle")}
                    </div>
                    <div className="vs">
                        {t("analysisSubtitle")} <PageHeaderTierBadge tier="Professional" />
                    </div>
                </div>
            </div>

            <div className="mt-4">
                <TelemetryDisclaimerBanner />
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs mt-6">
                <NetworkAnalyticsDashboard />
            </div>
        </div>
    );
}
