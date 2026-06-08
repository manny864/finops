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
  const tb = useTranslations('Billing');
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
    <div className="content animate-in fade-in duration-500">
      <div className="vhead">
        <div>
          <div className="vt">
             <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">💰</span>
             {tb('title')}
          </div>
          <div className="vs">{tb('subtitle')}</div>
        </div>
      </div>

      {error === "MISSING_ADMIN_CONSENT" && (
        <div className="card">
            <div className="card-h">
                <h3 className="text-amber">⚠️ {tb('missing_consent')}</h3>
            </div>
            <div className="p-[18px]">
                <div className="text-sm text-ink-soft">
                    <p>{tb('missing_consent_desc')}</p>
                    <div className="mt-4 p-3 bg-surface-2 rounded border border-line font-mono text-sm text-ink break-all select-all">
                        az ad sp create --id 876d8a5b-6023-4484-b3ba-73c186e4a72b
                    </div>
                </div>
            </div>
        </div>
      )}

      {error && error !== "MISSING_ADMIN_CONSENT" && (
        <div className="card">
            <div className="card-h">
                <h3 className="text-danger">⚠️ {tb('permissions_title')}</h3>
            </div>
            <div className="p-[18px]">
                <div className="text-sm text-ink-soft">
                    <p>{tb('permissions_desc')}</p>
                    <ul className="list-disc pl-5 mt-2 space-y-1 text-ink">
                        <li>{tb('permissions_reason1')}</li>
                        <li>{tb('permissions_reason2')}</li>
                    </ul>
                    <div className="mt-4 p-3 bg-danger-soft rounded border border-line font-mono text-xs text-danger break-all">
                        <strong>{t('Common.log_label')}</strong> {error}
                    </div>
                </div>
            </div>
        </div>
      )}

      {loading && !data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-pulse">
            <div className="bg-surface-2 h-32 rounded-xl"></div>
            <div className="bg-surface-2 h-32 rounded-xl md:col-span-2"></div>
            <div className="bg-surface-2 h-80 rounded-xl md:col-span-3"></div>
        </div>
      )}

      {!loading && data && (
        <div className="space-y-6">
            
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="kpi">
                    <div className="lab">{tb('amortized_cost')}</div>
                    <div className="val">${data.totalCost.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
                </div>

                <div className="card md:col-span-2">
                    <div className="card-h">
                        <h3><Activity className="w-4 h-4 mr-2 inline" />{tb('daily_trend')}</h3>
                    </div>
                    <div className="chart-wrap h-24">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data.dailyTrend}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                                <Tooltip 
                                    formatter={(v: any) => [`$${v} USD`, tb('cost_label')]}
                                    labelStyle={{ color: 'var(--ink)', fontWeight: 'bold' }}
                                    contentStyle={{ borderRadius: '8px', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', background: 'var(--surface)' }}
                                />
                                <Line type="monotone" dataKey="cost" stroke="#0054A6" strokeWidth={3} dot={{r:3}} activeDot={{r: 6}} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Bar Chart by Service */}
            <div className="card">
                <div className="card-h">
                    <h3>{tb('cost_breakdown')}</h3>
                </div>
                <div className="chart-wrap h-96">
                    {data.costByService.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.costByService} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="var(--line)" />
                                <XAxis type="number" tickFormatter={(v) => `$${v}`} />
                                <YAxis dataKey="name" type="category" width={150} tick={{fontSize: 12, fill: 'var(--ink-soft)'}} />
                                <Tooltip 
                                    cursor={{fill: 'var(--surface-2)'}}
                                    formatter={(v: any) => [`$${v} USD`, tb('cost_label')]}
                                    contentStyle={{ borderRadius: '8px', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', background: 'var(--surface)' }}
                                />
                                <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                                    {data.costByService.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={index === 0 ? '#EF4444' : index === 1 ? '#F59E0B' : '#0054A6'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="empty">
                            <p>{tb('no_costs')}</p>
                        </div>
                    )}
                </div>
            </div>

        </div>
      )}
    </div>
  );
}
