import React from 'react';
import { getTranslations } from 'next-intl/server';
import BudgetCard from '@/components/budgets/BudgetCard';
import PlatformBudgetsManager from '@/components/budgets/PlatformBudgetsManager';
import MockBanner from '@/components/MockBanner';
import HistoryButton from '@/components/history/HistoryButton';
import PageHeaderTierBadge from '@/components/dashboard/PageHeaderTierBadge';
import { IconChartBar } from '@tabler/icons-react';

export default async function BudgetsPage() {
    const t = await getTranslations('Budgets');

    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico">
                            <IconChartBar className="w-5 h-5" />
                        </span>
                        {t('title')}
                    </div>
                    <div className="vs">{t('subtitle')} <PageHeaderTierBadge tier="Professional" /></div>
                </div>
                <div className="right">
                    <HistoryButton domain="budgets" title={t('title')} />
                </div>
            </div>
            <div className="mt-6"><MockBanner /></div>

            <BudgetCard />

            <PlatformBudgetsManager />
        </div>
    );
}
