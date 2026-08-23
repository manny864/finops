import React from 'react';
import { getTranslations } from 'next-intl/server';
import PartnerMarkup from '@/components/dashboard/PartnerMarkup';
import { IconReceipt2 } from '@tabler/icons-react';

export default async function MarkupPage() {
    const t = await getTranslations('AdminMarkup');
    return (
        <div className="w-full max-w-full content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt flex items-center gap-2 font-[Montserrat,'Montserrat_Fallback',sans-serif] text-[#1B2A41] dark:text-white">
                        <span className="vico !bg-transparent !shadow-none p-0 inline-flex items-center">
                            <IconReceipt2 size={26} stroke={1.5} className="text-[#0078D4]" />
                        </span>
                        {t('pageTitle')}
                    </div>
                    <div className="vs text-slate-500 dark:text-slate-400 mt-1">{t('pageSubtitle')}</div>
                </div>
            </div>

            <div className="mt-6 w-full max-w-full">
                <PartnerMarkup />
            </div>
        </div>
    );
}
