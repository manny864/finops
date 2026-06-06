"use client";
import React, { useEffect, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid
} from 'recharts';
import { PieChart, DollarSign, Activity } from "lucide-react";

import { useMsal } from '@azure/msal-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

export default function BillingPage() {
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const t = useTranslations();
  const [data, setData] = useState<{costByService: any[], dailyTrend: any[], totalCost: number} | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedTenant || selectedTenant.id === 'default' || accounts.length === 0) return;

    const fetchBilling = async () => {
      setLoading(true);
      setError("");
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
            setError("MISSING_ADMIN_CONSENT");
            setLoading(false);
            return;
        }

        if (!subJson.subscriptions || subJson.subscriptions.length === 0) {
            setError("No subscriptions found.");
            setLoading(false);
            return;
        }
        
        const subId = subJson.subscriptions[0].id;
        const subTenantId = subJson.subscriptions[0].tenantId || selectedTenant.id;

        const res = await fetch('/api/intelligence/billing', {
            headers: {
                'x-tenant-id': subTenantId,
                'x-subscription-id': subId
            }
        });
        const json = await res.json();
        if (json.success) {
            setData(json.data);
        } else {
            const errCode = json.error || "ERR_INTERNAL_SERVER";
            setError(errCode);
            toast.error(t(errCode));
        }
      } catch(e) {
          setError("ERR_INTERNAL_SERVER");
          toast.error(t("ERR_INTERNAL_SERVER"));
      }
      setLoading(false);
    };

    fetchBilling();
  }, [selectedTenant, accounts, instance]);

  if (selectedTenant.id === 'default') return null;

  return (
    <div className="max-w-7xl mx-auto animate-in fade-in duration-500">
      <div className="mb-6 flex justify-between items-end border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight flex items-center">
             <PieChart className="w-8 h-8 mr-3 text-[#0054A6]" />
             Consumo y Facturación
          </h1>
          <p className="text-gray-500 mt-2">Visibilidad de costos amortizados en el mes en curso.</p>
        </div>
      </div>

      {error === "MISSING_ADMIN_CONSENT" && (
        <div className="bg-amber-50 border border-amber-200 shadow-sm p-6 rounded-lg mb-6 flex items-start">
            <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            </div>
            <div className="ml-4 w-full">
                <h3 className="text-lg font-bold text-gray-900">Falta Admin Consent en el Tenant</h3>
                <div className="mt-2 text-sm text-gray-600">
                    <p>La aplicación de CSCloudSolutions no ha sido consentida en este Tenant. Crea el Service Principal en Azure Cloud Shell con el siguiente comando:</p>
                    <div className="mt-4 p-3 bg-white rounded border border-amber-200 font-mono text-sm text-gray-800 break-all select-all">
                        az ad sp create --id 876d8a5b-6023-4484-b3ba-73c186e4a72b
                    </div>
                </div>
            </div>
        </div>
      )}

      {error && error !== "MISSING_ADMIN_CONSENT" && (
        <div className="bg-white border-l-4 border-amber-500 shadow-sm p-6 rounded-lg mb-6 flex items-start">
            <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            </div>
            <div className="ml-4">
                <h3 className="text-lg font-bold text-gray-900">Permisos de Cost Management Restringidos</h3>
                <div className="mt-2 text-sm text-gray-600">
                    <p>Azure Cost Management ha bloqueado la lectura de costos para la suscripción solicitada. Esto sucede comúnmente por dos razones:</p>
                    <ul className="list-disc pl-5 mt-2 space-y-1 text-gray-700">
                        <li>El Service Principal (Enterprise App) no tiene el rol de <strong>Cost Management Reader</strong> asignado a nivel Suscripción.</li>
                        <li>La suscripción proporcionada no existe en este Tenant o ha sido cancelada.</li>
                    </ul>
                    <div className="mt-4 p-3 bg-gray-50 rounded border border-gray-200 font-mono text-xs text-red-600 break-all">
                        <strong>Log técnico:</strong> {error}
                    </div>
                </div>
            </div>
        </div>
      )}

      {loading && !data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-pulse">
            <div className="bg-gray-200 h-32 rounded-xl"></div>
            <div className="bg-gray-200 h-32 rounded-xl md:col-span-2"></div>
            <div className="bg-gray-200 h-80 rounded-xl md:col-span-3"></div>
        </div>
      )}

      {!loading && data && (
        <div className="space-y-6">
            
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Costo Amortizado (MTD)</p>
                        <h2 className="text-4xl font-black text-gray-900">${data.totalCost.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</h2>
                    </div>
                    <div className="p-3 bg-blue-50 text-[#0054A6] rounded-full">
                        <DollarSign className="w-8 h-8" />
                    </div>
                </div>

                <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm md:col-span-2">
                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center">
                        <Activity className="w-4 h-4 mr-2" />
                        Tendencia Diaria de Consumo
                    </h3>
                    <div className="h-24 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data.dailyTrend}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                <Tooltip 
                                    formatter={(v: any) => [`$${v} USD`, 'Costo']}
                                    labelStyle={{ color: '#374151', fontWeight: 'bold' }}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Line type="monotone" dataKey="cost" stroke="#0054A6" strokeWidth={3} dot={{r:3}} activeDot={{r: 6}} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Bar Chart by Service */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden p-6">
                <h3 className="text-lg font-bold text-gray-800 mb-6 border-b border-gray-100 pb-4">
                    Desglose de Costos por Servicio
                </h3>
                <div className="h-96 w-full">
                    {data.costByService.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.costByService} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
                                <XAxis type="number" tickFormatter={(v) => `$${v}`} />
                                <YAxis dataKey="name" type="category" width={150} tick={{fontSize: 12, fill: '#4B5563'}} />
                                <Tooltip 
                                    cursor={{fill: '#f9fafb'}}
                                    formatter={(v: any) => [`$${v} USD`, 'Costo']}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                                    {data.costByService.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={index === 0 ? '#EF4444' : index === 1 ? '#F59E0B' : '#0054A6'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400">
                            <p className="font-medium">No se detectaron costos en este periodo.</p>
                        </div>
                    )}
                </div>
            </div>

        </div>
      )}
    </div>
  );
}
