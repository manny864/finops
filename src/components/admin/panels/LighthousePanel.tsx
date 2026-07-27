import React from 'react';
import { getTranslations } from 'next-intl/server';
import LighthouseDelegationPanel from '@/components/dashboard/LighthouseDelegationPanel';

export default async function LighthouseOnboardingPage() {
    const t = await getTranslations('Lighthouse');
    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">🏮</span>
                        {t('title')}
                    </div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
            </div>
            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <LighthouseDelegationPanel />
            </div>
        </div>
    );
}
