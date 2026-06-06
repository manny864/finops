"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { DollarSign, AlertTriangle, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
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

const columnHelper = createColumnHelper<Recommendation>();

const columns = [
  columnHelper.accessor('sku', {
    header: 'Recommended SKU',
    cell: info => <span className="font-medium text-gray-900 dark:text-white">{info.getValue()}</span>,
  }),
  columnHelper.accessor('term', {
    header: 'Term',
    cell: info => <span className="px-2 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded text-xs">{info.getValue()}</span>,
  }),
  columnHelper.accessor('costWithNoDiscounts', {
    header: 'Pay-As-You-Go Cost',
    cell: info => `$${info.getValue().toFixed(2)}`,
  }),
  columnHelper.accessor('totalCostWithDiscounts', {
    header: 'Cost with Reservation',
    cell: info => `$${info.getValue().toFixed(2)}`,
  }),
  columnHelper.accessor('netSavings', {
    header: 'Net Savings',
    cell: info => <span className="text-emerald-600 dark:text-emerald-400 font-bold">+$${info.getValue().toFixed(2)}</span>,
  }),
];

export default function RateOptimizationPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
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
                toast.error("Error al cargar las suscripciones del tenant.");
            } finally {
                setLoadingSubs(false);
            }
        };

        fetchSubscriptions();
    }, [selectedTenant, instance, accounts]);

    const handleAnalyze = async () => {
        if (!selectedTenant || selectedTenant.id === 'default') {
            toast.error("Por favor selecciona un tenant primero.");
            return;
        }
        if (!subscriptionId) {
            toast.error("Selecciona una suscripción.");
            return;
        }

        setLoading(true);
        try {
            const url = `/api/intelligence/rates?tenantId=${selectedTenant.id}&subscriptionId=${subscriptionId}&scopeType=${scopeType}&lookBackPeriod=${lookBackPeriod}`;
            const res = await fetch(url);
            const json = await res.json();

            if (!res.ok) {
                throw new Error(json.error || json.details || 'Error desconocido');
            }

            if (json.recommendations) {
                // Map the Azure SDK response to our Table format
                const mappedData: Recommendation[] = json.recommendations.map((rec: any) => {
                    const props = rec.properties || {};
                    return {
                        sku: props.skuProperties?.[0]?.name || rec.sku?.name || 'Unknown SKU',
                        term: props.term || 'Unknown Term',
                        costWithNoDiscounts: props.costWithNoDiscounts || 0,
                        totalCostWithDiscounts: props.totalCostWithDiscounts || 0,
                        netSavings: props.netSavings || 0,
                    };
                });
                setData(mappedData);
                setHasAnalyzed(true);
                toast.success(`Análisis completado: ${mappedData.length} recomendaciones encontradas.`);
            }
        } catch (error: any) {
            console.error("Rates fetch error:", error);
            toast.error(error.message || "Error al obtener recomendaciones.");
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
        <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
                        <DollarSign className="w-8 h-8 mr-3 text-emerald-600" />
                        Optimización de Tarifas (Reservas)
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">
                        Analiza tu consumo histórico para encontrar ahorros a través de Instancias Reservadas o Savings Plans.
                    </p>
                </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 flex items-start">
                <Info className="w-5 h-5 text-blue-500 mr-3 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800 dark:text-blue-300">
                    <p className="font-semibold mb-1">¿Qué es una Reserva o Savings Plan?</p>
                    <p>Las reservas te permiten comprometerte a usar cierta cantidad de cómputo por 1 o 3 años a cambio de un descuento significativo frente al precio de Pago por Uso (Pay-As-You-Go). Las recomendaciones calculan el ahorro neto en base al uso histórico real de los recursos.</p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm">
                {missingConsent ? (
                    <div className="p-4 bg-yellow-50 text-yellow-800 rounded-md flex items-center">
                        <AlertTriangle className="w-5 h-5 mr-3" />
                        Falta el consentimiento de administrador para listar suscripciones de este Tenant.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Suscripción</label>
                            <select
                                value={subscriptionId}
                                onChange={(e) => setSubscriptionId(e.target.value)}
                                disabled={loadingSubs || subscriptions.length === 0}
                                className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-[#0054A6] focus:border-[#0054A6] p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
                            >
                                {loadingSubs ? (
                                    <option>Cargando suscripciones...</option>
                                ) : subscriptions.length === 0 ? (
                                    <option>No hay suscripciones</option>
                                ) : (
                                    subscriptions.map(sub => (
                                        <option key={sub.id} value={sub.id}>{sub.name || sub.displayName}</option>
                                    ))
                                )}
                            </select>
                        </div>
                        
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Alcance (Scope)</label>
                            <select
                                value={scopeType}
                                onChange={(e) => setScopeType(e.target.value as 'Single' | 'Shared')}
                                className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-[#0054A6] focus:border-[#0054A6] p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
                            >
                                <option value="Single">Single (Solo esta suscripción)</option>
                                <option value="Shared">Shared (Toda la cuenta de facturación)</option>
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Ventana Histórica (LookBack)</label>
                            <select
                                value={lookBackPeriod}
                                onChange={(e) => setLookBackPeriod(e.target.value as any)}
                                className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-[#0054A6] focus:border-[#0054A6] p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
                            >
                                <option value="Last7Days">Últimos 7 Días</option>
                                <option value="Last30Days">Últimos 30 Días</option>
                                <option value="Last60Days">Últimos 60 Días</option>
                            </select>
                        </div>

                        <button
                            onClick={handleAnalyze}
                            disabled={loading || !subscriptionId}
                            className="bg-[#0054A6] text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 transition flex items-center justify-center font-medium disabled:opacity-50 h-[42px]"
                        >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <DollarSign className="w-5 h-5 mr-2" />}
                            Buscar Ahorros
                        </button>
                    </div>
                )}
            </div>

            {data.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm col-span-1 md:col-span-3 flex flex-col md:flex-row md:justify-between md:items-center">
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Potencial de Ahorro Neto Total</p>
                            <h3 className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">+${totalSavings.toFixed(2)} USD</h3>
                        </div>
                        <div className="mt-4 md:mt-0 text-sm text-gray-600 dark:text-gray-400">
                            Recomendaciones generadas basadas en el uso de {lookBackPeriod.replace('Last', '').replace('Days', '')} días.
                        </div>
                    </div>
                </div>
            )}

            {data.length > 0 ? (
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-50 dark:bg-slate-800/50 text-gray-700 dark:text-gray-300 font-medium border-b border-gray-200 dark:border-slate-700">
                                {table.getHeaderGroups().map(headerGroup => (
                                    <tr key={headerGroup.id}>
                                        {headerGroup.headers.map(header => (
                                            <th 
                                                key={header.id} 
                                                className="px-6 py-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-800"
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
                            <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
                                {table.getRowModel().rows.map(row => (
                                    <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                                        {row.getVisibleCells().map(cell => (
                                            <td key={cell.id} className="px-6 py-4 text-gray-600 dark:text-gray-400">
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
                    <div className="bg-white dark:bg-slate-900 p-12 text-center rounded-xl border border-gray-200 dark:border-slate-800">
                        <DollarSign className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No hay recomendaciones</h3>
                        <p className="text-gray-500 dark:text-gray-400">Azure no ha encontrado oportunidades de reserva que resulten en ahorro neto para la configuración seleccionada.</p>
                    </div>
                )
            )}
        </div>
    );
}
