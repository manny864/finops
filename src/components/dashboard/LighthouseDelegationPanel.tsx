"use client";
import React from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, Layers, Info } from 'lucide-react';

function MockBanner({ tMock }: { tMock: (k: string) => string }) {
    return (
        <div className="bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-2 rounded-lg border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300 text-sm mb-4">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span><b>{tMock('badge')}:</b> {tMock('description')}</span>
        </div>
    );
}

const STATUS_STYLES: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    revoked: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export default function LighthouseDelegationPanel() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const t = useTranslations('Lighthouse');
    const tMock = useTranslations('Mock');

    const fetcher = async (url: string) => {
        const account = accounts[0];
        if (!account) throw new Error("No hay cuenta autenticada");
        const tokenResponse = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` } });
        if (!res.ok) { const j = await res.json(); throw new Error(j.error || "Error"); }
        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR(
        selectedTenant?.id && selectedTenant.id !== 'default' && accounts.length > 0
            ? `/api/onboard/lighthouse?tenantId=${selectedTenant.id}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const [form, setForm] = React.useState({ managedTenantId: '', managedSubscriptionId: '', roles: ['Reader', 'Cost Management Reader'] as string[] });
    const [submitting, setSubmitting] = React.useState(false);

    async function submitDelegation() {
        if (!selectedTenant?.id) return;
        setSubmitting(true);
        try {
            const account = accounts[0];
            const tokenResponse = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
            const res = await fetch(`/api/onboard/lighthouse?tenantId=${selectedTenant.id}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${tokenResponse.idToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            const j = await res.json();
            if (j.armTemplate) {
                const blob = new Blob([JSON.stringify(j.armTemplate, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'lighthouse-template.json'; a.click(); URL.revokeObjectURL(url);
            }
            mutate();
        } finally { setSubmitting(false); }
    }

    if (!selectedTenant || selectedTenant.id === 'default') return null;
    if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-brand-deep mr-3" /></div>;
    if (error) return <div className="bg-red-50 dark:bg-red-900/20 text-red-600 p-4 rounded-lg"><b>Error:</b> {error.message}</div>;

    const items: any[] = data?.delegations || [];

    return (
        <div className="space-y-6">
            {data?.mock && <MockBanner tMock={tMock} />}

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                        <tr>
                            <th className="px-4 py-3 font-semibold">{t('managedTenant')}</th>
                            <th className="px-4 py-3 font-semibold">Subscription</th>
                            <th className="px-4 py-3 font-semibold">{t('roles')}</th>
                            <th className="px-4 py-3 font-semibold">{t('status')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                        {items.map((it, i) => (
                            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/20">
                                <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">
                                    <div className="flex items-center gap-2"><Layers className="w-3.5 h-3.5 text-blue-500" />{it.managedTenantId}</div>
                                </td>
                                <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">{it.managedSubscriptionId || '-'}</td>
                                <td className="px-4 py-3 text-xs">
                                    {(it.roles || []).map((r: string) => (
                                        <span key={r} className="inline-block mr-1 mb-1 px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-xs">{r}</span>
                                    ))}
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLES[it.status] || STATUS_STYLES.pending}`}>
                                        {t(`statuses.${it.status}`)}
                                    </span>
                                </td>
                            </tr>
                        ))}
                        {items.length === 0 && (
                            <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">{t('noDelegations')}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-5">
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-4">{t('deployTemplate')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40" placeholder="Managed Tenant ID (GUID)" value={form.managedTenantId} onChange={e => setForm({ ...form, managedTenantId: e.target.value })} />
                    <input className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40" placeholder="Managed Subscription ID (GUID)" value={form.managedSubscriptionId} onChange={e => setForm({ ...form, managedSubscriptionId: e.target.value })} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                    {['Reader', 'Cost Management Reader', 'Tag Contributor', 'Contributor'].map(r => (
                        <label key={r} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={form.roles.includes(r)} onChange={e => {
                                const next = e.target.checked ? [...form.roles, r] : form.roles.filter(x => x !== r);
                                setForm({ ...form, roles: next });
                            }} />
                            {r}
                        </label>
                    ))}
                </div>
                <button onClick={submitDelegation} disabled={submitting || !form.managedTenantId} className="mt-4 px-4 py-2 bg-brand-deep text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-blue-700">
                    {submitting ? <Loader2 className="w-4 h-4 inline animate-spin mr-1" /> : null}
                    {t('deployTemplate')}
                </button>
            </div>
        </div>
    );
}
