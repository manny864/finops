import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from '@/components/MockBanner';
import InvoicingReportPanel from "@/components/dashboard/InvoicingReportPanel";
import { IconCoins } from '@tabler/icons-react';

export default async function InvoicingReportPage() {
    const t = await getTranslations("Invoicing");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico !bg-transparent !shadow-none">
                            <IconCoins className="w-5 h-5" />
                        </span>
                        {t('pageTitle')}
                    </div>
                    <div className="vs">{t('pageSubtitle')}</div>
                </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <InvoicingReportPanel />
            </div>
        </div>
    );
}
