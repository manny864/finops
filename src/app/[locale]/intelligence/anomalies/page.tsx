import React from 'react';
import { getTranslations } from 'next-intl/server';
import MockBanner from '@/components/MockBanner';
import AnomalyDashboard from '@/components/dashboard/AnomalyDashboard';
import HistoryButton from '@/components/history/HistoryButton';
import TelemetryDisclaimerBanner from '@/components/TelemetryDisclaimerBanner';
import { ShieldAlert } from 'lucide-react';

export default async function AnomaliesPage() {
    const t = await getTranslations('Anomalies');
    return (
        <div className="content animate-in fade-in space-y-4">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt flex items-center gap-2">
                        <span className="vico bg-gradient-to-br from-red-500 to-rose-700 text-white p-2 rounded-xl">
                            <ShieldAlert className="w-5 h-5" />
                        </span>
                        {t('pageTitle')}
                    </div>
                    <div className="vs">{t('pageSubtitle')}</div>
                </div>
                <div className="right">
                    <HistoryButton domain="anomalies" title={t('pageTitle')} />
                </div>
            </div>

            <TelemetryDisclaimerBanner compact />

            <AnomalyDashboard />
        </div>
    );
}
