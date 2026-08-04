"use client";
import { useEffect, useState } from "react";
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { toast } from 'sonner';
import { Building2, Plus, ShieldAlert, Link2, Copy, Check } from "lucide-react";
import { getFreshIdToken } from '@/lib/msalToken';

export default function SuperAdminTenantsPage() {
    const t = useTranslations('AdminTenants');
    const { systemRole } = useTenant();
    const { instance, accounts } = useMsal();
    const [tenants, setTenants] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    
    // New Tenant Form
    const [newTenantId, setNewTenantId] = useState('');
    const [newTenantName, setNewTenantName] = useState('');
    const [newTier, setNewTier] = useState('Essential');
    const [creating, setCreating] = useState(false);

    // Cobro Enterprise vía Paddle: Price custom creado a mano en el dashboard
    // de Paddle para el deal negociado (ver instrucciones más abajo, en el
    // bloque "Cobrar vía Paddle" de la tabla). En vez de abrir el checkout
    // acá mismo, generamos un link hosteado por Paddle (Transactions API)
    // para mandárselo al cliente y que lo complete cuando quiera, eligiendo
    // su propio medio de pago. `custom_data: {tenant_id, tier}` viaja en la
    // transacción para que el webhook (/api/webhooks/paddle) sepa a qué
    // tenant/tier aplicar la suscripción al completarse el pago, sin
    // depender del mapeo fijo de priceId (los precios custom son
    // distintos por cliente).
    const [chargePriceId, setChargePriceId] = useState<Record<string, string>>({});
    const [generatingLink, setGeneratingLink] = useState<Record<string, boolean>>({});
    const [checkoutLinks, setCheckoutLinks] = useState<Record<string, string>>({});
    const [copiedTenantId, setCopiedTenantId] = useState<string | null>(null);
    const [salesReferrerDraft, setSalesReferrerDraft] = useState<Record<string, string>>({});
    const [salesCommissionDraft, setSalesCommissionDraft] = useState<Record<string, string>>({});
    const [savingCommercialTenantId, setSavingCommercialTenantId] = useState<string | null>(null);

    const isSuperAdmin = systemRole === 'SUPERADMIN';

    const handleGenerateCheckoutLink = async (tenantId: string, tier: string) => {
        const priceId = (chargePriceId[tenantId] || '').trim();
        if (!priceId) {
            toast.error(t('toastPriceIdRequired'));
            return;
        }
        setGeneratingLink(prev => ({ ...prev, [tenantId]: true }));
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            const res = await fetch('/api/admin/tenants/paddle-checkout-link', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ tenantId, tier, priceId }),
            });
            const json = await res.json();
            if (res.ok && json.checkoutUrl) {
                setCheckoutLinks(prev => ({ ...prev, [tenantId]: json.checkoutUrl }));
                toast.success(t('toastLinkGenerated'));
            } else {
                toast.error(json.error || t('toastGenerateLinkError'));
            }
        } catch (e) {
            console.error("Error generating Paddle checkout link:", e);
            toast.error(t('toastConnectionError'));
        }
        setGeneratingLink(prev => ({ ...prev, [tenantId]: false }));
    };

    const handleCopyLink = async (tenantId: string) => {
        const url = checkoutLinks[tenantId];
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            setCopiedTenantId(tenantId);
            setTimeout(() => setCopiedTenantId(null), 2000);
        } catch {
            toast.error(t('toastCopyLinkError'));
        }
    };

    const loadTenants = async () => {
        if (!isSuperAdmin || accounts.length === 0) return;
        setLoading(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            
            const res = await fetch(`/api/tenants`, {
                headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
            });
            const json = await res.json();
            if (res.ok && json.tenants) {
                setTenants(json.tenants);
            }
        } catch (e) {
            console.error("Error loading tenants:", e);
        }
        setLoading(false);
    };

    useEffect(() => {
        loadTenants();
    }, [systemRole, accounts, instance]);

    const handleCreateManualTenant = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTenantId || !newTenantName) {
            toast.error(t('toastTenantIdNameRequired'));
            return;
        }

        setCreating(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            
            const res = await fetch('/api/admin/tenants', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId: newTenantId,
                    name: newTenantName,
                    tier: newTier
                })
            });
            const json = await res.json();

            if (res.ok) {
                toast.success(t('toastTenantCreated'));
                setNewTenantId('');
                setNewTenantName('');
                setNewTier('Essential');
                loadTenants();
            } else {
                toast.error(json.error || t('toastCreateTenantError'));
            }
        } catch (e) {
            console.error("Error creating tenant:", e);
            toast.error(t('toastConnectionError'));
        }
        setCreating(false);
    };

    const handleTierChange = async (tenantId: string, newTierValue: string) => {
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };

            const res = await fetch('/api/admin/tenants', {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId,
                    tier: newTierValue
                })
            });
            const json = await res.json();

            if (res.ok) {
                toast.success(t('toastTierUpdated'));
                loadTenants();
            } else {
                toast.error(json.error || t('toastUpdateTierError'));
            }
        } catch (e) {
            console.error("Error updating tier:", e);
            toast.error(t('toastConnectionError'));
        }
    };

    const handleSubscriptionStatusChange = async (tenantId: string, newStatus: string) => {
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };

            const res = await fetch('/api/admin/tenants', {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId,
                    subscriptionStatus: newStatus
                })
            });
            const json = await res.json();

            if (res.ok) {
                toast.success(t('toastSubscriptionUpdated'));
                loadTenants();
            } else {
                toast.error(json.error || t('toastUpdateSubscriptionError'));
            }
        } catch (e) {
            console.error("Error updating subscription status:", e);
            toast.error(t('toastConnectionError'));
        }
    };

    const handleSaveCommercialData = async (tenantId: string) => {
        const tenant = tenants.find((t) => t.id === tenantId);
        if (!tenant) return;

        const salesReferrer = (salesReferrerDraft[tenantId] ?? tenant.sales_referrer ?? '').trim();
        const rawCommission = (salesCommissionDraft[tenantId] ?? (tenant.sales_commission_pct == null ? '' : String(tenant.sales_commission_pct))).trim();

        if (rawCommission.length > 0) {
            const asNumber = Number(rawCommission);
            if (!Number.isFinite(asNumber) || asNumber < 0 || asNumber > 100 || !/^\d+(\.\d{1,2})?$/.test(rawCommission)) {
                toast.error(t('toastCommissionInvalid'));
                return;
            }
        }

        setSavingCommercialTenantId(tenantId);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            const res = await fetch('/api/admin/tenants', {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId,
                    salesReferrer,
                    salesCommissionPct: rawCommission.length > 0 ? rawCommission : null,
                })
            });
            const json = await res.json();

            if (res.ok) {
                toast.success(t('toastCommercialUpdated'));
                await loadTenants();
            } else {
                toast.error(json.error || t('toastUpdateCommercialError'));
            }
        } catch (e) {
            console.error("Error updating commercial tenant data:", e);
            toast.error(t('toastConnectionError'));
        }
        setSavingCommercialTenantId(null);
    };

    if (!isSuperAdmin) {
        return (
            <div className="p-6 max-w-5xl mx-auto flex flex-col items-center justify-center min-h-[50vh]">
                <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{t('accessDeniedTitle')}</h2>
                <p className="text-gray-500 mt-2">{t('accessDeniedDesc')}</p>
            </div>
        );
    }

    return (
        <div className="w-full p-6 max-w-[1700px] mx-auto animate-in fade-in duration-500">
            <div className="mb-8 border-b border-gray-200 dark:border-gray-800 pb-4">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                    <Building2 className="w-8 h-8 mr-3 text-[#0054A6] dark:text-[#00AEEF]" />
                    {t('pageTitle')}
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">
                    {t('pageSubtitle')}
                </p>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900/30 rounded-xl p-5 mb-8 text-sm text-blue-900 dark:text-blue-200">
                <div className="flex items-center gap-2 font-bold mb-2">
                    <Link2 className="w-4 h-4" />
                    {t('paddleHowToTitle')}
                </div>
                <ol className="list-decimal list-inside space-y-1 leading-relaxed">
                    <li>{t.rich('paddleStep1', {
                        b: (chunks) => <strong>{chunks}</strong>,
                        code: (chunks) => <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">{chunks}</code>
                    })}</li>
                    <li>{t.rich('paddleStep2', {
                        b: (chunks) => <strong>{chunks}</strong>
                    })}</li>
                    <li>{t('paddleStep3')}</li>
                    <li>{t.rich('paddleStep4', {
                        b: (chunks) => <strong>{chunks}</strong>,
                        code: (chunks) => <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">{chunks}</code>
                    })}</li>
                </ol>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden mb-8">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 flex items-center gap-2">
                    <Plus className="w-5 h-5 text-gray-500" />
                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('manualRegisterTitle')}</h3>
                </div>
                <div className="p-6">
                    <form onSubmit={handleCreateManualTenant} className="flex flex-col md:flex-row gap-4 items-end">
                        <div className="flex-1 w-full">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('entraIdLabel')}</label>
                            <input
                                type="text"
                                required
                                value={newTenantId}
                                onChange={e => setNewTenantId(e.target.value)}
                                placeholder="00000000-0000-0000-0000-000000000000"
                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md focus:ring-[#0054A6] bg-white dark:bg-slate-800"
                            />
                        </div>
                        <div className="flex-1 w-full">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('companyNameLabel')}</label>
                            <input
                                type="text"
                                required
                                value={newTenantName}
                                onChange={e => setNewTenantName(e.target.value)}
                                placeholder={t('companyNamePlaceholder')}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md focus:ring-[#0054A6] bg-white dark:bg-slate-800"
                            />
                        </div>
                        <div className="w-full md:w-48">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('initialTierLabel')}</label>
                            <select
                                value={newTier}
                                onChange={e => setNewTier(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800"
                            >
                                <option value="Essential">Essential</option>
                                <option value="Professional">Professional</option>
                                <option value="Business">Business</option>
                                <option value="Enterprise">Enterprise</option>
                            </select>
                        </div>
                        <button
                            type="submit"
                            disabled={creating}
                            className="w-full md:w-auto px-6 py-2 bg-[#0054A6] text-white rounded-md font-semibold hover:bg-[#004080] disabled:opacity-50"
                        >
                            {creating ? t('creatingButton') : t('createTenantButton')}
                        </button>
                    </form>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-gray-500" />
                        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('allTenantsTitle', { count: tenants.length })}</h3>
                    </div>
                </div>
                <div className="p-6">
                    {loading ? (
                        <div className="text-sm text-gray-400">{t('loadingTenants')}</div>
                    ) : tenants.length === 0 ? (
                        <div className="text-sm text-gray-500">{t('noTenants')}</div>
                    ) : (
                        <div className="overflow-x-auto custom-scrollbar pb-2">
                            <table className="min-w-[1500px] table-auto divide-y divide-gray-200 dark:divide-slate-700">
                                <thead className="bg-gray-50 dark:bg-slate-900">
                                    <tr>
                                        <th scope="col" className="w-40 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('colCompany')}</th>
                                        <th scope="col" className="w-44 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('colTenantId')}</th>
                                        <th scope="col" className="w-32 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('colSubscription')}</th>
                                        <th scope="col" className="w-32 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('colCurrentTier')}</th>
                                        <th scope="col" className="w-52 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('colSeller')}</th>
                                        <th scope="col" className="w-44 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('colCommissionPct')}</th>
                                        <th scope="col" className="w-72 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('colChargePaddle')}</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                                    {tenants.map((tenant) => (
                                        <tr key={tenant.id}>
                                            <td className="px-6 py-4 break-words text-sm font-medium text-gray-900 dark:text-gray-100">{tenant.name || '-'}</td>
                                            <td className="px-6 py-4 break-all text-sm text-gray-500 dark:text-gray-400 font-mono text-xs">{tenant.id}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                                <select
                                                    value={tenant.subscription_status || 'ACTIVE'}
                                                    onChange={(e) => handleSubscriptionStatusChange(tenant.id, e.target.value)}
                                                    className="px-2 py-1 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-sm font-medium"
                                                >
                                                    <option value="TRIAL">TRIAL</option>
                                                    <option value="ACTIVE">ACTIVE</option>
                                                    <option value="PAST_DUE">PAST_DUE</option>
                                                    <option value="CANCELED">CANCELED</option>
                                                    <option value="EXPIRED">EXPIRED</option>
                                                </select>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                                <select
                                                    value={tenant.tier || 'Essential'}
                                                    onChange={(e) => handleTierChange(tenant.id, e.target.value)}
                                                    className="px-2 py-1 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-sm font-medium"
                                                >
                                                    <option value="Essential">Essential</option>
                                                    <option value="Professional">Professional</option>
                                                    <option value="Business">Business</option>
                                                    <option value="Enterprise">Enterprise</option>
                                                </select>
                                            </td>
                                            <td className="px-6 py-4 text-sm">
                                                <input
                                                    type="text"
                                                    value={salesReferrerDraft[tenant.id] ?? tenant.sales_referrer ?? ''}
                                                    onChange={(e) => setSalesReferrerDraft(prev => ({ ...prev, [tenant.id]: e.target.value }))}
                                                    placeholder={t('sellerPlaceholder')}
                                                    maxLength={255}
                                                    className="w-full px-2 py-1 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-xs"
                                                />
                                            </td>
                                            <td className="px-6 py-4 text-sm">
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="100"
                                                        step="0.01"
                                                        value={salesCommissionDraft[tenant.id] ?? (tenant.sales_commission_pct == null ? '' : String(tenant.sales_commission_pct))}
                                                        onChange={(e) => setSalesCommissionDraft(prev => ({ ...prev, [tenant.id]: e.target.value }))}
                                                        placeholder="0.00"
                                                        className="w-24 px-2 py-1 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-xs"
                                                    />
                                                    <span className="text-xs text-gray-500">%</span>
                                                    <button
                                                        onClick={() => handleSaveCommercialData(tenant.id)}
                                                        disabled={savingCommercialTenantId === tenant.id}
                                                        className="px-2 py-1 rounded border border-gray-300 dark:border-slate-700 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
                                                    >
                                                        {savingCommercialTenantId === tenant.id ? t('savingCommercialButton') : t('saveCommercialButton')}
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-sm">
                                                <div className="flex flex-col sm:flex-row sm:items-center gap-1.5">
                                                    <input
                                                        type="text"
                                                        placeholder="pri_..."
                                                        value={chargePriceId[tenant.id] || ''}
                                                        onChange={(e) => setChargePriceId(prev => ({ ...prev, [tenant.id]: e.target.value }))}
                                                        className="w-full sm:flex-1 min-w-0 px-2 py-1 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-xs font-mono"
                                                    />
                                                    <button
                                                        onClick={() => handleGenerateCheckoutLink(tenant.id, tenant.tier || 'Enterprise')}
                                                        disabled={generatingLink[tenant.id]}
                                                        title={t('generateLinkTitle')}
                                                        className="flex items-center justify-center gap-1 px-2 py-1 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 shrink-0 whitespace-nowrap"
                                                    >
                                                        <Link2 className="w-3.5 h-3.5 shrink-0" />
                                                        {generatingLink[tenant.id] ? t('generatingButton') : t('generateLinkButton')}
                                                    </button>
                                                </div>
                                                {checkoutLinks[tenant.id] && (
                                                    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 mt-1.5">
                                                        <input
                                                            type="text"
                                                            readOnly
                                                            value={checkoutLinks[tenant.id]}
                                                            onFocus={(e) => e.target.select()}
                                                            className="w-full sm:flex-1 min-w-0 px-2 py-1 border border-gray-300 dark:border-slate-700 rounded bg-gray-50 dark:bg-slate-900 text-xs font-mono text-gray-600 dark:text-gray-300"
                                                        />
                                                        <button
                                                            onClick={() => handleCopyLink(tenant.id)}
                                                            title={t('copyLinkTitle')}
                                                            className="flex items-center justify-center gap-1 px-2 py-1 border border-gray-300 dark:border-slate-700 rounded text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 shrink-0"
                                                        >
                                                            {copiedTenantId === tenant.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
