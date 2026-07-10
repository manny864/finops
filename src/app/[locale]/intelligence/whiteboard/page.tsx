import React from 'react';
import { getTranslations } from 'next-intl/server';
import MockBanner from '@/components/MockBanner';
import ExecutiveSummaryBoard from '@/components/dashboard/ExecutiveSummaryBoard';

export default async function WhiteBoardPage() {
    const t = await getTranslations('WhiteBoard');
    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">📋</span>
                        {t('title')}
                    </div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
                <div className="right">
                    <span className="tag purple">Enterprise</span>
                </div>
            </div>

            <div className="mt-6">
                <ExecutiveSummaryBoard />
            </div>
        </div>
    );
}
