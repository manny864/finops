import React from "react";
import { getTranslations } from 'next-intl/server';
import MockBanner from '@/components/MockBanner';
import CoinDashboard from "@/components/dashboard/CoinDashboard";
import { Target } from "lucide-react";

export default async function OptimizationIndexPage() {
    const t = await getTranslations('IntelligenceOptimizationIndex');

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt flex items-center gap-2">
                        <span className="vico !bg-transparent !shadow-none">
                            <Target className="w-5 h-5" />
                        </span>
                        {t('title')}
                    </div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
            </div>

            <CoinDashboard />
        </div>
    );
}
