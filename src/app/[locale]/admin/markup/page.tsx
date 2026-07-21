import React from 'react';
import { getTranslations } from 'next-intl/server';
import PartnerMarkup from '@/components/dashboard/PartnerMarkup';

export default async function MarkupPage() {
    const t = await getTranslations('AdminMarkup');
    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-green-600 to-emerald-700">💲</span>
                        {t('pageTitle')}
                    </div>
                    <div className="vs">{t('pageSubtitle')}</div>
                </div>
            </div>

            <div className="mt-6">
                <PartnerMarkup />
            </div>
        </div>
    );
}
