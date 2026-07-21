import React from 'react';
import { getTranslations } from 'next-intl/server';
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
                        <span className="vico bg-gradient-to-br from-indigo-500 to-purple-600">🍕</span>
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
