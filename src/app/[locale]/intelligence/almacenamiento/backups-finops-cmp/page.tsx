import React from "react";
import MockBanner from "@/components/MockBanner";
import BackupsFinopsDashboard from "@/components/dashboard/BackupsFinopsDashboard";
import PageHeaderTierBadge from "@/components/dashboard/PageHeaderTierBadge";
import TelemetryDisclaimerBanner from "@/components/TelemetryDisclaimerBanner";
import { getTranslations } from "next-intl/server";
import { IconShieldCheck } from "@tabler/icons-react";

export default async function BackupsFinopsCmpPage() {
    const t = await getTranslations("BackupsFinops");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico">
                            <IconShieldCheck className="w-5 h-5" stroke={1.5} />
                        </span>
                        {t("pageTitle")}
                    </div>
                    <div className="vs">
                        {t("pageSubtitle")} <PageHeaderTierBadge tier="Enterprise" />
                    </div>
                </div>
            </div>

            <div className="mt-4">
                <TelemetryDisclaimerBanner />
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs mt-6">
                <BackupsFinopsDashboard />
            </div>
        </div>
    );
}
