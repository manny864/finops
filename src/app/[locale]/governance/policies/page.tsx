import React from 'react';
import PoliciesAsCode from '@/components/dashboard/PoliciesAsCode';
import MockBanner from '@/components/MockBanner';
import { getTranslations } from 'next-intl/server';
import { IconShield } from '@tabler/icons-react';

export default async function PoliciesPage() {
    const t = await getTranslations('Policies');
    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-red-500 to-rose-600">
                            <IconShield className="w-5 h-5" />
                        </span>
                        {t('title')}
                    </div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
            </div>

            <div className="mt-6">
                <MockBanner />
                <PoliciesAsCode />
            </div>
        </div>
    );
}
