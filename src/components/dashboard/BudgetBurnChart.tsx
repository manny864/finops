"use client";
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '../TenantProvider';
import { useSubscription } from '../SubscriptionProvider';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';

interface BudgetBurnChartProps {
    onHeightChange?: (h: number) => void;
}

export default function BudgetBurnChart({ onHeightChange }: BudgetBurnChartProps) {
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const { selectedSubscription, subscriptions } = useSubscription();
    const [burnData, setBurnData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
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
                    : subscriptions.map(s => s.id).join(',');
                
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
                    setBurnData(json.burnData);
                    
                    // Calcular nueva altura de la tarjeta.
                    // 1 barra ocupa unos 40px, el header/padding unos 80px.
                    // Cada 'h' (unidad de grid) son 80px.
                    if (onHeightChange) {
                        const requiredPx = 80 + (json.burnData.length * 40);
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

    let t: any = (key: string) => key;
    try {
      const nextIntl = require('next-intl');
      if (nextIntl && nextIntl.useTranslations) {
        t = nextIntl.useTranslations();
      }
    } catch (e) {}

    if (accounts.length === 0 || selectedTenant.id === 'default') return null;

    return (
        <div className="card h-full flex flex-col overflow-hidden">
            <div className="card-h shrink-0 border-b-0 pb-0">
                <div className="flex flex-col">
                    <h3 className="m-0 text-[var(--brand-deep)]">{t('Dashboard.budget_by_cost_center')}</h3>
                    <p className="text-[13px] text-ink-soft m-0 mt-1 font-normal">{t('Dashboard.budget_desc')}</p>
                </div>
            </div>
            
            <div className="p-[18px] flex-1 flex flex-col min-h-0 relative">
                {missingConsent ? (
                    <div className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-4 rounded">
                        <p className="text-sm text-amber-800">
                            <strong>Falta Admin Consent:</strong>
                        </p>
                        <p className="text-xs text-amber-700 mt-1">
                            La aplicación de CSCloudSolutions no ha sido consentida en este Tenant. Crea el Service Principal con Azure CLI:
                        </p>
                        <div className="mt-2 bg-amber-100 p-2 rounded text-xs font-mono text-amber-900 overflow-x-auto">
                            az ad sp create --id 876d8a5b-6023-4484-b3ba-73c186e4a72b
                        </div>
                    </div>
                ) : loading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-sm text-gray-400 animate-pulse">Analizando Azure Cost Management...</div>
                    </div>
                ) : burnData.length === 0 ? (
                    <div className="flex-1 text-sm text-gray-400 flex flex-col items-center justify-center text-center">
                        No hay presupuestos configurados para este Tenant.<br/>
                        Utiliza la API de Presupuestos para configurarlos.
                    </div>
                ) : (
                    <div className="flex-1 w-full" style={{ minHeight: `${Math.max(150, burnData.length * 40)}px` }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart layout="vertical" data={burnData} margin={{ top: 10, right: 30, left: 100, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f3f4f6" />
                                <XAxis type="number" xAxisId={0} hide />
                                <XAxis type="number" xAxisId={1} hide />
                                <YAxis type="category" dataKey="costCenter" width={100} tick={{fill: '#6b7280', fontSize: 12}} tickLine={false} axisLine={{stroke: '#e5e7eb'}} />
                                <Tooltip 
                                    formatter={(val: any) => `$${Number(val).toFixed(2)} USD`} 
                                    cursor={{fill: 'transparent'}}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                
                                {/* Barra Gruesa de Fondo (Presupuesto) */}
                                <Bar dataKey="budget" name="Presupuesto Asignado" xAxisId={0} barSize={24} fill="#f3f4f6" radius={[0, 4, 4, 0]} />
                                
                                {/* Barra Fina Frontal (Gasto Actual) */}
                                <Bar dataKey="actual" name="Gasto Actual" xAxisId={1} barSize={12} radius={[0, 4, 4, 0]}>
                                    {burnData.map((entry, index) => {
                                        const ratio = entry.budget > 0 ? entry.actual / entry.budget : 0;
                                        // Rojo si excede el 90%, Ámbar si pasa el 75%, Verde si está bien.
                                        const color = ratio >= 0.9 ? '#ef4444' : ratio >= 0.75 ? '#f59e0b' : '#3b82f6';
                                        return <Cell key={`cell-${index}`} fill={color} />;
                                    })}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </div>
    );
}
