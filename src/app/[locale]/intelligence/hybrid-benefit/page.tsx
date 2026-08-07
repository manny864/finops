import React from 'react';
import { getTranslations } from 'next-intl/server';
import HybridBenefitCard from '@/components/dashboard/HybridBenefitCard';
import MockBanner from '@/components/MockBanner';
import { IconTag } from '@tabler/icons-react';

export default async function HybridBenefitPage() {
    const t = await getTranslations('IntelligenceHybridBenefit');

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico">
                            <IconTag className="w-5 h-5" />
                        </span>
                        {t('title')}
                    </div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
            </div>

            <div className="mt-6">
                <HybridBenefitCard />
            </div>
        </div>
    );
}
