"use client";
import MockBanner from '@/components/MockBanner';
import { isMockTenant } from '@/lib/mockData';
import React, { useState, useEffect, useMemo } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Activity, AlertTriangle, ArrowDownToLine, Loader2, Network, Search } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { getFreshIdToken } from '@/lib/msalToken';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
} from '@tanstack/react-table';

const PIE_COLORS = [
    '#0054A6', '#00AEEF', '#F2A900', '#10B981', '#EF4444',
    '#8B5CF6', '#F43F5E', '#0EA5E9', '#F59E0B', '#64748B',
    '#0D9488', '#DB2777', '#7C3AED', '#059669', '#DC2626'
];

export default function NetworkAnalyticsPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const t = useTranslations('Network');
    const tc = useTranslations('Common');
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<any[]>([]);
    const [subscriptionId, setSubscriptionId] = useState('');
    const [hasAnalyzed, setHasAnalyzed] = useState(false);
    const [subscriptions, setSubscriptions] = useState<any[]>([]);
    const [loadingSubs, setLoadingSubs] = useState(false);
    const [missingConsent, setMissingConsent] = useState(false);
    const [pageSize, setPageSize] = useState(15);
    const [sorting, setSorting] = useState<SortingState>([{ id: 'cost', desc: true }]);

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default' || (accounts.length === 0 && !isMockTenant(selectedTenant?.id || ''))) return;

        const fetchSubscriptions = async () => {
            setLoadingSubs(true);
            setMissingConsent(false);
            try {
                const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
                const res = await fetch(`/api/subscriptions?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                
                if (json.error === "MISSING_ADMIN_CONSENT") {
                    setMissingConsent(true);
                    setLoadingSubs(false);
                    return;
                }

                if (json.subscriptions) {
                    setSubscriptions(json.subscriptions);
                    if (json.subscriptions.length > 0) {
                        setSubscriptionId(json.subscriptions[0].id);
                    }
                }
            } catch (e) {
                console.error("Error fetching subscriptions:", e);
                toast.error(t('error_loading_subs'));
            }
            setLoadingSubs(false);
        };
        fetchSubscriptions();
        setHasAnalyzed(false);
        setData([]);
    }, [selectedTenant.id, accounts, instance]);

    const handleAnalyze = async () => {
        if (!subscriptionId) { toast.error(t('select_sub')); return; }
        if ((accounts.length === 0 && !isMockTenant(selectedTenant?.id || '')) || selectedTenant.id === 'default') {
            toast.error(t('ensure_auth')); return;
        }
        setLoading(true);
        setHasAnalyzed(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            const targetSubscription = subscriptions.find(s => s.id === subscriptionId);
            const targetTenantId = targetSubscription?.tenantId || selectedTenant.id;
            const res = await fetch(`/api/intelligence/network?subscriptionId=${subscriptionId}`, {
                headers: { 
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'x-tenant-id': targetTenantId
                }
            });
            const json = await res.json();
            if (res.ok && json.data) {
                setData(json.data);
                if (json.data.length === 0) toast.info(t('no_data_toast'));
                else toast.success(t('analysis_complete'));
            } else {
                toast.error(json.message || t('analysis_error'));
            }
        } catch (e) {
            console.error(e);
            toast.error(t('analysis_error'));
        }
        setLoading(false);
    };

    if (selectedTenant.id === 'default') {
        return (
            <div className="empty border border-line rounded-[14px]">
                <span className="text-4xl mb-4">🔐</span>
                <h2 className="text-xl font-bold text-ink">{tc('select_tenant')}</h2>
                <p className="text-sm text-ink-soft mt-2">{tc('select_tenant_desc')}</p>
            </div>
        );
    }

    // Memoize heavy computations to avoid recalculating on every render
    const pieData = useMemo(() => {
        const map: Record<string, number> = {};
        for (const item of data) {
            map[item.subCategory] = (map[item.subCategory] || 0) + item.cost;
        }
        return Object.entries(map)
            .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
            .sort((a, b) => b.value - a.value);
    }, [data]);

    // Individual rows: each (resourceGroup, subCategory) pair as its own row
    const tableData = useMemo(() =>
        data.map((item, i) => ({
            id: i,
            resourceGroup: item.resourceGroup || '(sin grupo)',
            subCategory: item.subCategory,
            cost: Number(item.cost) || 0
        })),
        [data]
    );

    const columnHelper = createColumnHelper<any>();
    const columns = useMemo(() => [
        columnHelper.accessor('resourceGroup', {
            header: 'Resource Group',
            cell: info => (
                <span className="font-semibold text-ink text-[12px] break-all" title={info.getValue()}>
                    {info.getValue()}
                </span>
            ),
        }),
        columnHelper.accessor('subCategory', {
            header: t('traffic_type'),
            cell: info => (
                <span className="text-[12px] text-ink-soft break-words">
                    {info.getValue()}
                </span>
            ),
        }),
        columnHelper.accessor('cost', {
            header: t('estimated_cost'),
            cell: info => (
                <span className="font-bold text-brand-deep text-[12px] whitespace-nowrap">
                    ${Number(info.getValue()).toFixed(2)}
                </span>
            ),
        }),
    ], [t]);

    const table = useReactTable({
        data: tableData,
        columns,
        state: { sorting, pagination: { pageIndex: 0, pageSize } },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        autoResetPageIndex: false,
    });

    // Sync external pageSize state to table
    useEffect(() => {
        table.setPageSize(pageSize);
    }, [pageSize]);

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">🌐</span>
                        {t('title')}
                    </div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
                <div className="right flex gap-2 flex-wrap">
                    <select 
                        value={subscriptionId}
                        onChange={e => setSubscriptionId(e.target.value)}
                        disabled={loadingSubs || subscriptions.length === 0}
                        className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright p-2 outline-none placeholder-ink-soft"
                    >
                        {loadingSubs ? (
                            <option value="">{tc('loading_subs')}</option>
                        ) : subscriptions.length === 0 ? (
                            <option value="">{tc('no_subscriptions')}</option>
                        ) : (
                            subscriptions.map(sub => (
                                <option key={sub.id} value={sub.id}>{sub.name || sub.id}</option>
                            ))
                        )}
                    </select>
                    <button 
                        onClick={handleAnalyze}
                        disabled={loading}
                        className="bg-brand-deep text-white px-4 py-2 rounded-[10px] shadow-sm text-[13px] font-heading font-bold transition-colors disabled:opacity-50 flex items-center hover:brightness-110 cursor-pointer"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                        {tc('analyze')}
                    </button>
                </div>
            </div>

            <div className="bg-amber-soft border border-amber border-opacity-20 rounded-[14px] p-4 flex items-start text-amber shadow-sm">
                <AlertTriangle className="w-5 h-5 mr-3 mt-0.5 flex-shrink-0" />
                <div className="text-[13px]">
                    <p className="mb-1">
                        <strong>{t('finops_tip')}</strong> {t('finops_tip_desc')}
                    </p>
                </div>
            </div>

            {loading ? (
                <div key="state-loading" className="empty">
                    <Loader2 className="w-8 h-8 animate-spin mb-4 text-brand-deep mx-auto" />
                    {t('loading_metrics')}
                </div>
            ) : hasAnalyzed ? (
                <div key="state-analyzed" className="flex flex-col gap-6">
                    {/* Row 1: pie + summary cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Distribución de Costos de Red — todos los recursos */}
                        <div className="card flex flex-col min-w-0">
                            <div className="card-h">
                                <h3><ArrowDownToLine className="w-4 h-4 mr-1" /> {t('cost_distribution')}</h3>
                                <span className="text-[11px] text-ink-soft ml-auto">{pieData.length} categorías</span>
                            </div>
                            {pieData.length > 0 ? (
                                <div className="flex-1 min-h-[300px]">
                                    <ResponsiveContainer width="100%" height={300}>
                                        <PieChart>
                                            <Pie
                                                data={pieData}
                                                cx="50%"
                                                cy="45%"
                                                innerRadius="30%"
                                                outerRadius="60%"
                                                paddingAngle={3}
                                                dataKey="value"
                                            >
                                                {pieData.map((_, index) => (
                                                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <RechartsTooltip 
                                                formatter={(value: any) => `$${Number(value).toFixed(2)}`}
                                                wrapperStyle={{ zIndex: 9999 }}
                                            />
                                            <Legend
                                                verticalAlign="bottom"
                                                height={48}
                                                wrapperStyle={{ fontSize: '11px', overflowY: 'auto', maxHeight: '80px' }}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div className="empty">{t('no_data')}</div>
                            )}
                        </div>

                        {/* Summary stats */}
                        <div className="flex flex-col gap-4 justify-start">
                            <div className="card p-4">
                                <p className="text-[11px] text-ink-soft font-bold uppercase tracking-wider mb-1">Total red (30d)</p>
                                <p className="text-2xl font-extrabold text-brand-deep">
                                    ${data.reduce((s, r) => s + r.cost, 0).toFixed(2)}
                                </p>
                            </div>
                            <div className="card p-4">
                                <p className="text-[11px] text-ink-soft font-bold uppercase tracking-wider mb-1">Recursos analizados</p>
                                <p className="text-2xl font-extrabold text-ink">{data.length}</p>
                                {data.length >= 300 && (
                                    <p className="text-[11px] text-amber mt-1">Mostrando top 300 por costo</p>
                                )}
                            </div>
                            <div className="card p-4">
                                <p className="text-[11px] text-ink-soft font-bold uppercase tracking-wider mb-1">Resource Groups afectados</p>
                                <p className="text-2xl font-extrabold text-ink">
                                    {new Set(data.map(r => r.resourceGroup)).size}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Row 2: tabla de todos los recursos de red (paginada, responsive) */}
                    <div className="card flex flex-col min-w-0 overflow-hidden">
                        <div className="card-h shrink-0">
                            <h3 className="flex items-center gap-2">
                                <Network className="w-4 h-4" />
                                Recursos de Red con Costo
                            </h3>
                            <span className="text-[11px] text-ink-soft ml-auto">{tableData.length} recursos</span>
                        </div>
                        <div className="overflow-x-auto w-full">
                            <table className="tbl w-full min-w-[480px]">
                                <thead>
                                    {table.getHeaderGroups().map(headerGroup => (
                                        <tr key={headerGroup.id}>
                                            {headerGroup.headers.map(header => (
                                                <th
                                                    key={header.id}
                                                    className="cursor-pointer select-none"
                                                    onClick={header.column.getToggleSortingHandler()}
                                                >
                                                    <span className="flex items-center gap-1">
                                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                                        {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''}
                                                    </span>
                                                </th>
                                            ))}
                                        </tr>
                                    ))}
                                </thead>
                                <tbody>
                                    {table.getRowModel().rows.length > 0 ? (
                                        table.getRowModel().rows.map(row => (
                                            <tr key={row.id}>
                                                {row.getVisibleCells().map(cell => (
                                                    <td
                                                        key={cell.id}
                                                        className={cell.column.id === 'cost' ? 'num' : ''}
                                                    >
                                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={columns.length} className="empty text-center py-8">
                                                {t('no_traffic')}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {/* Pagination — always shown when data exists */}
                        {tableData.length > 0 && (
                            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-line bg-surface shrink-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-[12px] text-ink-soft">Filas/página:</span>
                                    <select
                                        value={pageSize}
                                        onChange={e => setPageSize(Number(e.target.value))}
                                        className="bg-surface-2 border border-line text-ink text-[12px] rounded-[6px] p-1 outline-none"
                                    >
                                        {[10, 15, 25, 50].map(s => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                    <span className="text-[12px] text-ink-soft">
                                        {table.getState().pagination.pageIndex * pageSize + 1}–{Math.min((table.getState().pagination.pageIndex + 1) * pageSize, tableData.length)} de {tableData.length}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => table.setPageIndex(0)}
                                        disabled={!table.getCanPreviousPage()}
                                        className="px-2 py-1 bg-surface-2 border border-line rounded-[6px] text-[12px] font-bold text-ink disabled:opacity-40 cursor-pointer"
                                    >«</button>
                                    <button
                                        onClick={() => table.previousPage()}
                                        disabled={!table.getCanPreviousPage()}
                                        className="px-3 py-1 bg-surface-2 border border-line rounded-[6px] text-[12px] font-bold text-ink disabled:opacity-40 cursor-pointer"
                                    >Anterior</button>
                                    <span className="text-[12px] text-ink-soft px-1">
                                        Pág. {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
                                    </span>
                                    <button
                                        onClick={() => table.nextPage()}
                                        disabled={!table.getCanNextPage()}
                                        className="px-3 py-1 bg-surface-2 border border-line rounded-[6px] text-[12px] font-bold text-ink disabled:opacity-40 cursor-pointer"
                                    >Siguiente</button>
                                    <button
                                        onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                                        disabled={!table.getCanNextPage()}
                                        className="px-2 py-1 bg-surface-2 border border-line rounded-[6px] text-[12px] font-bold text-ink disabled:opacity-40 cursor-pointer"
                                    >»</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div key="state-empty" className="empty border border-line rounded-[14px]">
                    <Activity className="w-12 h-12 text-grey mx-auto mb-4" />
                    <p className="text-ink-soft max-w-sm mx-auto">{t('analyze_cta')}</p>
                </div>
            )}
        </div>
    );
}

