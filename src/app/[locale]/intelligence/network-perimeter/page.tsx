"use client";
import MockBanner from '@/components/MockBanner';
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Router, DollarSign, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { useTranslations } from 'next-intl';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const TYPE_LABELS: Record<string, string> = {
    "microsoft.network/azurefirewalls": "Azure Firewall",
    "microsoft.network/applicationgateways": "Application Gateway",
    "microsoft.network/applicationgatewaywebapplicationfirewallpolicies": "WAF Policy (App Gateway)",
    "microsoft.network/frontdoorwebapplicationfirewallpolicies": "WAF Policy (Front Door)",
    "microsoft.network/natgateways": "NAT Gateway",
    "microsoft.network/frontdoors": "Front Door",
    "microsoft.cdn/profiles": "Front Door Standard/Premium",
    "microsoft.network/virtualnetworkgateways": "VPN Gateway",
    "microsoft.network/expressroutecircuits": "ExpressRoute Circuit",
    "microsoft.network/trafficmanagerprofiles": "Traffic Manager",
};

export default function NetworkPerimeterPage() {
    const t = useTranslations('NetworkPerimeter');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (selectedTenant.id === 'default' || (accounts.length === 0 && !isMockTenant(selectedTenant.id))) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const idToken = await getFreshIdToken(instance, accounts[0]);
                const url = new URL(`/api/intelligence/network-perimeter`, window.location.origin);
                url.searchParams.set('tenantId', selectedTenant.id);
                const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${idToken}` } });
                const json = await res.json();
                if (cancelled) return;
                if (res.ok) setData(json);
                else toast.error(json.error || t('toast_load_error'));
            } catch (e: any) {
                if (cancelled) return;
                console.error(e);
                toast.error(t('toast_network_error'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedTenant.id, accounts.length, instance, t]);

    if (selectedTenant.id === 'default') return null;

    if (loading) {
        return (
            <div className="p-6 max-w-5xl mx-auto flex items-center justify-center min-h-[400px]">
                <div className="animate-pulse flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-brand-soft border-t-brand-deep rounded-full animate-spin mb-4"></div>
                    <p className="text-gray-500 font-semibold">{t('loading')}</p>
                </div>
            </div>
        );
    }

    if (!data) return <div className="p-6 text-center text-red-500">{t('load_error')}</div>;

    if (data.error) {
        const requiredTier = parseTierRequiredError(data.error);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t('page_title')} />;
        }
    }

    if (data.empty || (data.items || []).length === 0) {
        return (
            <div className="p-6">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-sm">
                    <Router className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('empty_title')}</h2>
                    <p className="text-gray-600 dark:text-gray-400">{data.message || t('empty_desc')}</p>
                </div>
            </div>
        );
    }

    const items = data.items || [];

    return (
        <div className="p-6 max-w-5xl mx-auto animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-6">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-3">
                    <Router className="w-8 h-8 text-brand-deep" />
                    {t('page_title')}
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">{t('page_subtitle')}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><DollarSign className="w-4 h-4" />{t('kpi_total_cost')}</h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{fmt.format(data.totalMonthlyCost || 0)}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Layers className="w-4 h-4" />{t('kpi_item_count')}</h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{items.length}</p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-800 pb-3 mb-4">{t('table_title')}</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_type')}</th>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_resource_group')}</th>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t('col_monthly_cost')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item: any, idx: number) => (
                                <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">{TYPE_LABELS[item.resourceType] || item.resourceType}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400">{item.resourceGroup}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{fmt.format(item.monthlyCost)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {!data.dataAvailable && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-3">{t('cost_unavailable_note')}</p>
                )}
            </div>
        </div>
    );
}
