"use client";
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useSubscription } from '@/components/SubscriptionProvider';
import { useMsal } from '@azure/msal-react';
import { CreditCard, AlertTriangle, Loader2, Download, Tag, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { calculateChargeback, CostEntry, AllocationRule } from '@/services/allocationService';

const COLORS = ['#0054A6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b'];

export default function ChargebackPage() {
    const { selectedTenant } = useTenant();
    const { selectedSubscription, loading: loadingSubs } = useSubscription();
    const { instance, accounts } = useMsal();
    const t = useTranslations('Chargeback');
    const tc = useTranslations('Common');
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<{name: string, value: number}[]>([]);
    const [rawCosts, setRawCosts] = useState<CostEntry[]>([]);
    const [hasAnalyzed, setHasAnalyzed] = useState(false);

    const [tagKey, setTagKey] = useState('CostCenter');
    const [customTagKey, setCustomTagKey] = useState('');
    const isCustomTag = tagKey === 'custom';

    // Allocation State
    const [rules, setRules] = useState<AllocationRule[]>([]);
    const [newRule, setNewRule] = useState({ sourceResourceId: '', targetCostCenter: '', percentage: 0 });
    const [reallocatedData, setReallocatedData] = useState<any[]>([]);

    const handleAnalyze = async () => {
        if (!selectedTenant || selectedTenant.id === 'default') return toast.error(t('select_tenant'));
        if (!selectedSubscription) return toast.error(t('select_sub'));
        const activeTagKey = isCustomTag ? customTagKey : tagKey;
        if (!activeTagKey.trim()) return toast.error(t('enter_tag'));

        setLoading(true);
        try {
            const url = `/api/intelligence/chargeback?tenantId=${selectedTenant.id}&subscriptionId=${selectedSubscription}&tagKey=${encodeURIComponent(activeTagKey)}`;
            const res = await fetch(url);
            const json = await res.json();
            if (json.data) {
                setData(json.data.sort((a: any, b: any) => b.value - a.value));
                // Mocking raw costs for the engine demonstration
                const mockRawCosts = json.data.map((d: any) => ({
                    resourceId: `res-${d.name}`,
                    resourceName: `Shared ${d.name} Cluster`,
                    costCenter: d.name,
                    amount: d.value
                }));
                setRawCosts(mockRawCosts);
                setHasAnalyzed(true);
                toast.success(t('showback_success'));
            }
        } catch (error: any) {
            toast.error(error.message || t('error_fetching'));
        } finally {
            setLoading(false);
        }
    };

    const handleAddRule = () => {
        if (newRule.sourceResourceId && newRule.targetCostCenter && newRule.percentage > 0) {
            setRules([...rules, { ...newRule, tenantId: selectedTenant?.id || 'default' }]);
            setNewRule({ sourceResourceId: '', targetCostCenter: '', percentage: 0 });
        }
    };

    useEffect(() => {
        if (rawCosts.length > 0) {
            const final = calculateChargeback(rawCosts, rules);
            const chartData = Object.keys(final).map(cc => ({
                name: cc,
                Original: rawCosts.find(r => r.costCenter === cc)?.amount || 0,
                Reallocated: final[cc] - (rawCosts.find(r => r.costCenter === cc)?.amount || 0),
                Total: final[cc]
            }));
            setReallocatedData(chartData);
        }
    }, [rawCosts, rules]);

    const handleExportCSV = () => { /* ... */ };
    const totalCost = data.reduce((acc, curr) => acc + curr.value, 0);

    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt"><span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">💳</span>{t('title')}</div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
                <div className="right">
                    <span className="scopechip">📍 {selectedTenant?.name || "Tenant"}</span>
                </div>
            </div>

            <div className="card mb-6">
                <div className="p-[18px]">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                        <div className="flex flex-col gap-2 md:col-span-1">
                            <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px]">{t('tag_key_label')}</label>
                            <select value={tagKey} onChange={(e) => setTagKey(e.target.value)} className="w-full bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2.5 outline-none">
                                <option value="CostCenter">CostCenter</option>
                                <option value="Environment">Environment</option>
                                <option value="custom">{t('custom_option')}</option>
                            </select>
                        </div>
                        {isCustomTag && (
                            <div className="flex flex-col gap-2 md:col-span-1">
                                <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px]">{t('custom_tag_label')}</label>
                                <input type="text" value={customTagKey} onChange={(e) => setCustomTagKey(e.target.value)} className="w-full bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2.5 outline-none" />
                            </div>
                        )}
                        <div className={`md:col-span-1 ${isCustomTag ? '' : 'md:col-start-3'}`}>
                            <button onClick={handleAnalyze} disabled={loading || !selectedSubscription} className="w-full bg-brand-deep text-white px-4 py-2.5 rounded-[10px] hover:brightness-110 transition flex items-center justify-center font-heading font-bold text-[13px] h-[42px] cursor-pointer">
                                {loading && <Loader2 className="w-5 h-5 animate-spin mr-2" />}
                                {t('run_showback')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {hasAnalyzed && (
                <div className="card mb-6 p-6">
                    <h3 className="text-[14px] font-bold text-ink mb-4">Allocation Rules (Asset vs Allocation)</h3>
                    <div className="flex gap-4 mb-4">
                        <select className="border border-line rounded p-2" value={newRule.sourceResourceId} onChange={e => setNewRule({...newRule, sourceResourceId: e.target.value})}>
                            <option value="">Select Shared Resource...</option>
                            {rawCosts.map(c => <option key={c.resourceId} value={c.resourceId}>{c.resourceName}</option>)}
                        </select>
                        <input type="text" placeholder="Target Cost Center" className="border border-line rounded p-2" value={newRule.targetCostCenter} onChange={e => setNewRule({...newRule, targetCostCenter: e.target.value})} />
                        <input type="number" placeholder="Percentage (%)" className="border border-line rounded p-2 w-32" value={newRule.percentage} onChange={e => setNewRule({...newRule, percentage: parseFloat(e.target.value)})} />
                        <button onClick={handleAddRule} className="bg-brand text-white p-2 rounded"><Plus className="w-5 h-5" /></button>
                    </div>
                    {rules.length > 0 && (
                        <div className="flex flex-col gap-2">
                            {rules.map((r, i) => (
                                <div key={i} className="flex justify-between p-2 bg-surface-2 rounded text-[13px] font-medium text-ink">
                                    <span>Split {r.percentage}% of {rawCosts.find(c => c.resourceId === r.sourceResourceId)?.resourceName} to {r.targetCostCenter}</span>
                                    <button onClick={() => setRules(rules.filter((_, idx) => idx !== i))}><Trash2 className="w-4 h-4 text-red-500" /></button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {reallocatedData.length > 0 && (
                <div className="grid-2">
                    <div className="card flex flex-col items-center p-6 col-span-2">
                        <h3 className="text-[14px] font-bold text-ink mb-6 w-full text-left">Redistributed Costs (Stacked Bar)</h3>
                        <div className="h-96 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={reallocatedData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="name" />
                                    <YAxis />
                                    <Tooltip formatter={(value: any) => [`$${Number(value).toFixed(2)}`, '']} />
                                    <Legend />
                                    <Bar dataKey="Original" stackId="a" fill="#0054A6" />
                                    <Bar dataKey="Reallocated" stackId="a" fill="#10b981" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
