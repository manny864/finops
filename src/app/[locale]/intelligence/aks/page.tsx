import React from 'react';
import { getTranslations } from 'next-intl/server';
import MockBanner from '@/components/MockBanner';
import AksIntelligence from '@/components/dashboard/AksIntelligence';

export default async function AksPage() {
    const t = await getTranslations('IntelligenceAks');

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">⚙️</span>
                        {t('title')}
                    </div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
            </div>

            <div className="mt-6">
                <AksIntelligence />
            </div>
        </div>
    );
}
