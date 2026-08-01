"use client";
import MockBanner from '@/components/MockBanner';
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Boxes, DollarSign, Zap, Layers, Cpu, Package, Server } from 'lucide-react';
import { toast } from 'sonner';
import Pagination, { usePagination } from '@/components/Pagination';
import PinButton from '@/components/dashboard/PinButton';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { useTranslations } from 'next-intl';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ContainerAppsPage() {
    const t = useTranslations('ContainerApps');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);

    const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(data?.apps);

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
                const url = new URL(`/api/intelligence/container-apps`, window.location.origin);
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
            <div className="p-6 max-w-6xl mx-auto flex items-center justify-center min-h-[400px]">
                <div className="animate-pulse flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-brand-soft border-t-brand-deep rounded-full animate-spin mb-4"></div>
                    <p className="text-gray-500 font-semibold">{t('loading')}</p>
                </div>
            </div>
        );
    }

    if (!data) return <div className="p-6 text-center text-red-500">{t('load_error')}</div>;

    const apps = data.apps || [];
    const registries = data.registries || [];
    const environments = data.environments || [];

    if (data.empty || (apps.length === 0 && registries.length === 0 && environments.length === 0)) {
        return (
            <div className="p-6">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-sm">
                    <Boxes className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('empty_title')}</h2>
                    <p className="text-gray-600 dark:text-gray-400">{data.message || t('empty_desc')}</p>
                </div>
            </div>
        );
    }

    const totalContainersMonthlyCost = Number(data.totalContainersMonthlyCost ?? ((data.totalMonthlyCost || 0) + (data.totalRegistryMonthlyCost || 0) + (data.totalEnvironmentMonthlyCost || 0))) || 0;

    return (
        <div className="p-6 max-w-6xl mx-auto animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-6">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-3">
                    <Boxes className="w-8 h-8 text-brand-deep" />
                    {t('page_title')}
                    <PinButton widgetKey="intelligence.container-apps" />
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">{t('page_subtitle')}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-5">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><DollarSign className="w-4 h-4 text-brand-deep" />{t('kpi_total_cost')}</h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{fmt.format(totalContainersMonthlyCost)}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-5">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Boxes className="w-4 h-4 text-blue-500" />{t('kpi_apps_cost')}</h3>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{fmt.format(data.totalMonthlyCost || 0)}</p>
                    <span className="text-[11px] text-gray-400">{t('resource_count', { count: data.appCount || apps.length })}</span>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-5">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Package className="w-4 h-4 text-emerald-500" />{t('kpi_registries_cost')}</h3>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{fmt.format(data.totalRegistryMonthlyCost || 0)}</p>
                    <span className="text-[11px] text-gray-400">{t('resource_count', { count: data.registryCount || registries.length })}</span>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-5">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Server className="w-4 h-4 text-purple-500" />{t('kpi_environments_cost')}</h3>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{fmt.format(data.totalEnvironmentMonthlyCost || 0)}</p>
                    <span className="text-[11px] text-gray-400">{t('resource_count', { count: data.environmentCount || environments.length })}</span>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-5">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Zap className="w-4 h-4 text-amber-500" />{t('kpi_potential_saving')}</h3>
                    <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{fmt.format(data.totalPotentialSaving || 0)}</p>
                    <span className="text-[11px] text-gray-400">{t('savings_hint', { amount: '', count: data.scaleToZeroCandidates || 0 }).replace(/^Ahorro potencial\s*·\s*/, '')}</span>
                </div>
            </div>

            {/* Container Apps Section */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 mb-8">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-800 pb-3 mb-4 flex items-center gap-2">
                    <Boxes className="w-5 h-5 text-blue-500" />
                    {t('table_title')}
                </h3>
                {apps.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">Sin Container Apps</p>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr>
                                        <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_app')}</th>
                                        <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_environment')}</th>
                                        <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t('col_resources')}</th>
                                        <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t('col_replicas')}</th>
                                        <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t('col_monthly_cost')}</th>
                                        <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t('col_saving')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paged.map((app: any) => (
                                        <tr key={`${app.resourceGroup}/${app.name}`} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">
                                                <div className="flex items-center gap-2">
                                                    {app.name}
                                                    {app.scaleToZeroCandidate && <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">{t('scale_to_zero_tag')}</span>}
                                                </div>
                                                <span className="text-[11px] text-gray-400">{app.resourceGroup}</span>
                                            </td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400">{app.environment || '—'}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 text-right whitespace-nowrap">
                                                <span className="inline-flex items-center gap-1"><Cpu className="w-3 h-3" />{app.cpuCores} · {app.memoryGb.toFixed(1)} GiB</span>
                                            </td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 text-right">{app.minReplicas}–{app.maxReplicas}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{fmt.format(app.monthlyCost)}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-emerald-600 dark:text-emerald-400 text-right">{app.potentialSaving > 0 ? fmt.format(app.potentialSaving) : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} />
                    </>
                )}
                {!data.costBreakdownAvailable && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-3">{t('cost_unavailable_note')}</p>
                )}
            </div>

            {/* Container Registries (ACR) Section */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 mb-8">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-800 pb-3 mb-4 flex items-center gap-2">
                    <Package className="w-5 h-5 text-emerald-500" />
                    {t('table_registries_title')}
                </h3>
                {registries.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">Sin Container Registries (ACR)</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_registry')}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_sku')}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_location')}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t('col_monthly_cost')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {registries.map((reg: any) => (
                                    <tr key={`${reg.resourceGroup}/${reg.name}`} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">
                                            {reg.name}
                                            <div className="text-[11px] text-gray-400">{reg.resourceGroup}</div>
                                        </td>
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400">{reg.sku || 'Basic'}</td>
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400">{reg.location || '—'}</td>
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{fmt.format(reg.monthlyCost || 0)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Container Environments Section */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-800 pb-3 mb-4 flex items-center gap-2">
                    <Server className="w-5 h-5 text-purple-500" />
                    {t('table_environments_title')}
                </h3>
                {environments.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">Sin Container Environments</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_environment')}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_app_count')}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_location')}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t('col_monthly_cost')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {environments.map((env: any) => (
                                    <tr key={`${env.resourceGroup}/${env.name}`} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">
                                            {env.name}
                                            <div className="text-[11px] text-gray-400">{env.resourceGroup}</div>
                                        </td>
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400">{env.appCount || 0}</td>
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400">{env.location || '—'}</td>
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{fmt.format(env.monthlyCost || 0)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
