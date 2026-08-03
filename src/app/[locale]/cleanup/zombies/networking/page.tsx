import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from '@/components/MockBanner';
import NetworkingZombiesPanel from "@/components/dashboard/NetworkingZombiesPanel";
import PageHeaderTierBadge from "@/components/dashboard/PageHeaderTierBadge";

export default async function NetworkingZombiesPage() {
    const t = await getTranslations("NetworkingZombies");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#7C3AED] to-[#C4B5FD]">🌐</span>
                        {t("pageTitle")}
                    </div>
                    <div className="vs">
                        {t("pageSubtitle")} <PageHeaderTierBadge tier="Essential" />
                    </div>
                </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <NetworkingZombiesPanel />
            </div>
        </div>
    );
}
