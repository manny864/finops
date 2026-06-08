"use client";
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '../TenantProvider';
import { useSubscription } from '../SubscriptionProvider';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';

export default function BudgetBurnChart() {
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
                
                // Si la suscripción global es "All", usamos la primera disponible como respaldo o la lógica que prefieras.
                // Como BudgetBurnChart requiere una suscripción específica para la API de budgets de cost management:
                const subId = selectedSubscription !== 'All' ? selectedSubscription : subscriptions[0].id;
                
                // Si aún no tenemos un ID de suscripción válido, salimos
                if (!subId) {
                    setLoading(false);
                    return;
                }

                // Averiguar el tenant de la suscripción seleccionada si lo necesitamos, 
                // en SubscriptionProvider ya tenemos subscriptions[]
                const subObj = subscriptions.find(s => s.id === subId);
                const subTenantId = subObj ? (subObj as any).tenantId : selectedTenant.id;
                
                const res = await fetch(`/api/budgets/burn?tenantId=${subTenantId || selectedTenant.id}&subscriptionId=${subId}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                
                if (json.error === "MISSING_ADMIN_CONSENT") {
                    setMissingConsent(true);
                } else if (json.burnData) {
                    setBurnData(json.burnData);
                }
            } catch (e) {
                console.error("Error fetching budget burn data:", e);
            }
            setLoading(false);
        };
        fetchBurnData();
    }, [accounts, instance, selectedTenant.id, selectedSubscription, subscriptions]);

    if (accounts.length === 0 || selectedTenant.id === 'default') return null;

    return (
        <div className="card h-full flex flex-col overflow-hidden">
            <div className="card-h shrink-0 border-b-0 pb-0">
                <div className="flex flex-col">
                    <h3 className="m-0 text-[var(--brand-deep)]">Presupuesto por Centro de Costos</h3>
                    <p className="text-[13px] text-ink-soft m-0 mt-1 font-normal">Muestra el límite asignado vs el gasto amortizado actual.</p>
                </div>
            </div>
            
            <div className="p-[18px] flex-1 flex flex-col min-h-0">
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
                    <div className="flex-1 w-full min-w-0" style={{ minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={burnData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="costCenter" />
                                <YAxis tickFormatter={(val: any) => `$${val}`} />
                                <Tooltip formatter={(val: any) => `$${Number(val).toFixed(2)} USD`} cursor={{fill: 'transparent'}} />
                                
                                <Bar dataKey="budget" name="Presupuesto Asignado" fill="#e5e7eb" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="actual" name="Gasto Actual" radius={[4, 4, 0, 0]}>
                                    {burnData.map((entry, index) => {
                                        const ratio = entry.budget > 0 ? entry.actual / entry.budget : 0;
                                        const color = ratio >= 0.8 ? '#ef4444' : '#10b981';
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
