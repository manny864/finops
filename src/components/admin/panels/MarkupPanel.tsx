import React from 'react';
import { getTranslations } from 'next-intl/server';
import PartnerMarkup from '@/components/dashboard/PartnerMarkup';
import { IconCoins } from '@tabler/icons-react';

export default async function MarkupPage() {
    const t = await getTranslations('AdminMarkup');
    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-green-600 to-emerald-700">
                            <IconCoins className="w-5 h-5" />
                        </span>
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
