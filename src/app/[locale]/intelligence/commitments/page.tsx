import React from 'react';
import { getTranslations } from 'next-intl/server';
import Commitments from '@/components/dashboard/Commitments';
import MockBanner from '@/components/MockBanner';
import HistoryButton from '@/components/history/HistoryButton';

export default async function CommitmentsPage() {
    const t = await getTranslations('Commitments');
    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#10B981] to-[#047857]">🔖</span>
                        {t('pageTitle')}
                    </div>
                    <div className="vs">{t('pageSubtitle')}</div>
                </div>
                <div className="right">
                    <HistoryButton domain="commitments" title={t('pageTitle')} />
                </div>
            </div>

            <div className="mt-6">
                <Commitments />
            </div>
        </div>
    );
}
