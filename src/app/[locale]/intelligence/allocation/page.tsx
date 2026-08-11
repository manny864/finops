import React from 'react';
import { getTranslations } from 'next-intl/server';
import { IconTopologyStar3 } from '@tabler/icons-react';
import MockBanner from '@/components/MockBanner';
import AllocationManager from '@/components/dashboard/AllocationManager';

export default async function AllocationPage() {
    const t = await getTranslations('IntelligenceAllocation');

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico"><IconTopologyStar3 className="w-5 h-5" /></span>
                        {t('title')}
                    </div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
            </div>

            <div className="mt-6">
                <AllocationManager />
            </div>
        </div>
    );
}
