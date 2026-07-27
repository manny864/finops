"use client";
import MockBanner from '@/components/MockBanner';
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import { DEFAULT_LICENSE_SAVINGS_PCT } from "@/lib/simulator/engine";
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Calculator, Play, Network, HardDrive, Cpu, ShieldCheck, DollarSign, RotateCcw, Loader2, Sparkles } from 'lucide-react';
import { hasAccess } from '@/lib/tierLogic';
import { toast } from 'sonner';
import { getFreshIdToken } from '@/lib/msalToken';
import ScenarioManager from '@/components/simulator/ScenarioManager';
import { isMockTenant } from '@/lib/mockData';

export default function SimulatorPage() {
    const t = useProviderTranslations("Simulator");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const isEnterprise = hasAccess(selectedTenant.tier || 'Essential', 'Enterprise');

    const [networkIncrease, setNetworkIncrease] = useState(0);
    const [computeScale, setComputeScale] = useState(100);
    const [storageScale, setStorageScale] = useState(100);
    const [applyAhb, setApplyAhb] = useState(false);
    // El ahorro por licencias es un supuesto explicito y editable: arranca en
    // el 18% historico del AHB.
    const defaultLicensePct = DEFAULT_LICENSE_SAVINGS_PCT.azure;
    const [licenseSavingsPct, setLicenseSavingsPct] = useState<number>(defaultLicensePct);

    useEffect(() => {
        setLicenseSavingsPct(defaultLicensePct);
    }, [defaultLicensePct]);

    // Costo Base: se precarga con el gasto real del tenant (GET al mismo
    // endpoint que usa la simulación) pero es editable — el usuario puede
    // sobrescribirlo para simular un escenario hipotético ("¿y si arrancara
    // desde $50k?"). baseCostEdited distingue "valor real sin tocar" de
    // "el usuario lo cambió a mano", para que el backend sepa cuándo respetar
    // la edición y cuándo seguir usando el gasto real (ver overrideBaseCost
    // en /api/intelligence/simulator).
    const [baseCost, setBaseCost] = useState<number | null>(null);
    const [realBaseCost, setRealBaseCost] = useState<number | null>(null);
    const [baseCostEdited, setBaseCostEdited] = useState(false);
    const [baseCostLoading, setBaseCostLoading] = useState(false);

    const [loading, setLoading] = useState(false);
    const [simulationData, setSimulationData] = useState<any>(null);

    const fetchRealBaseCost = useCallback(async () => {
        if (selectedTenant.id === 'default') return;
        if (!accounts[0] && !isMockTenant(selectedTenant.id)) return;
        setBaseCostLoading(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch(`/api/intelligence/simulator?tenantId=${selectedTenant.id}`, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            const json = await res.json();
            if (res.ok && typeof json.baseCost === 'number') {
                setRealBaseCost(json.baseCost);
                setBaseCost(json.baseCost);
                setBaseCostEdited(false);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setBaseCostLoading(false);
        }
    }, [instance, accounts, selectedTenant.id]);

    useEffect(() => {
        fetchRealBaseCost();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- solo re-fetch al cambiar de tenant, no en cada render de fetchRealBaseCost
    }, [selectedTenant.id]);

    const handleSimulate = async () => {
        if (!isEnterprise) return;
        setLoading(true);
        try {
            const account = accounts[0];
            const tokenResponse = { idToken: await getFreshIdToken(instance, account) };

            // El costo base default es el gasto real del tenant (precargado por
            // fetchRealBaseCost). Si el usuario lo editó a mano, overrideBaseCost
            // le indica al backend que respete ese valor tal cual en vez de
            // recalcular el real — ver /api/intelligence/simulator (POST).
            const res = await fetch('/api/intelligence/simulator', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    scenario: {
                        ...(baseCost ? { baseCost, overrideBaseCost: baseCostEdited } : {}),
                        networkIncrease,
                        computeScale: computeScale / 100,
                        storageScale: storageScale / 100,
                        applyAhb,
                        licenseSavingsPct
                    }
                })
            });

            const json = await res.json();
            if (res.ok) {
                setSimulationData(json.simulation);
                toast.success(t('toastSuccess'));
            } else {
                toast.error(json.error || t('toastFailDefault'));
            }
        } catch (e) {
            console.error(e);
            toast.error(t('toastConnError'));
        } finally {
            setLoading(false);
        }
    };

    if (selectedTenant.id === 'default') return null;

    if (!isEnterprise) {
        return (
            <div className="p-6">
                <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/50 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-sm">
                    <Calculator className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('lockedTitle')}</h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                        {t('lockedDesc')} <b>Enterprise</b>.
                    </p>
                    <button className="px-6 py-3 bg-brand-deep text-white font-bold rounded-lg shadow hover:bg-brand-bright transition-colors">
                        {t('lockedCta')}
                    </button>
                </div>
            </div>
        );
    }

    const chartData = simulationData ? [
        {
            name: t('chartActual'),
            Compute: simulationData.baseCost * 0.6,
            Storage: simulationData.baseCost * 0.25,
            Network: simulationData.baseCost * 0.15,
        },
        {
            name: t('chartProjected'),
            Compute: simulationData.breakdown.compute,
            Storage: simulationData.breakdown.storage,
            Network: simulationData.breakdown.network,
        }
    ] : [];

    return (
        <div className="p-6 max-w-7xl mx-auto animate-in fade-in duration-500 space-y-8">
            <MockBanner />
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-8 rounded-3xl text-white shadow-xl relative overflow-hidden">
                <div className="absolute -right-10 -bottom-10 w-60 h-60 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
                <div className="relative z-10">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-semibold mb-3">
                        <Sparkles className="w-3.5 h-3.5" />
                        FinOps ROI Simulator
                    </div>
                    <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white flex items-center gap-3">
                        <Calculator className="w-9 h-9 text-indigo-400" />
                        {t('pageTitle')}
                    </h1>
                    <p className="text-indigo-200/80 text-sm md:text-base mt-2 max-w-2xl">
                        {t('pageSubtitle')}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Controles */}
                <div className="lg:col-span-1 flex flex-col gap-6">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6 border-b border-gray-100 dark:border-slate-800 pb-3">
                            {t('variablesTitle')}
                        </h3>

                        <div className="flex flex-col gap-6">
                            {/* Costo Base */}
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                                    <DollarSign className="w-4 h-4 text-emerald-600" />
                                    {t('baseCostLabel')}
                                </label>
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                                        {baseCostLoading ? (
                                            <div className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 flex items-center">
                                                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                                            </div>
                                        ) : (
                                            <input
                                                type="number"
                                                min="0"
                                                step="100"
                                                value={baseCost ?? ''}
                                                onChange={(e) => {
                                                    const v = parseFloat(e.target.value);
                                                    setBaseCost(Number.isFinite(v) ? v : null);
                                                    setBaseCostEdited(true);
                                                }}
                                                className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold"
                                            />
                                        )}
                                    </div>
                                    {baseCostEdited && realBaseCost != null && (
                                        <button
                                            type="button"
                                            onClick={() => { setBaseCost(realBaseCost); setBaseCostEdited(false); }}
                                            title={t('restoreCostTooltip')}
                                            className="p-2 text-gray-400 hover:text-brand-deep rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800"
                                        >
                                            <RotateCcw className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                                <p className="text-[11px] text-gray-400">
                                    {baseCostEdited
                                        ? t('baseCostEditedHint')
                                        : t('baseCostRealHint')}
                                </p>
                            </div>

                            {/* Compute */}
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                                    <Cpu className="w-4 h-4 text-brand-deep" />
                                    {t('computeLabel')}
                                </label>
                                <div className="flex items-center gap-4">
                                    <input 
                                        type="range" min="50" max="300" step="10" 
                                        value={computeScale} onChange={(e) => setComputeScale(parseInt(e.target.value))}
                                        className="w-full accent-brand-deep"
                                    />
                                    <span className="text-sm font-bold w-12 text-right">{computeScale}%</span>
                                </div>
                            </div>

                            {/* Network */}
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                                    <Network className="w-4 h-4 text-emerald-500" />
                                    {t('networkLabel')}
                                </label>
                                <div className="flex items-center gap-4">
                                    <input 
                                        type="range" min="-50" max="200" step="10" 
                                        value={networkIncrease} onChange={(e) => setNetworkIncrease(parseInt(e.target.value))}
                                        className="w-full accent-emerald-500"
                                    />
                                    <span className="text-sm font-bold w-12 text-right">{networkIncrease > 0 ? '+' : ''}{networkIncrease}%</span>
                                </div>
                            </div>

                            {/* Storage */}
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                                    <HardDrive className="w-4 h-4 text-amber-500" />
                                    {t('storageLabel')}
                                </label>
                                <div className="flex items-center gap-4">
                                    <input 
                                        type="range" min="50" max="500" step="25" 
                                        value={storageScale} onChange={(e) => setStorageScale(parseInt(e.target.value))}
                                        className="w-full accent-amber-500"
                                    />
                                    <span className="text-sm font-bold w-12 text-right">{storageScale}%</span>
                                </div>
                            </div>

                            {/* AHB */}
                            <div className="flex items-center justify-between border-t border-gray-100 dark:border-slate-800 pt-4 mt-2">
                                <div className="flex items-center gap-2">
                                    <ShieldCheck className="w-5 h-5 text-indigo-500" />
                                    <div className="flex flex-col">
                                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('ahbLabel')}</span>
                                        <span className="text-[10px] text-gray-500">{t('ahbHint')}</span>
                                    </div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" className="sr-only peer" checked={applyAhb} onChange={() => setApplyAhb(!applyAhb)} />
                                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-500"></div>
                                </label>
                            </div>

                            {applyAhb && (
                                <div className="pl-7">
                                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                                        {t('licenseSavingsLabel')}
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            value={licenseSavingsPct}
                                            onChange={(e) => {
                                                const v = parseInt(e.target.value, 10);
                                                setLicenseSavingsPct(Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0);
                                            }}
                                            className="w-24 px-2 py-1 rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-gray-900 dark:text-white"
                                            aria-label={t('licenseSavingsLabel')}
                                        />
                                        <span className="text-sm text-gray-500">%</span>
                                    </div>
                                    <p className="text-[10px] text-gray-500 mt-1">{t('licenseSavingsHint')}</p>
                                </div>
                            )}

                            <button
                                onClick={handleSimulate}
                                disabled={loading || baseCostLoading || !baseCost}
                                className="mt-4 w-full py-3 bg-brand-deep hover:bg-brand-bright text-white font-bold rounded-lg shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {loading ? <span className="animate-pulse">{t('runningButton')}</span> : <><Play className="w-4 h-4" /> {t('runButton')}</>}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Resultados */}
                <div className="lg:col-span-2">
                    {simulationData ? (
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 flex flex-col h-full animate-in zoom-in-95 duration-300">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6">{t('resultsTitle')}</h3>

                            <div className="grid grid-cols-2 gap-4 mb-8">
                                <div className="p-4 bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-gray-100 dark:border-slate-700">
                                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">{t('baseCostResultLabel')}</p>
                                    <p className="text-3xl font-black text-gray-800 dark:text-gray-100">
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(simulationData.baseCost)}
                                    </p>
                                </div>
                                <div className={`p-4 rounded-lg border ${simulationData.projectedCost > simulationData.baseCost ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800/50' : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50'}`}>
                                    <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${simulationData.projectedCost > simulationData.baseCost ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                        {t('projectedCostLabel')}
                                    </p>
                                    <div className="flex items-end gap-3">
                                        <p className={`text-3xl font-black ${simulationData.projectedCost > simulationData.baseCost ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(simulationData.projectedCost)}
                                        </p>
                                        <p className={`text-sm font-bold mb-1 ${simulationData.projectedCost > simulationData.baseCost ? 'text-rose-600' : 'text-emerald-600'}`}>
                                            {simulationData.projectedCost > simulationData.baseCost ? '+' : ''}
                                            {(((simulationData.projectedCost - simulationData.baseCost) / simulationData.baseCost) * 100).toFixed(1)}%
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 min-h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontWeight: 600 }} />
                                        <YAxis tickFormatter={(v) => `$${v/1000}k`} axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} />
                                        <Tooltip 
                                            formatter={(value: any) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                        />
                                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                        <Bar dataKey="Compute" stackId="a" fill="#0054A6" radius={[0, 0, 4, 4]} />
                                        <Bar dataKey="Storage" stackId="a" fill="#F59E0B" />
                                        <Bar dataKey="Network" stackId="a" fill="#10B981" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 flex flex-col items-center justify-center h-full min-h-[400px] text-center">
                            <Calculator className="w-16 h-16 text-gray-300 dark:text-gray-700 mb-4" />
                            <h3 className="text-xl font-bold text-gray-500 dark:text-gray-400 mb-2">{t('readyTitle')}</h3>
                            <p className="text-gray-400 dark:text-gray-500 max-w-sm">
                                {t('readyDesc')}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <ScenarioManager
                currentInputs={{
                    computeScale: computeScale / 100,
                    storageScale: storageScale / 100,
                    networkIncrease,
                    applyAhb,
                }}
                currentBaseCost={simulationData?.baseCost ?? null}
                currency="USD"
            />
        </div>
    );
}
