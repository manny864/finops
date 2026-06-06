"use client";
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '../TenantProvider';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';

export default function BudgetBurnChart() {
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const [burnData, setBurnData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [missingConsent, setMissingConsent] = useState(false);

    useEffect(() => {
        if (accounts.length === 0 || selectedTenant.id === 'default') return;
        
        const fetchBurnData = async () => {
            setLoading(true);
            setMissingConsent(false);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                
                const subRes = await fetch(`/api/subscriptions?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const subJson = await subRes.json();
                
                if (subJson.error === "MISSING_ADMIN_CONSENT") {
                    setMissingConsent(true);
                    setLoading(false);
                    return;
                }

                if (!subJson.subscriptions || subJson.subscriptions.length === 0) {
                    setLoading(false);
                    return;
                }
                const subId = subJson.subscriptions[0].id;
                const subTenantId = subJson.subscriptions[0].tenantId || selectedTenant.id;
                
                const res = await fetch(`/api/budgets/burn?tenantId=${subTenantId}&subscriptionId=${subId}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (json.burnData) {
                    setBurnData(json.burnData);
                }
            } catch (e) {
                console.error("Error fetching budget burn data:", e);
            }
            setLoading(false);
        };
        fetchBurnData();
    }, [accounts, instance, selectedTenant.id]);

    if (accounts.length === 0 || selectedTenant.id === 'default') return null;

    return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 h-full">
            <h3 className="text-lg font-bold text-gray-800 mb-2">Presupuesto por Centro de Costos</h3>
            <p className="text-sm text-gray-500 mb-4">Muestra el límite asignado vs el gasto amortizado actual.</p>
            
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
                <div className="h-64 flex items-center justify-center">
                    <div className="text-sm text-gray-400 animate-pulse">Analizando Azure Cost Management...</div>
                </div>
            ) : burnData.length === 0 ? (
                <div className="text-sm text-gray-400 h-64 flex flex-col items-center justify-center text-center">
                    No hay presupuestos configurados para este Tenant.<br/>
                    Utiliza la API de Presupuestos para configurarlos.
                </div>
            ) : (
                <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={burnData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="costCenter" />
                            <YAxis tickFormatter={(val: any) => `$${val}`} />
                            <Tooltip formatter={(val: any) => `$${Number(val).toFixed(2)} USD`} />
                            
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
    );
}
