"use client";
import React, { useState } from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, HardDrive, TrendingDown, TrendingUp, Info } from 'lucide-react';
import Pagination, { usePagination } from '@/components/Pagination';

function MockBanner() {
    return (
        <div className="bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-2 rounded-lg border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300 text-sm mb-4">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span><b>Demo:</b> datos de muestra. Conecta un tenant real para ver recomendaciones reales.</span>
        </div>
    );
}

const TIER_COLORS: Record<string, string> = {
    Hot: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    Cool: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    Archive: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

export default function StorageRightsizingTab() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [search, setSearch] = useState('');

    const fetcher = async (url: string) => {
        const account = accounts[0];
        if (!account) throw new Error("No hay cuenta autenticada");
        const tokenResponse = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` } });
        if (!res.ok) { const j = await res.json(); throw new Error(j.error || "Error al cargar datos"); }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant?.id && selectedTenant.id !== 'default' && accounts.length > 0
            ? `/api/rightsizing/storage?tenantId=${selectedTenant.id}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const items: any[] = data?.items || [];
    const filtered = items.filter(r =>
        !search || [r.accountName, r.containerName, r.currentTier, r.recommendedTier].join(' ').toLowerCase().includes(search.toLowerCase())
    );
    const { page, setPage, pageSize, setPageSize, paged: pagedFiltered } = usePagination(filtered);

    if (!selectedTenant || selectedTenant.id === 'default') return null;

    if (isLoading) return (
        <div className="flex items-center justify-center py-16">
            <Loader2 className="w-7 h-7 animate-spin text-brand-deep mr-3" />
            <span className="text-gray-500">Cargando recomendaciones Storage...</span>
        </div>
    );

    if (error) return (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 p-4 rounded-lg border border-red-200">
            <b>Error:</b> {error.message}
        </div>
    );

    const totalSavings = items.reduce((s, r) => s + r.estimatedSavings, 0);

    return (
        <div className="space-y-4">
            {data?.mock && <MockBanner />}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-100 dark:border-blue-900/40">
                    <p className="text-xs text-blue-600 dark:text-blue-400 font-semibold uppercase tracking-wide">Cuentas Analizadas</p>
                    <p className="text-2xl font-bold text-blue-800 dark:text-blue-200 mt-1">{items.length}</p>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4 border border-emerald-100 dark:border-emerald-900/40">
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wide">Ahorro Neto/mes</p>
                    <p className="text-2xl font-bold text-emerald-800 dark:text-emerald-200 mt-1">${totalSavings.toLocaleString()}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-600 dark:text-slate-400 font-semibold uppercase tracking-wide">Total GB Analizado</p>
                    <p className="text-2xl font-bold text-slate-800 dark:text-slate-200 mt-1">
                        {(items.reduce((s, r) => s + (r.usedGb || 0), 0) / 1000).toFixed(1)} TB
                    </p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-3">
                <input
                    type="text" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar cuenta, contenedor, tier..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                        <tr>
                            <th className="px-4 py-3 font-semibold">Cuenta / Contenedor</th>
                            <th className="px-4 py-3 font-semibold">Tier Actual</th>
                            <th className="px-4 py-3 font-semibold">Tier Recom.</th>
                            <th className="px-4 py-3 font-semibold text-right">Uso (GB)</th>
                            <th className="px-4 py-3 font-semibold text-right">Costo/mes</th>
                            <th className="px-4 py-3 font-semibold text-right">Ahorro</th>
                            <th className="px-4 py-3 font-semibold">Motivo</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                        {pagedFiltered.map((r, i) => {
                            const isCost = r.estimatedSavings > 0;
                            return (
                                <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
                                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                                        <div className="flex items-center gap-2">
                                            <HardDrive className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                            <span>{r.accountName}</span>
                                        </div>
                                        <div className="text-xs text-slate-400 mt-0.5 font-mono">{r.containerName}</div>
                                    </td>
                                    <td className="px-4 py-3 text-xs">
                                        <span className={`px-2 py-0.5 rounded-full font-semibold ${TIER_COLORS[r.currentTier] || 'bg-gray-100 text-gray-600'}`}>{r.currentTier}</span>
                                    </td>
                                    <td className="px-4 py-3 text-xs">
                                        <span className={`px-2 py-0.5 rounded-full font-semibold ${TIER_COLORS[r.recommendedTier] || 'bg-gray-100 text-gray-600'}`}>{r.recommendedTier}</span>
                                    </td>
                                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{(r.usedGb || 0).toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">${Number(r.monthlyCost).toFixed(2)}</td>
                                    <td className="px-4 py-3 text-right">
                                        <span className={`flex items-center justify-end gap-1 font-bold ${isCost ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                            {isCost ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />}
                                            ${Math.abs(r.estimatedSavings).toFixed(2)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 max-w-[200px]" title={r.reason}>{r.reason}</td>
                                </tr>
                            );
                        })}
                        {filtered.length === 0 && (
                            <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">No hay recomendaciones Storage.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <Pagination
                page={page}
                setPage={setPage}
                pageSize={pageSize}
                setPageSize={setPageSize}
                total={filtered.length}
                totalPages={Math.max(1, Math.ceil(filtered.length / pageSize))}
            />
        </div>
    );
}
