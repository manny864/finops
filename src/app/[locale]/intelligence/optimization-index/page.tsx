import React from "react";
import { getTranslations } from 'next-intl/server';
import MockBanner from '@/components/MockBanner';
import CoinDashboard from "@/components/dashboard/CoinDashboard";
import { IconTarget } from "@tabler/icons-react";
import InfoTooltip from "@/components/InfoTooltip";

export default async function OptimizationIndexPage() {
    const t = await getTranslations('IntelligenceOptimizationIndex');

    return (
        <div className="content animate-in fade-in space-y-6">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt flex items-center gap-2 text-[#1B2A41] dark:text-white">
                        <span className="vico !bg-transparent !shadow-none text-[#0054A6]">
                            <IconTarget className="w-6 h-6" />
                        </span>
                        {t('title')}
                        <InfoTooltip content={t('subtitle')} />
                    </div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
            </div>

            <CoinDashboard />
        </div>
    );
}
