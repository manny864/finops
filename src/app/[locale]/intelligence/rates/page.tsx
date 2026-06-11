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
  resourceName: string;
  resourceType: string;
  sku: string;
  region: string;
  monthlyCost: number;
  monthlyCostLicenseIncluded: number;
  annualCost: number;
  annualCost1Y: number;
  annualCost3Y: number;
  savings1Y: number;
  savings3Y: number;
};

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const columnHelper = createColumnHelper<Recommendation>();

export default function RateOptimizationPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const t = useTranslations('Rates');
    const tc = useTranslations('Common');

    const columns = useMemo(() => [
      columnHelper.accessor('resourceName', {
        header: 'Resource Name',
        cell: info => <span className="font-medium text-ink">{info.getValue()}</span>,
      }),
      columnHelper.accessor('resourceType', {
        header: 'Type',
        cell: info => {
            const val = info.getValue();
            let color = 'grey';
            if (val === 'Virtual Machine') color = 'blue';
            else if (val === 'App Service Plan') color = 'purple';
            else if (val === 'SQL Database') color = 'teal';
            return <span className={`tag ${color}`}>{val}</span>;
        },
      }),
      columnHelper.accessor('sku', {
        header: 'SKU',
        cell: info => <span className="text-ink-soft">{info.getValue()}</span>,
      }),
      columnHelper.accessor('region', {
        header: 'Region',
        cell: info => <span className="tag blue">{info.getValue()}</span>,
      }),
      columnHelper.accessor('monthlyCostLicenseIncluded', {
        header: 'Costo Mensual (Licencia Incluida)',
        cell: info => currencyFormatter.format(info.getValue()),
      }),
      columnHelper.accessor('monthlyCost', {
        header: () => (
            <div className="flex items-center gap-1 group relative">
                Costo Mensual (AHB)
                <Info className="w-3.5 h-3.5 text-brand-bright" />
                <div className="absolute top-full mt-2 hidden group-hover:block bg-black text-white text-[10px] px-2 py-1 rounded w-64 whitespace-normal text-center z-50 left-1/2 -translate-x-1/2">
                    Save up to 50% over standard pay-as-you-go rate by applying Azure Hybrid Benefit.
                </div>
            </div>
        ),
        cell: info => currencyFormatter.format(info.getValue()),
      }),
      columnHelper.accessor('annualCost', {
        header: 'Costo Anual (PAYG)',
        cell: info => currencyFormatter.format(info.getValue()),
      }),
      columnHelper.accessor('annualCost1Y', {
        header: 'Costo Anual (1Y RI)',
        cell: info => currencyFormatter.format(info.getValue()),
      }),
      columnHelper.accessor('annualCost3Y', {
        header: 'Costo Anual (3Y RI)',
        cell: info => currencyFormatter.format(info.getValue()),
      }),
      columnHelper.accessor('savings1Y', {
        header: 'Ahorro 1 Año ($)',
        cell: info => <span className="text-green font-bold">+{currencyFormatter.format(info.getValue())}</span>,
      }),
      columnHelper.accessor('savings3Y', {
        header: 'Ahorro 3 Años ($)',
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
            const url = `/api/intelligence/rates?tenantId=${selectedTenant.id}&subscriptionId=${subscriptionId}`;
            const res = await fetch(url);
            const json = await res.json();

            if (!res.ok) {
                throw new Error(json.error || json.details || t('error_unknown'));
            }

            if (json.recommendations) {
                setData(json.recommendations);
                setHasAnalyzed(true);
                toast.success(t('analysis_complete', { count: json.recommendations.length }));
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

    const totalSavings = data.reduce((acc, curr) => acc + Math.max(curr.savings1Y || 0, curr.savings3Y || 0), 0);

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
                    <div className="flex flex-col md:flex-row gap-4 items-end">
                        <div className="flex flex-col gap-2 w-full md:w-auto">
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
                        
                        <button
                            onClick={handleAnalyze}
                            disabled={loading || !subscriptionId}
                            className="bg-brand-deep text-white rounded-[10px] hover:brightness-110 transition flex items-center justify-center font-heading font-bold text-[13px] disabled:opacity-50 h-[42px] px-6 shadow-sm cursor-pointer ml-auto md:ml-0"
                        >
                            <span>{loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <DollarSign className="w-5 h-5 mr-2" />}</span>
                            <span>{t('find_savings')}</span>
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
                            {t('savings_note', { days: '30' })}
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
