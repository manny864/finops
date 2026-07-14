"use client";
import React, { useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, KeyRound, Info, BellPlus } from 'lucide-react';
import Pagination, { usePagination } from '@/components/Pagination';
import PinButton from '@/components/dashboard/PinButton';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { toast } from 'sonner';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

function MockBanner({ tMock }: { tMock: (k: string) => string }) {
    return (
        <div className="bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-2 rounded-lg border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300 text-sm mb-4">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span><b>{tMock('badge')}:</b> {tMock('description')}</span>
        </div>
    );
}

function severityFromDays(d: number): 'critical' | 'high' | 'medium' | 'low' {
    if (d <= 7) return 'critical';
    if (d <= 30) return 'high';
    if (d <= 90) return 'medium';
    return 'low';
}

/**
 * Estado explícito de la credencial (más allá de los días restantes):
 * vencida (< 0 días), próxima a vencer (≤ 30 días) o habilitada/vigente.
 */
function statusFromDays(d: number): 'expired' | 'expiring' | 'active' {
    if (d < 0) return 'expired';
    if (d <= 30) return 'expiring';
    return 'active';
}

const SEV_STYLES: Record<string, string> = {
    critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const STATUS_STYLES: Record<string, string> = {
    expired: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-900/50',
    expiring: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-900/50',
    active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50',
};

export default function ExpiringCredentialsPanel() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const t = useTranslations('Credentials');
    const tMock = useTranslations('Mock');

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${idToken}` } });
        if (!res.ok) { const j = await res.json(); throw new Error(j.error || "Error"); }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant?.id && selectedTenant.id !== 'default' && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            // daysAhead amplio: trae también las vigentes para poder clasificar
            // vencida / próxima a vencer / habilitada (no solo las que expiran pronto).
            ? `/api/governance/expiring-credentials?tenantId=${selectedTenant.id}&daysAhead=3650`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const items: any[] = data?.items || [];
    const statusCounts = items.reduce(
        (acc: { expired: number; expiring: number; active: number }, it: any) => {
            acc[statusFromDays(Number(it.daysTillExpiry ?? 0))]++;
            return acc;
        },
        { expired: 0, expiring: 0, active: 0 }
    );

    // Hooks ANTES de cualquier return (Rules of Hooks).
    const { paged, ...paginationProps } = usePagination(items, 10);
    const [showAlertModal, setShowAlertModal] = useState(false);
    const [alertForm, setAlertForm] = useState({ days: "30", channel: "email", target: "", recurrence: "24" });
    const [savingAlert, setSavingAlert] = useState(false);

    const createExpiryAlert = async () => {
        const days = Number(alertForm.days);
        if (!Number.isInteger(days) || days < 1 || days > 365 || !alertForm.target.trim()) {
            toast.error(t('alertInvalidForm'));
            return;
        }
        if (isMockTenant(selectedTenant?.id || '')) {
            toast.success(t('alertCreated'));
            setShowAlertModal(false);
            return;
        }
        setSavingAlert(true);
        try {
            const account = accounts[0];
            const tokenResponse = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
            const res = await fetch(`/api/budgets/alerts?tenantId=${selectedTenant.id}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${tokenResponse.idToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    ruleName: t('alertDefaultName', { days }),
                    ruleType: 'credential_expiry',
                    thresholdValue: days,
                    thresholdUnit: 'days',
                    channel: alertForm.channel,
                    channelTarget: alertForm.target.trim(),
                    reminderFrequencyHours: alertForm.recurrence === "once" ? null : Number(alertForm.recurrence),
                }),
            });
            // Si el server devuelve algo que no es JSON (ej: "502 Bad Gateway"
            // de Traefik durante un restart/deploy), res.json() tira un
            // SyntaxError de parseo — antes eso se mostraba tal cual al
            // usuario ("Unexpected non-whitespace character..."), confuso y
            // sin pista de qué pasó realmente.
            let json: any;
            try {
                json = await res.json();
            } catch {
                throw new Error('El servidor no está disponible en este momento. Probá de nuevo en unos segundos.');
            }
            if (!res.ok || json.success === false) throw new Error(json.error);
            toast.success(t('alertCreated'));
            setShowAlertModal(false);
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : t('alertError'));
        } finally {
            setSavingAlert(false);
        }
    };

    if (!selectedTenant || selectedTenant.id === 'default') return null;
    if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-brand-deep mr-3" /><span className="text-gray-500">Cargando...</span></div>;
    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName="Credenciales por Vencer" />;
        }
        return <div className="bg-red-50 dark:bg-red-900/20 text-red-600 p-4 rounded-lg"><b>Error:</b> {error.message}</div>;
    }

    return (
        <div className="space-y-4">
            {data?.mock && <MockBanner tMock={tMock} />}

            <div className="flex items-center justify-end gap-2">
                <button
                    onClick={() => setShowAlertModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-deep text-white rounded-md text-xs font-bold hover:brightness-110"
                >
                    <BellPlus className="w-3.5 h-3.5" /> {t('createAlert')}
                </button>
                <PinButton widgetKey="governance.expiring-credentials" />
            </div>

            <div className="grid grid-cols-3 gap-3">
                <div className={`rounded-xl p-4 border ${STATUS_STYLES.expired}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{t('statusExpired')}</p>
                    <p className="text-2xl font-bold mt-1">{statusCounts.expired}</p>
                </div>
                <div className={`rounded-xl p-4 border ${STATUS_STYLES.expiring}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{t('statusExpiring')}</p>
                    <p className="text-2xl font-bold mt-1">{statusCounts.expiring}</p>
                </div>
                <div className={`rounded-xl p-4 border ${STATUS_STYLES.active}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{t('statusActive')}</p>
                    <p className="text-2xl font-bold mt-1">{statusCounts.active}</p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                        <tr>
                            <th className="px-4 py-3 font-semibold">{t('app')}</th>
                            <th className="px-4 py-3 font-semibold">{t('type')}</th>
                            <th className="px-4 py-3 font-semibold">{t('status')}</th>
                            <th className="px-4 py-3 font-semibold">{t('expiresAt')}</th>
                            <th className="px-4 py-3 font-semibold text-right">{t('daysLeft')}</th>
                            <th className="px-4 py-3 font-semibold">App ID</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                        {paged.map((it, i) => {
                            const days = Number(it.daysTillExpiry ?? 0);
                            const sev = it.severity || severityFromDays(days);
                            const status = statusFromDays(days);
                            return (
                                <tr key={`${it.appId}-${it.credentialId}-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/20">
                                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                                        <div className="flex items-center gap-2">
                                            <KeyRound className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                            <span className="truncate max-w-[220px]" title={it.displayName}>{it.displayName}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full text-xs font-semibold">
                                            {t(`types.${it.credentialType}`)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_STYLES[status]}`}>
                                            {status === 'expired' ? t('statusExpired') : status === 'expiring' ? t('statusExpiring') : t('statusActive')}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 font-mono">{(it.expiresAt || '').slice(0, 10)}</td>
                                    <td className="px-4 py-3 text-right">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${SEV_STYLES[sev]}`}>
                                            {days} días
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-400 font-mono">{it.appId?.slice(0, 18)}…</td>
                                </tr>
                            );
                        })}
                        {items.length === 0 && (
                            <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">{t('noExpiring')}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <Pagination {...paginationProps} />

            {showAlertModal && (
                <div className="fixed inset-0 bg-black/40 z-50 grid place-items-center p-4" onClick={() => !savingAlert && setShowAlertModal(false)}>
                    <div className="bg-white dark:bg-slate-900 rounded-xl w-full max-w-md p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <h4 className="font-bold text-[15px] text-gray-900 dark:text-white mb-1">{t('createAlert')}</h4>
                        <p className="text-xs text-gray-500 mb-4">{t('alertSubtitle')}</p>
                        <div className="flex flex-col gap-3">
                            <div>
                                <label className="text-xs font-semibold text-gray-500">{t('alertDays')}</label>
                                <input
                                    type="number" min={1} max={365}
                                    value={alertForm.days}
                                    onChange={(e) => setAlertForm({ ...alertForm, days: e.target.value })}
                                    className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-transparent"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-gray-500">Recurrencia del recordatorio</label>
                                <select
                                    value={alertForm.recurrence}
                                    onChange={(e) => setAlertForm({ ...alertForm, recurrence: e.target.value })}
                                    className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-white dark:bg-slate-800"
                                >
                                    <option value="24">Diaria (mientras siga venciendo)</option>
                                    <option value="168">Semanal</option>
                                    <option value="once">Solo una vez</option>
                                </select>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-semibold text-gray-500">{t('alertChannel')}</label>
                                    <select
                                        value={alertForm.channel}
                                        onChange={(e) => setAlertForm({ ...alertForm, channel: e.target.value })}
                                        className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-white dark:bg-slate-800"
                                    >
                                        <option value="email">Email</option>
                                        <option value="slack">Slack (webhook)</option>
                                        <option value="teams">Teams (webhook)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-500">{alertForm.channel === 'email' ? 'Email' : 'Webhook URL'}</label>
                                    <input
                                        type={alertForm.channel === 'email' ? 'email' : 'url'}
                                        value={alertForm.target}
                                        onChange={(e) => setAlertForm({ ...alertForm, target: e.target.value })}
                                        placeholder={alertForm.channel === 'email' ? 'ops@empresa.com' : 'https://hooks...'}
                                        className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-transparent"
                                    />
                                </div>
                            </div>
                            <p className="text-[11px] text-gray-400">{t('alertNote')}</p>
                            <div className="flex justify-end gap-2 mt-1">
                                <button onClick={() => setShowAlertModal(false)} disabled={savingAlert} className="px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">{t('alertCancel')}</button>
                                <button onClick={createExpiryAlert} disabled={savingAlert} className="px-4 py-2 bg-brand-deep text-white rounded-md text-sm font-bold flex items-center gap-2 disabled:opacity-50 hover:brightness-110">
                                    {savingAlert && <Loader2 className="w-4 h-4 animate-spin" />} {t('alertCreate')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
