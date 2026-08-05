import React from 'react';
import { getTranslations } from 'next-intl/server';
import MockBanner from '@/components/MockBanner';
import EfficiencyDashboard from '@/components/dashboard/EfficiencyDashboard';
import PageHeaderTierBadge from '@/components/dashboard/PageHeaderTierBadge';

export default async function EfficiencyPage() {
    const t = await getTranslations("Efficiency");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-cyan-500 to-blue-600">⚡</span>
                        {t("title")}
                    </div>
                    <div className="vs">{t("subtitle")} <PageHeaderTierBadge tier="Professional" /></div>
                </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <EfficiencyDashboard />
            </div>
        </div>
    );
}
