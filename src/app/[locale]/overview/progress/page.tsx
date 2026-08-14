"use client";

import React, { useEffect, useState, useCallback } from 'react';
import MockBanner from '@/components/MockBanner';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { useLocale, useTranslations } from 'next-intl';
import { TrendingUp, Loader2, MapPin } from 'lucide-react';
import { useAIContext } from '@/hooks/useAIContext';
import { isMockTenant, getMockDataForRoute } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { HistoricalProgressReport, HistoryTimeRange } from '@/lib/historicalProgressModel';
import { generateHistoricalProgressReport } from '@/lib/historicalProgressGenerator';
import { HistoricalProgressDashboard } from '@/components/history/HistoricalProgressDashboard';

export default function HistoricalProgressPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const locale = useLocale();
    const t = useTranslations("OverviewProgress");

    const [timeRange, setTimeRange] = useState<HistoryTimeRange>('90d');
    const [loading, setLoading] = useState(true);
    const [report, setReport] = useState<HistoricalProgressReport | null>(null);
    const setPageContext = useAIContext(state => state.setPageContext);

    const isDemo = isMockTenant(selectedTenant?.id || '');

    const fetchHistoricalData = useCallback(async (range: HistoryTimeRange) => {
        if (!selectedTenant || selectedTenant.id === 'default') return;

        setLoading(true);

        if (isDemo) {
            const tier = ((selectedTenant as any).tier || 'business').toString().toLowerCase();
            const mockReport = generateHistoricalProgressReport(range, tier);
            setReport(mockReport);
            setLoading(false);
            return;
        }

        try {
            let token = '';
            if (accounts.length > 0) {
                token = await getFreshIdToken(instance, accounts[0]);
            }

            const res = await fetch(`/api/intelligence/history?tenantId=${selectedTenant.id}&timeRange=${range}`, {
                headers: {
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                    'Accept-Language': locale,
                }
            });

            if (res.ok) {
                const json = await res.json();
                setReport(json);
            } else {
                console.error("[HistoricalProgress] Error en respuesta de API:", res.status);
            }
        } catch (e) {
            console.error("[HistoricalProgress] Error fetching data:", e);
        } finally {
            setLoading(false);
        }
    }, [selectedTenant, isDemo, accounts, instance, locale]);

    useEffect(() => {
        fetchHistoricalData(timeRange);
    }, [fetchHistoricalData, timeRange]);

    useEffect(() => {
        if (report) {
            setPageContext(t('pageTitle') || 'Progreso Histórico', {
                timeRange,
                maturityScore: report.currentMaturityScore,
                maturityLevel: report.currentMaturityLevel,
                totalCounterfactualSavings: report.totalCounterfactualSavings,
                tagCompliancePct: report.currentTagCompliancePct,
                commitmentCoveragePct: report.currentCommitmentCoveragePct,
                realizedSavings: report.currentRealizedSavings,
                leakageSpend: report.currentLeakageSpend,
            });
        }
    }, [report, timeRange, setPageContext, t]);

    if (!selectedTenant || selectedTenant.id === 'default') {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-surface rounded-xl border border-line shadow-sm">
                <span className="text-4xl mb-4">🔐</span>
                <h2 className="text-lg font-bold text-ink">{t('selectTenantTitle')}</h2>
                <p className="text-xs text-ink-soft mt-1">{t('selectTenantDesc')}</p>
            </div>
        );
    }

    return (
        <div className="content animate-in fade-in duration-500 space-y-6">
            <MockBanner />

            {/* Page Header */}
            <div className="vhead flex items-start justify-between">
                <div>
                    <div className="vt flex items-center gap-2 text-xl font-extrabold text-ink dark:text-white">
                        <span className="vico p-2 rounded-lg bg-brand-soft text-brand-deep dark:bg-brand-deep/20 dark:text-brand-bright">
                            <TrendingUp className="w-5 h-5" />
                        </span>
                        {t('pageTitle')}
                    </div>
                    <div className="vs text-xs text-ink-soft mt-1">{t('pageSubtitle')}</div>
                </div>
                <div className="right">
                    <span className="bg-surface text-ink-soft border border-line px-3 py-1.5 rounded-full text-xs font-semibold flex items-center shadow-sm">
                        <MapPin className="w-3 h-3 mr-1 text-red-500 fill-red-500" />
                        {t('fullTenant')}
                    </span>
                </div>
            </div>

            {/* Main Content */}
            {loading && !report ? (
                <div className="flex flex-col items-center justify-center h-72 text-grey">
                    <Loader2 className="w-8 h-8 animate-spin mb-4 text-brand-deep" />
                    <p className="text-xs font-bold">{t('loadingData')}</p>
                </div>
            ) : report ? (
                <HistoricalProgressDashboard
                    report={report}
                    timeRange={timeRange}
                    onTimeRangeChange={setTimeRange}
                    isDemo={isDemo}
                />
            ) : null}
        </div>
    );
}
