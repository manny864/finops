"use client";
import React, { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, Box, Info, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

const PAGE_SIZES = [10, 25, 50, 100] as const;

export default function ZeroCostInventory() {
    const t = useTranslations('IntelligenceZeroCost');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.details || json.error || t('fetchError'));
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        (selectedTenant && selectedTenant.id !== 'default' && (accounts.length > 0 || isMockTenant(selectedTenant.id)))
            ? `/api/intelligence/zero-cost?tenantId=${selectedTenant.id}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const resources: any[] = data?.data || [];

    // Filtros
    const [search, setSearch] = useState('');
    const [motivoFilter, setMotivoFilter] = useState<string>('all');
    const [typeFilter, setTypeFilter] = useState<string>('all');
    const [rgFilter, setRgFilter] = useState<string>('all');
    const [pageSize, setPageSize] = useState<number>(25);
    const [page, setPage] = useState<number>(1);

    const types = useMemo(() => {
        const set = new Set<string>();
        resources.forEach(r => r.type && set.add(String(r.type).split('/').pop()!));
        return Array.from(set).sort();
    }, [resources]);

    const resourceGroups = useMemo(() => {
        const set = new Set<string>();
        resources.forEach(r => r.resourceGroup && set.add(String(r.resourceGroup)));
        return Array.from(set).sort();
    }, [resources]);

    const motivos = useMemo(() => {
        const set = new Set<string>();
        resources.forEach(r => r.Motivo && set.add(String(r.Motivo)));
        return Array.from(set).sort();
    }, [resources]);

    const filtered = useMemo(() => {
        const s = search.trim().toLowerCase();
        return resources.filter(r => {
            if (motivoFilter !== 'all' && r.Motivo !== motivoFilter) return false;
            if (typeFilter !== 'all' && String(r.type).split('/').pop() !== typeFilter) return false;
            if (rgFilter !== 'all' && r.resourceGroup !== rgFilter) return false;
            if (s) {
                const hay = [r.name, r.type, r.resourceGroup, r.skuName, r.location]
                    .filter(Boolean).map(String).join(' ').toLowerCase();
                if (!hay.includes(s)) return false;
            }
            return true;
        });
    }, [resources, search, motivoFilter, typeFilter, rgFilter]);

    React.useEffect(() => { setPage(1); }, [search, motivoFilter, typeFilter, rgFilter, pageSize]);

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize);

    if (!selectedTenant || selectedTenant.id === 'default') return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">{t('scanning')}</p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t('title')} />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold">{t('queryErrorTitle')}</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    return (
        <div className="w-full space-y-6">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 flex gap-3 rounded-xl border border-blue-100 dark:border-blue-900/50 text-blue-800 dark:text-blue-300">
                <Info className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="text-sm">
                    <p className="font-bold mb-1">{t('infoTitle')}</p>
                    <p>{t('infoBody')}</p>
                </div>
            </div>

            {/* Toolbar: búsqueda + filtros + page size */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                <div className="md:col-span-4 relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('searchPlaceholder')}
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                </div>
                <div className="md:col-span-2">
                    <select value={motivoFilter} onChange={(e) => setMotivoFilter(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                        <option value="all">{t('allReasons')}</option>
                        {motivos.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>
                <div className="md:col-span-2">
                    <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                        <option value="all">{t('allTypes')}</option>
                        {types.map(ty => <option key={ty} value={ty}>{ty}</option>)}
                    </select>
                </div>
                <div className="md:col-span-2">
                    <select value={rgFilter} onChange={(e) => setRgFilter(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                        <option value="all">{t('allResourceGroups')}</option>
                        {resourceGroups.map(rg => <option key={rg} value={rg}>{rg}</option>)}
                    </select>
                </div>
                <div className="md:col-span-2">
                    <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                        {PAGE_SIZES.map(n => <option key={n} value={n}>{t('perPage', { n })}</option>)}
                    </select>
                </div>
            </div>

            {/* Tabla unificada */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <Box className="w-4 h-4 text-emerald-500" />
                        {t('tableTitle')}
                        <span className="text-xs font-medium px-2 py-0.5 bg-gray-100 dark:bg-slate-800 text-gray-500 rounded-full">
                            {t('countBadge', { shown: total.toLocaleString(), total: resources.length.toLocaleString() })}
                        </span>
                    </h2>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs">
                            <tr>
                                <th className="px-4 py-3 font-semibold">{t('resourceCol')}</th>
                                <th className="px-4 py-3 font-semibold">{t('typeCol')}</th>
                                <th className="px-4 py-3 font-semibold">{t('rgCol')}</th>
                                <th className="px-4 py-3 font-semibold">{t('skuCol')}</th>
                                <th className="px-4 py-3 font-semibold">{t('reasonCol')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                            {pageItems.map((r, i) => {
                                const isFree = r.Motivo === "Capa Gratuita (Free SKU)";
                                return (
                                    <tr key={`${r.id || r.name}-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
                                        <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200 max-w-[260px] truncate" title={r.name}>{r.name}</td>
                                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">{String(r.type || '').split('/').pop()}</td>
                                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs font-mono">{r.resourceGroup}</td>
                                        <td className="px-4 py-3 text-xs">
                                            <span className={`px-2 py-0.5 rounded-full font-bold ${isFree ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400' : 'bg-gray-100 dark:bg-slate-800 text-gray-500'}`}>
                                                {r.skuName || 'N/A'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs">
                                            <span className={`px-2 py-0.5 rounded ${isFree ? 'bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' : 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400'}`}>
                                                {r.Motivo}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                            {pageItems.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                                        {resources.length === 0 ? t('emptyNoResources') : t('emptyNoMatches')}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Paginación */}
                {total > 0 && (
                    <div className="px-4 py-3 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <div>
                            {t('showingRange', { from: start + 1, to: Math.min(start + pageSize, total), total })}
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={safePage <= 1}
                                className="p-1.5 rounded border border-gray-200 dark:border-slate-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-800"
                                aria-label={t('ariaPrevious')}
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <span className="px-2">
                                {t('pageOf', { current: safePage, total: totalPages })}
                            </span>
                            <button
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={safePage >= totalPages}
                                className="p-1.5 rounded border border-gray-200 dark:border-slate-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-800"
                                aria-label={t('ariaNext')}
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
