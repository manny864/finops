import React from 'react';
import { getTranslations } from 'next-intl/server';
import MockBanner from '@/components/MockBanner';
import HARecommendationsPanel from '@/components/dashboard/HARecommendationsPanel';
import HistoryButton from '@/components/history/HistoryButton';
import { IconShield } from '@tabler/icons-react';

export default async function HAPage() {
    const t = await getTranslations('HA');
    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico !bg-transparent !shadow-none">
                            <IconShield className="w-5 h-5" />
                        </span>
                        {t('title')}
                    </div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
                <div className="right">
                    <HistoryButton domain="governance" title={t('title')} />
                </div>
            </div>
            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <HARecommendationsPanel />
            </div>
        </div>
    );
}
