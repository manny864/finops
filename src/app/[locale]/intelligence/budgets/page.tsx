import React from 'react';
import { getTranslations } from 'next-intl/server';
import BudgetCard from '@/components/budgets/BudgetCard';

export default async function BudgetsPage() {
    const t = await getTranslations('Budgets');

    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">📊</span>
                        {t('title')}
                    </div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
            </div>

            <BudgetCard />
        </div>
    );
}
