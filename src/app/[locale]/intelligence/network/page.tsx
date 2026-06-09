"use client";
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Activity, AlertTriangle, ArrowDownToLine, Loader2, Search } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  getPaginationRowModel
} from '@tanstack/react-table';

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
    const [pageSize, setPageSize] = useState(10);

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default' || accounts.length === 0) return;

        const fetchSubscriptions = async () => {
            setLoadingSubs(true);
            setMissingConsent(false);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
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
        if (!subscriptionId) {
            toast.error(t('select_sub'));
            return;
        }
        if (accounts.length === 0 || selectedTenant.id === 'default') {
            toast.error(t('ensure_auth'));
            return;
        }

        setLoading(true);
        setHasAnalyzed(true);
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
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
                if (json.data.length === 0) {
                    toast.info(t('no_data_toast'));
                } else {
                    toast.success(t('analysis_complete'));
                }
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

    // Grouping by subCategory for PieChart
    const pieDataMap = data.reduce((acc, curr) => {
        acc[curr.subCategory] = (acc[curr.subCategory] || 0) + curr.cost;
        return acc;
    }, {} as Record<string, number>);
    
    const pieData = Object.keys(pieDataMap).map(k => ({ name: k, value: pieDataMap[k] }));
    const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

    // Grouping by Resource Group for Table
    const rgDataMap = data.reduce((acc, curr) => {
        if (!acc[curr.resourceGroup]) {
            acc[curr.resourceGroup] = { resourceGroup: curr.resourceGroup, totalCost: 0, subCategories: new Set<string>() };
        }
        acc[curr.resourceGroup].totalCost += curr.cost;
        acc[curr.resourceGroup].subCategories.add(curr.subCategory);
        return acc;
    }, {} as Record<string, any>);

    const tableData = Object.values(rgDataMap)
        .map((rg: any) => ({ ...rg, subCategories: Array.from(rg.subCategories).join(", ") }))
        .sort((a: any, b: any) => b.totalCost - a.totalCost);

    const columnHelper = createColumnHelper<any>();
    const columns = [
        columnHelper.accessor('resourceGroup', {
            header: 'Resource Group',
            cell: info => <span className="font-semibold text-ink whitespace-normal break-words" style={{minWidth: '150px'}}>{info.getValue()}</span>,
            size: 200,
        }),
        columnHelper.accessor('subCategories', {
            header: t('traffic_type'),
            cell: info => <span className="whitespace-normal break-words block text-[13px] text-ink-soft">{info.getValue()}</span>,
            size: 250,
        }),
        columnHelper.accessor('totalCost', {
            header: t('estimated_cost'),
            cell: info => <span className="font-bold text-brand-deep">${info.getValue().toFixed(2)}</span>,
            size: 100,
        }),
    ];

    const table = useReactTable({
        data: tableData,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        columnResizeMode: 'onChange',
        initialState: {
            pagination: {
                pageSize: pageSize,
            },
        },
    });

    useEffect(() => {
        table.setPageSize(pageSize);
    }, [pageSize, table]);

    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">🌐</span>
                        {t('title')}
                    </div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
                <div className="right">
                    <select 
                        value={subscriptionId}
                        onChange={e => setSubscriptionId(e.target.value)}
                        disabled={loadingSubs || subscriptions.length === 0}
                        className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright p-2 outline-none"
                    >
                        {loadingSubs ? (
                            <option value="">{tc('loading_subs')}</option>
                        ) : subscriptions.length === 0 ? (
                            <option value="">{tc('no_subscriptions')}</option>
                        ) : (
                            subscriptions.map(sub => (
                                <option key={sub.id} value={sub.id}>{sub.displayName || sub.id}</option>
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
                <div key="state-analyzed" className="grid-2">
                    <div className="card flex flex-col">
                        <div className="card-h">
                            <h3><ArrowDownToLine className="w-4 h-4 mr-1" /> {t('cost_distribution')}</h3>
                        </div>
                        {pieData.length > 0 ? (
                            <div className="chart-wrap flex-1 w-full h-80">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={pieData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={80}
                                            outerRadius={110}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {pieData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <RechartsTooltip formatter={(value: any) => `$${Number(value).toFixed(2)}`} />
                                        <Legend verticalAlign="bottom" height={36} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="empty">{t('no_data')}</div>
                        )}
                    </div>

                    <div className="card flex flex-col overflow-hidden">
                        <div className="card-h">
                            <h3>{t('top_rg')}</h3>
                        </div>
                        <div className="overflow-x-auto w-full flex-1">
                            <table className="tbl w-full" style={{ width: table.getCenterTotalSize() }}>
                                <thead>
                                    {table.getHeaderGroups().map(headerGroup => (
                                        <tr key={headerGroup.id}>
                                            {headerGroup.headers.map(header => (
                                                <th 
                                                    key={header.id} 
                                                    style={{ width: header.getSize() }}
                                                    className="relative group"
                                                >
                                                    {header.isPlaceholder
                                                        ? null
                                                        : flexRender(
                                                            header.column.columnDef.header,
                                                            header.getContext()
                                                        )}
                                                    {header.column.getCanResize() && (
                                                        <div
                                                            onMouseDown={header.getResizeHandler()}
                                                            onTouchStart={header.getResizeHandler()}
                                                            className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none bg-line opacity-0 group-hover:opacity-100 ${
                                                                header.column.getIsResizing() ? 'opacity-100 bg-brand-deep' : ''
                                                            }`}
                                                        />
                                                    )}
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
                                                        className={cell.column.id === 'totalCost' ? 'num' : ''}
                                                        style={{ width: cell.column.getSize() }}
                                                    >
                                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={columns.length} className="empty text-center">
                                                {t('no_traffic')}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {table.getPageCount() > 1 && (
                            <div className="flex items-center justify-between p-4 border-t border-line bg-surface">
                                <div className="flex items-center gap-2">
                                    <span className="text-[12px] text-ink-soft">Filas por página:</span>
                                    <select
                                        value={pageSize}
                                        onChange={e => setPageSize(Number(e.target.value))}
                                        className="bg-surface-2 border border-line text-ink text-[12px] rounded-[6px] p-1 outline-none"
                                    >
                                        {[10, 15, 20].map(size => (
                                            <option key={size} value={size}>{size}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => table.previousPage()}
                                        disabled={!table.getCanPreviousPage()}
                                        className="px-3 py-1 bg-surface-2 border border-line rounded-[6px] text-[12px] font-bold text-ink disabled:opacity-50 cursor-pointer"
                                    >
                                        Anterior
                                    </button>
                                    <span className="text-[12px] text-ink-soft">
                                        Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}
                                    </span>
                                    <button
                                        onClick={() => table.nextPage()}
                                        disabled={!table.getCanNextPage()}
                                        className="px-3 py-1 bg-surface-2 border border-line rounded-[6px] text-[12px] font-bold text-ink disabled:opacity-50 cursor-pointer"
                                    >
                                        Siguiente
                                    </button>
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
