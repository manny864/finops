"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { DollarSign, AlertTriangle, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  getSortedRowModel,
  SortingState
} from '@tanstack/react-table';

type Recommendation = {
  sku: string;
  term: string;
  costWithNoDiscounts: number;
  totalCostWithDiscounts: number;
  netSavings: number;
};

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const columnHelper = createColumnHelper<Recommendation>();

export default function RateOptimizationPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const t = useTranslations('Rates');
    const tc = useTranslations('Common');

    const columns = useMemo(() => [
      columnHelper.accessor('sku', {
        header: t('col_recommended_sku') || 'Recommended SKU',
        cell: info => <span className="font-medium text-ink">{info.getValue()}</span>,
      }),
      columnHelper.accessor('term', {
        header: t('col_term') || 'Term',
        cell: info => <span className="tag blue font-mono">{info.getValue()}</span>,
      }),
      columnHelper.accessor('costWithNoDiscounts', {
        header: t('col_payg_cost') || 'Pay-As-You-Go Cost',
        cell: info => currencyFormatter.format(info.getValue()),
      }),
      columnHelper.accessor('totalCostWithDiscounts', {
        header: t('col_reserved_cost') || 'Cost with Reservation',
        cell: info => currencyFormatter.format(info.getValue()),
      }),
      columnHelper.accessor('netSavings', {
        header: t('col_net_savings') || 'Net Savings',
        cell: info => <span className="text-green font-bold">+{currencyFormatter.format(info.getValue())}</span>,
      }),
    ], [t]);
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<Recommendation[]>([]);
    const [subscriptionId, setSubscriptionId] = useState('');
    const [subscriptions, setSubscriptions] = useState<any[]>([]);
    const [loadingSubs, setLoadingSubs] = useState(false);
    const [missingConsent, setMissingConsent] = useState(false);
    const [hasAnalyzed, setHasAnalyzed] = useState(false);
    
    // Filters
    const [scopeType, setScopeType] = useState<'Single' | 'Shared'>('Single');
    const [lookBackPeriod, setLookBackPeriod] = useState<'Last7Days' | 'Last30Days' | 'Last60Days'>('Last30Days');
    const [sorting, setSorting] = useState<SortingState>([]);

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
            } finally {
                setLoadingSubs(false);
            }
        };

        fetchSubscriptions();
    }, [selectedTenant, instance, accounts]);

    const handleAnalyze = async () => {
        if (!selectedTenant || selectedTenant.id === 'default') {
            toast.error(t('select_tenant'));
            return;
        }
        if (!subscriptionId) {
            toast.error(t('select_sub'));
            return;
        }

        setLoading(true);
        try {
            const url = `/api/intelligence/rates?tenantId=${selectedTenant.id}&subscriptionId=${subscriptionId}&scopeType=${scopeType}&lookBackPeriod=${lookBackPeriod}`;
            const res = await fetch(url);
            const json = await res.json();

            if (!res.ok) {
                throw new Error(json.error || json.details || t('error_unknown'));
            }

            if (json.recommendations) {
                const mappedData: Recommendation[] = json.recommendations.map((rec: any) => {
                    const props = rec.properties || {};
                    const savings = rec.savings || props.savings || {};
                    
                    let term = props.term || rec.term || 'Unknown Term';
                    if (term === 'P1Y' || term === 'P1Y (1 Year)') term = '1 Year';
                    else if (term === 'P3Y' || term === 'P3Y (3 Years)') term = '3 Years';
                    else if (term === 'P5Y') term = '5 Years';

                    let skuName = 'Unknown SKU';
                    const skuProps = props.skuProperties || rec.skuProperties || [];
                    if (Array.isArray(skuProps) && skuProps.length > 0) {
                        skuName = skuProps[0].name || skuProps[0].skuName;
                    } else if (skuProps?.name) {
                        skuName = skuProps.name;
                    } else if (props.sku?.name) {
                        skuName = props.sku.name;
                    } else if (rec.sku?.name) {
                        skuName = rec.sku.name;
                    } else if (typeof rec.sku === 'string') {
                        skuName = rec.sku;
                    }

                    const extractValue = (...vals: any[]) => {
                        for (const val of vals) {
                            if (val && typeof val === 'object' && val.value !== undefined) return Number(val.value);
                            if (typeof val === 'number') return val;
                        }
                        return 0;
                    };

                    return {
                        sku: skuName || 'Unknown SKU',
                        term: term,
                        costWithNoDiscounts: extractValue(props.costWithNoReservedInstances, rec.costWithNoReservedInstances, props.costWithNoDiscounts, savings.costWithNoReservedInstances),
                        totalCostWithDiscounts: extractValue(props.totalCostWithReservedInstances, rec.totalCostWithReservedInstances, props.totalCostWithDiscounts, savings.totalCostWithReservedInstances),
                        netSavings: extractValue(props.netSavings, rec.netSavings, savings.netSavings),
                    };
                });
                setData(mappedData);
                setHasAnalyzed(true);
                toast.success(t('analysis_complete', { count: mappedData.length }));
            }
        } catch (error: any) {
            console.error("Rates fetch error:", error);
            toast.error(error.message || t('error_fetching'));
        } finally {
            setLoading(false);
        }
    };

    const table = useReactTable({
        data,
        columns,
        state: {
            sorting,
        },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    const totalSavings = data.reduce((acc, curr) => acc + curr.netSavings, 0);

    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">💸</span>
                        {t('title')}
                    </div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
            </div>

            <div className="bg-brand-soft border border-brand-deep border-opacity-20 rounded-[14px] p-4 flex items-start text-brand-deep shadow-sm">
                <Info className="w-5 h-5 mr-3 mt-0.5 flex-shrink-0" />
                <div className="text-[13px]">
                    <p className="font-bold mb-1">{t('info_title')}</p>
                    <p>{t('info_desc')}</p>
                </div>
            </div>

            <div className="card">
                <div className="p-[18px]">
                {missingConsent ? (
                    <div className="p-4 bg-amber-soft text-amber rounded-[10px] flex items-center font-bold text-[13px]">
                        <AlertTriangle className="w-5 h-5 mr-3" />
                        {t('missing_consent')}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                        <div className="flex flex-col gap-2">
                            <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px]">{t('subscription_label')}</label>
                            <select
                                value={subscriptionId}
                                onChange={(e) => setSubscriptionId(e.target.value)}
                                disabled={loadingSubs || subscriptions.length === 0}
                                className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2.5 outline-none"
                            >
                                {loadingSubs ? (
                                    <option>{tc('loading_subs')}</option>
                                ) : subscriptions.length === 0 ? (
                                    <option>{t('no_subs')}</option>
                                ) : (
                                    subscriptions.map(sub => (
                                        <option key={sub.id} value={sub.id}>{sub.name || sub.displayName}</option>
                                    ))
                                )}
                            </select>
                        </div>
                        
                        <div className="flex flex-col gap-2">
                            <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px]">{t('scope_label')}</label>
                            <select
                                value={scopeType}
                                onChange={(e) => setScopeType(e.target.value as 'Single' | 'Shared')}
                                className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2.5 outline-none"
                            >
                                <option value="Single">{t('scope_single')}</option>
                                <option value="Shared">{t('scope_shared')}</option>
                            </select>
                        </div>

                        <div className="flex flex-col gap-2">
                            <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px]">{t('lookback_label')}</label>
                            <select
                                value={lookBackPeriod}
                                onChange={(e) => setLookBackPeriod(e.target.value as any)}
                                className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2.5 outline-none"
                            >
                                <option value="Last7Days">{t('last_7')}</option>
                                <option value="Last30Days">{t('last_30')}</option>
                                <option value="Last60Days">{t('last_60')}</option>
                            </select>
                        </div>

                        <button
                            onClick={handleAnalyze}
                            disabled={loading || !subscriptionId}
                            className="bg-brand-deep text-white rounded-[10px] hover:brightness-110 transition flex items-center justify-center font-heading font-bold text-[13px] disabled:opacity-50 h-[42px] shadow-sm cursor-pointer"
                        >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <DollarSign className="w-5 h-5 mr-2" />}
                            {t('find_savings')}
                        </button>
                    </div>
                )}
                </div>
            </div>

            {data.length > 0 && (
                <div className="sumstrip">
                    <div className="s green md:col-span-3 flex flex-col md:flex-row md:justify-between md:items-center">
                        <div>
                            <div className="l">{t('total_savings')}</div>
                            <div className="v">+{currencyFormatter.format(totalSavings)}</div>
                        </div>
                        <div className="mt-4 md:mt-0 text-[12px] text-ink-soft">
                            {t('savings_note', { days: lookBackPeriod.replace('Last', '').replace('Days', '') })}
                        </div>
                    </div>
                </div>
            )}

            {data.length > 0 ? (
                <div className="card">
                    <div className="overflow-x-auto">
                        <table className="tbl">
                            <thead>
                                {table.getHeaderGroups().map(headerGroup => (
                                    <tr key={headerGroup.id}>
                                        {headerGroup.headers.map(header => (
                                            <th 
                                                key={header.id} 
                                                className="cursor-pointer hover:bg-surface-2"
                                                onClick={header.column.getToggleSortingHandler()}
                                            >
                                                {flexRender(header.column.columnDef.header, header.getContext())}
                                                {{
                                                    asc: ' ↑',
                                                    desc: ' ↓',
                                                }[header.column.getIsSorted() as string] ?? null}
                                            </th>
                                        ))}
                                    </tr>
                                ))}
                            </thead>
                            <tbody>
                                {table.getRowModel().rows.map(row => (
                                    <tr key={row.id}>
                                        {row.getVisibleCells().map(cell => (
                                            <td key={cell.id}>
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                !loading && hasAnalyzed && (
                    <div className="empty border border-line rounded-[14px]">
                        <DollarSign className="w-12 h-12 text-grey mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-ink mb-2">{t('no_recs_title')}</h3>
                        <p className="text-ink-soft">{t('no_recs_desc')}</p>
                    </div>
                )
            )}
        </div>
    );
}
