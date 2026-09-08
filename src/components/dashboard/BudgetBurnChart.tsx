"use client";
import { useTranslations } from 'next-intl';
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '../TenantProvider';
import { useSubscription } from '../SubscriptionProvider';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, LabelList, Legend } from 'recharts';
import { useCurrency } from '../CurrencyProvider';

interface BudgetBurnChartProps {
    onHeightChange?: (h: number) => void;
}

export default function BudgetBurnChart({ onHeightChange }: BudgetBurnChartProps) {
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const { selectedSubscription, subscriptions } = useSubscription();
    const { format } = useCurrency();
    const [burnData, setBurnData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => {
        setIsMounted(true);
    }, []);
    const [missingConsent, setMissingConsent] = useState(false);

    useEffect(() => {
        if (accounts.length === 0 || selectedTenant.id === 'default') return;
        if (subscriptions.length === 0) return;
        
        const fetchBurnData = async () => {
            setLoading(true);
            setMissingConsent(false);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                
                // Si la suscripción global es "All", usamos todas las suscripciones
                const subIds = selectedSubscription !== 'All'
                    ? selectedSubscription
                    : 'All';
                
                if (!subIds) {
                    setLoading(false);
                    return;
                }

                const res = await fetch(`/api/budgets/burn?tenantId=${selectedTenant.id}&subscriptionId=${subIds}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                
                if (json.error === "MISSING_ADMIN_CONSENT") {
                    setMissingConsent(true);
                } else if (json.burnData) {
                    const enrichedData = json.burnData.map((item: any) => {
                        const sub = subscriptions.find((s: any) => s.id === item.subscriptionId);
                        const subName = sub ? sub.name : item.subscriptionId;
                        const label = item.costCenter ? item.costCenter : `Budget - ${subName}`;
                        return {
                            ...item,
                            costCenter: label
                        };
                    });
                    setBurnData(enrichedData);
                    
                    // Calcular nueva altura de la tarjeta.
                    // 1 barra ocupa unos 40px, el header/padding unos 80px.
                    // Cada 'h' (unidad de grid) son 80px.
                    if (onHeightChange) {
                        const requiredPx = 80 + (enrichedData.length * 40);
                        const requiredH = Math.max(4, Math.ceil(requiredPx / 80));
                        onHeightChange(requiredH);
                    }
                }
            } catch (e) {
                console.error("Error fetching budget burn data:", e);
            }
            setLoading(false);
        };
        fetchBurnData();
    }, [accounts, instance, selectedTenant.id, selectedSubscription, subscriptions, onHeightChange]);

    const t = useTranslations('Dashboard');

    if (accounts.length === 0 || selectedTenant.id === 'default') return null;

    return (
        <div className="card h-full flex flex-col overflow-hidden">
            <div className="card-h shrink-0 border-b-0 pb-0">
                <div className="flex flex-col">
                    <h3 className="m-0 text-[var(--brand-deep)]">{t('budget_by_cost_center')}</h3>
                    <p className="text-[13px] text-ink-soft m-0 mt-1 font-normal">{t('budget_desc')}</p>
                </div>
            </div>
            
            <div className="p-[18px] flex-1 flex flex-col min-h-0 relative">
                {missingConsent ? (
                    <div className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-4 rounded">
                        <p className="text-sm text-amber-800">
                            <strong>Falta Admin Consent:</strong>
                        </p>
                        <p className="text-xs text-amber-700 mt-1">
                            {t("budget_consent_notice")}
                        </p>
                        <div className="mt-2 bg-amber-100 p-2 rounded text-xs font-mono text-amber-900 overflow-x-auto">
                            az ad sp create --id 876d8a5b-6023-4484-b3ba-73c186e4a72b
                        </div>
                    </div>
                ) : loading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-sm text-gray-400 animate-pulse">{t("analyzingCostManagement")}</div>
                    </div>
                ) : burnData.length === 0 ? (
                    <div className="flex-1 text-sm text-gray-400 flex flex-col items-center justify-center text-center">
                        {t("budget_none_line1")}<br/>
                        {t("budget_none_line2")}
                    </div>
                ) : (
                    <div className="flex-1 w-full min-w-0" style={{ minHeight: `${Math.max(150, burnData.length * 40)}px` }}>
                        {!isMounted ? null : (
                            <ResponsiveContainer width="100%" height={Math.max(150, burnData.length * 40)} minWidth={0}>
                            <BarChart layout="vertical" data={burnData} margin={{ top: 10, right: 62, left: 4, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f3f4f6" />
                                {/* UN SOLO eje X para las dos series.
                                    Antes había dos (`xAxisId` 0 y 1), y recharts
                                    autoescala el dominio de cada eje por separado:
                                    un presupuesto de 150 y un gasto de 10 se
                                    dibujaban casi del mismo largo porque cada barra
                                    llegaba al máximo de SU propio eje. Compartiendo
                                    el eje, el dominio es [0, max(budget, actual)] y
                                    los largos son comparables entre sí. */}
                                {/* 15% de aire arriba del maximo: con domain 'dataMax' la barra mas
                                    larga toca el borde y su etiqueta de monto queda cortada. */}
                                <XAxis
                                    type="number"
                                    xAxisId={0}
                                    domain={[0, (dataMax: number) => (dataMax > 0 ? dataMax * 1.15 : 1)]}
                                    hide
                                />
                                {/* width 220 dejaba ~70px de area de dibujo en una tarjeta de ~330px:
                                    las barras salian como muñones aunque el dominio
                                    fuera correcto. Con 108 y nombres truncados, la
                                    barra tiene lugar para representar la proporcion. */}
                                <YAxis
                                    type="category"
                                    dataKey="costCenter"
                                    width={108}
                                    tick={{fill: '#6b7280', fontSize: 10}}
                                    tickLine={false}
                                    axisLine={{stroke: '#e5e7eb'}}
                                    tickFormatter={(v: any) => {
                                        const str = String(v ?? '');
                                        return str.length > 16 ? `${str.slice(0, 15)}…` : str;
                                    }}
                                />
                                <Tooltip 
                                    wrapperStyle={{ zIndex: 9999 }}
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const data = payload[0].payload;
                                            // Mismo criterio de color que la barra "Gasto Actual"
                                            // (ver Cell abajo) para que el tooltip no confunda:
                                            // rojo ≥90%, ámbar ≥75%, azul si está sano.
                                            const ratio = data.budget > 0 ? data.actual / data.budget : 0;
                                            const gastoColor = ratio >= 0.9 ? '#ef4444' : ratio >= 0.75 ? '#f59e0b' : '#0054a6';
                                            return (
                                                <div className="bg-white dark:bg-slate-900 p-3 rounded-lg shadow-lg border border-gray-100">
                                                    <p className="font-bold text-sm text-gray-800 mb-1">{data.costCenter}</p>
                                                    <p className="text-xs text-gray-600">
                                                        {t.rich("budget_tooltip_line", { spend: format(Number(data.actual) || 0), budget: format(Number(data.budget) || 0), b: (c) => <span className="font-bold" style={{ color: gastoColor }}>{c}</span>, bb: (c) => <span className="font-bold" style={{ color: '#0d9488' }}>{c}</span>, est: (c) => (data.estimated ? <span className="text-[10px] text-gray-400" title={t("budget_tooltip_est_title")}>{c}</span> : null) })}
                                                    </p>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                    cursor={{fill: 'transparent'}}
                                />
                                
                                <Legend verticalAlign="top" height={24} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />

                                {/* Las dos barras van lado a lado en la misma banda y
                                    sobre el mismo eje. Antes se superponían (gruesa de
                                    fondo + fina al frente), efecto que sólo funciona si
                                    ambas comparten dominio — y no lo compartían. */}
                                <Bar dataKey="budget" name={t('budget_legend_assigned')} xAxisId={0} barSize={11} fill="#0d9488" radius={[0, 4, 4, 0]}>
                                    <LabelList dataKey="budget" position="right" style={{ fontSize: 10, fill: '#0d9488' }} formatter={(v: any) => format(Number(v) || 0)} />
                                </Bar>

                                <Bar dataKey="actual" name={t('budget_legend_actual')} xAxisId={0} barSize={11} radius={[0, 4, 4, 0]}>
                                    {burnData.map((entry, index) => {
                                        const ratio = entry.budget > 0 ? entry.actual / entry.budget : 0;
                                        // Rojo si excede el 90%, Ámbar si pasa el 75%, Verde si está bien.
                                        const color = ratio >= 0.9 ? '#ef4444' : ratio >= 0.75 ? '#f59e0b' : '#0054a6';
                                        return <Cell key={`cell-${index}`} fill={color} />;
                                    })}
                                    <LabelList dataKey="actual" position="right" style={{ fontSize: 10, fill: '#6b7280' }} formatter={(v: any) => format(Number(v) || 0)} />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
