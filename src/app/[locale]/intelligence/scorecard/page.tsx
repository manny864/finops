import React from 'react';
import { getTranslations } from 'next-intl/server';
import MockBanner from '@/components/MockBanner';
import FinOpsScorecard from '@/components/dashboard/FinOpsScorecard';

export default async function ScorecardPage() {
    const t = await getTranslations('IntelligenceScorecard');

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#F59E0B] to-[#D97706]">🏆</span>
                        {t('title')}
                    </div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
            </div>

            <div className="mt-6">
                <FinOpsScorecard />
            </div>
        </div>
    );
}
