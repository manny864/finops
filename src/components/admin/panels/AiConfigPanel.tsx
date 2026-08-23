"use client";
/**
 * Configuración Global — pestaña IA.
 *
 * Refactor visual sobre lógica existente. Lo que NO cambió y no debe cambiar:
 *   - `apiKeyDirty`: la clave sólo se manda al PATCH si el usuario la escribió.
 *     El GET nunca devuelve la clave, así que mandarla siempre pisaría la
 *     guardada con un string vacío al tocar cualquier otro toggle.
 *   - `deleteApiKey` manda un body completo y distinto (vuelve a `system` y
 *     limpia endpoint/deployment), no un PATCH parcial.
 *   - `canConfigureAi` y las condiciones exactas de `disabled` de cada botón.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import {
    IconAdjustments,
    IconAlertTriangle,
    IconBrandAzure,
    IconBrain,
    IconCircleCheck,
    IconCircleX,
    IconCpu,
    IconDeviceFloppy,
    IconKey,
    IconLoader2,
    IconLock,
    IconShieldCheck,
    IconShieldLock,
    IconSparkles,
    IconTrash,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import { getFreshIdToken } from '@/lib/msalToken';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/apiErrors';
import InfoTooltip from '@/components/InfoTooltip';
import { isMockTenant } from '@/lib/mockData';

/** Contrato de la columna `Tenants.ai_anomaly_sensitivity` — ENUM de 3 valores. */
type Sensitivity = 'low' | 'medium' | 'high';

const BTN_PRIMARY =
    "inline-flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-lg text-sm font-semibold " +
    "bg-[#0078D4] text-white border border-[#0078D4] hover:bg-[#0060AA] hover:border-[#0060AA] " +
    "disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

const BTN_TEST =
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium " +
    "bg-slate-800 text-white border border-slate-800 hover:bg-slate-900 " +
    "disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

const BTN_DELETE =
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium " +
    "bg-white dark:bg-slate-900 text-rose-600 border border-slate-200 dark:border-slate-700 " +
    "hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

const INPUT =
    "w-full px-3.5 py-2.5 rounded-lg text-sm bg-white dark:bg-slate-800 " +
    "border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white " +
    "placeholder-slate-400 dark:placeholder-slate-500 outline-none " +
    "focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] transition-colors";

const LABEL = "text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400";

function Card({ children, dimmed = false }: { children: React.ReactNode; dimmed?: boolean }) {
    return (
        <div
            className={`w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden mb-6 ${
                dimmed ? 'opacity-50 pointer-events-none' : ''
            }`}
        >
            {children}
        </div>
    );
}

function CardHeader({ icon, title, tooltip }: { icon: React.ReactNode; title: string; tooltip: string }) {
    return (
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2 font-[Montserrat,'Montserrat_Fallback',sans-serif]">
                {icon}
                {title}
                <InfoTooltip content={tooltip} />
            </h3>
        </div>
    );
}

function KpiCard({
    icon, label, value, tooltip, valueClass = "text-[#0078D4]",
}: {
    icon: React.ReactNode; label: string; value: string; tooltip: string; valueClass?: string;
}) {
    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {icon}
                {label}
                <InfoTooltip content={tooltip} />
            </div>
            <div className={`mt-2 text-base font-extrabold truncate ${valueClass}`} title={value}>{value}</div>
        </div>
    );
}

export default function AiConfigPage() {
    const t = useTranslations('AdminAiConfig');
    const { selectedTenant, userRole, systemRole } = useTenant();
    const { instance, accounts, inProgress } = useMsal();

    const [provider, setProvider] = useState('system');
    const [apiKey, setApiKey] = useState('');
    const [apiKeyDirty, setApiKeyDirty] = useState(false);
    const [hasApiKey, setHasApiKey] = useState(false);
    const [apiKeyHint, setApiKeyHint] = useState<string | null>(null);
    const [lastTestStatus, setLastTestStatus] = useState<'SUCCESS' | 'FAILED' | null>(null);
    const [endpoint, setEndpoint] = useState('');
    const [deployment, setDeployment] = useState('gpt-4o');
    const [aiEnabled, setAiEnabled] = useState(true);
    const [sensitivity, setSensitivity] = useState<Sensitivity>('medium');
    const [shareResourceNames, setShareResourceNames] = useState(true);
    const [shareTags, setShareTags] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

    const tenantId = selectedTenant?.id || '';
    const isMock = isMockTenant(tenantId);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [accounts, instance]);

    useEffect(() => {
        const loadConfig = async () => {
            if (!tenantId || tenantId === 'default') {
                setLoading(false);
                return;
            }
            // Directiva 24: no despachar hasta que MSAL resolvió la sesión.
            // Sin esto el fetch salía con headers vacíos y devolvía 401.
            if (inProgress !== 'none' || (!isMock && accounts.length === 0)) return;

            setLoading(true);
            try {
                const headers = await authHeaders();
                const res = await fetch(`/api/admin/config/ai?tenantId=${tenantId}`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    setProvider(data.aiProvider || 'system');
                    setHasApiKey(Boolean(data.hasApiKey));
                    setApiKeyHint(data.apiKeyMaskedHint || null);
                    setLastTestStatus(data.lastConnectionStatus || null);
                    setEndpoint(data.aiEndpoint || '');
                    setDeployment(data.aiDeployment || 'gpt-4o');
                    setAiEnabled(data.aiEnabled ?? true);
                    setSensitivity((data.anomalySensitivity as Sensitivity) || 'medium');
                    setShareResourceNames(data.shareResourceNames ?? true);
                    setShareTags(data.shareTags ?? true);
                }
            } catch (e) {
                console.error('Error loading AI config:', e);
            }
            setLoading(false);
        };
        loadConfig();
    }, [tenantId, inProgress, accounts.length, isMock, authHeaders]);

    const handleSave = async () => {
        if (!selectedTenant || selectedTenant.id === 'default') {
            toast.error(t('errors.selectTenantFirst'));
            return;
        }

        setSaving(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };

            const body: Record<string, unknown> = {
                tenantId: selectedTenant.id,
                aiProvider: provider,
                aiEnabled,
                anomalySensitivity: sensitivity,
                shareResourceNames,
                shareTags,
            };

            // La API key nunca vuelve del servidor en claro (GET solo manda
            // hasApiKey), así que solo se manda al PATCH si el usuario la
            // tocó explícitamente — evita pisar la key ya guardada con un
            // campo vacío cada vez que se ajusta cualquier otro toggle.
            if (provider === 'system') {
                body.aiApiKey = null;
            } else if (apiKeyDirty) {
                body.aiApiKey = apiKey;
            }

            if (provider === 'azure_openai' || provider === 'anthropic') {
                body.aiEndpoint = endpoint || null;
                body.aiDeployment = deployment || null;
            } else {
                // Limpiar endpoint/deployment si deja de usarse Azure IA / Anthropic con endpoint
                body.aiEndpoint = null;
                body.aiDeployment = null;
            }

            const res = await fetch('/api/admin/config/ai', {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (res.ok) {
                toast.success(t('toasts.saveSuccess'));
                if (provider === 'system') {
                    setHasApiKey(false);
                    setApiKeyHint(null);
                    setEndpoint('');
                    setDeployment('gpt-4o');
                } else if (apiKeyDirty) {
                    setHasApiKey(Boolean(apiKey));
                }
                setApiKeyDirty(false);
                setApiKey('');
            } else {
                const data = await res.json();
                toast.error(data.error || t('errors.saveFailed'));
            }
        } catch (e) {
            console.error("Error saving AI config:", e);
            toast.error(t('errors.connectionFailed'));
        }
        setSaving(false);
    };

    const deleteApiKey = async () => {
        if (!selectedTenant || selectedTenant.id === 'default') return;

        const confirmed = window.confirm(t('confirmDeleteKey'));
        if (!confirmed) return;

        setDeleting(true);
        setTestResult(null);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            const res = await fetch('/api/admin/config/ai', {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    aiProvider: 'system',
                    aiApiKey: null,
                    aiEndpoint: null,
                    aiDeployment: null,
                    aiEnabled,
                    anomalySensitivity: sensitivity,
                    shareResourceNames,
                    shareTags,
                })
            });

            if (res.ok) {
                toast.success(t('toasts.keyDeleted'));
                setProvider('system');
                setHasApiKey(false);
                setApiKeyHint(null);
                setApiKey('');
                setApiKeyDirty(false);
                setEndpoint('');
                setDeployment('gpt-4o');
            } else {
                const data = await res.json();
                toast.error(data.error || t('errors.deleteFailed'));
            }
        } catch (e) {
            console.error("Error deleting AI key:", e);
            toast.error(t('errors.connectionFailed'));
        }
        setDeleting(false);
    };

    const testConnection = async () => {
        if (!selectedTenant || selectedTenant.id === 'default') return;

        setTesting(true);
        setTestResult(null);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            const res = await fetch('/api/admin/config/ai/test', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    provider,
                    apiKey: apiKeyDirty ? apiKey : undefined,
                    endpoint: (provider === 'azure_openai' || provider === 'anthropic') ? endpoint : undefined,
                    deployment: (provider === 'azure_openai' || provider === 'anthropic') ? deployment : undefined,
                })
            });
            const json = await res.json();
            if (json.success) {
                // El backend ahora devuelve latencia y modelo reconocido.
                const detail = json.latencyMs ? t('testResult.latency', { ms: json.latencyMs, model: json.modelName || '—' }) : '';
                setTestResult({ ok: true, message: `${t('testResult.success', { reply: json.reply })} ${detail}`.trim() });
                setLastTestStatus('SUCCESS');
            } else {
                setTestResult({ ok: false, message: json.error || t('errors.testFailed') });
                setLastTestStatus('FAILED');
            }
        } catch (e) {
            setTestResult({ ok: false, message: errorMessage(e) || t('errors.networkError') });
            setLastTestStatus('FAILED');
        }
        setTesting(false);
    };

    // Owner y Admin pueden configurar IA del tenant (API: requireTenantRole
    // Admin|Owner). SuperAdmin también vía systemRole.
    const canConfigureAi =
        userRole === 'Admin' ||
        userRole === 'Owner' ||
        systemRole === 'SUPERADMIN';

    if (!canConfigureAi) {
        return (
            <div className="flex flex-col items-center justify-center h-96">
                <IconLock size={48} stroke={1.5} className="text-slate-400 mb-4" />
                <h2 className="text-xl font-bold text-slate-700 dark:text-slate-300">{t('accessDenied.title')}</h2>
                <p className="text-sm text-slate-500 mt-2">{t('accessDenied.description')}</p>
            </div>
        );
    }

    const providerLabels: Record<string, string> = {
        system: t('provider.options.system'),
        azure_openai: t('provider.options.azureOpenai'),
        anthropic: t('provider.options.anthropic'),
        openai: t('provider.options.openai'),
        chatgpt: 'ChatGPT',
        google: t('provider.options.google'),
        deepseek: t('provider.options.deepseek'),
        kimi: 'Kimi (Moonshot)',
        mistral: 'Mistral AI',
        cohere: 'Cohere',
    };

    const privacyLabel = shareResourceNames && shareTags
        ? t('kpi.privacyFull')
        : !shareResourceNames && !shareTags
            ? t('kpi.privacyMasked')
            : t('kpi.privacyPartial');

    return (
        <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6 animate-in fade-in duration-500">
            <div className="mb-6 border-b border-slate-200 dark:border-slate-800 pb-4">
                <h1 className="text-2xl font-extrabold text-[#1B2A41] dark:text-white tracking-tight flex items-center gap-2 font-[Montserrat,'Montserrat_Fallback',sans-serif]">
                    <IconCpu size={26} stroke={1.5} className="text-[#0078D4]" />
                    {t('title')}
                    <InfoTooltip content={t('tooltips.page')} />
                </h1>
                <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm">{t('subtitle')}</p>
            </div>

            {isMock && (
                <div className="w-full mb-6 flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                    <IconAlertTriangle size={16} stroke={1.5} className="shrink-0" />
                    {t('mockBanner')}
                </div>
            )}

            {loading ? (
                <div className="text-sm text-slate-500 dark:text-slate-400">{t('loading')}</div>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
                        <KpiCard
                            icon={<IconBrain size={14} stroke={1.5} className="text-[#0078D4]" />}
                            label={t('kpi.status')}
                            value={aiEnabled ? t('kpi.statusEnabled') : t('kpi.statusDisabled')}
                            tooltip={t('tooltips.kpiStatus')}
                            valueClass={aiEnabled ? 'text-[#0078D4]' : 'text-slate-500'}
                        />
                        <KpiCard
                            icon={<IconBrandAzure size={14} stroke={1.5} className="text-[#0078D4]" />}
                            label={t('kpi.provider')}
                            value={providerLabels[provider] || provider}
                            tooltip={t('tooltips.kpiProvider')}
                            valueClass="text-blue-600"
                        />
                        <KpiCard
                            icon={<IconSparkles size={14} stroke={1.5} className="text-[#0078D4]" />}
                            label={t('kpi.model')}
                            value={provider === 'system' ? t('kpi.modelPlatform') : deployment || '—'}
                            tooltip={t('tooltips.kpiModel')}
                            valueClass="text-slate-900 dark:text-white"
                        />
                        <KpiCard
                            icon={<IconShieldLock size={14} stroke={1.5} className="text-[#0078D4]" />}
                            label={t('kpi.privacy')}
                            value={privacyLabel}
                            tooltip={t('tooltips.kpiPrivacy')}
                            valueClass="text-slate-900 dark:text-white"
                        />
                    </div>

                    {/* Bloque 1 — Funciones de IA */}
                    <Card>
                        <CardHeader
                            icon={<IconSparkles size={18} stroke={1.5} className="text-[#0078D4]" />}
                            title={t('aiFeatures.heading')}
                            tooltip={t('tooltips.aiFeatures')}
                        />
                        <div className="p-6">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div>
                                    <div className="text-sm font-semibold text-[#1B2A41] dark:text-white flex items-center gap-2">
                                        {t('aiFeatures.toggleLabel')}
                                        <InfoTooltip content={t('tooltips.aiToggle')} />
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                                        {t('aiFeatures.toggleDescription')}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={aiEnabled}
                                    onClick={() => setAiEnabled(!aiEnabled)}
                                    className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                        aiEnabled ? 'bg-[#0078D4]' : 'bg-slate-300 dark:bg-slate-700'
                                    }`}
                                >
                                    <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                            aiEnabled ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                    />
                                </button>
                            </div>
                        </div>
                    </Card>

                    {/* Bloque 2 — Proveedor BYOK */}
                    <Card dimmed={!aiEnabled}>
                        <CardHeader
                            icon={<IconKey size={18} stroke={1.5} className="text-[#0078D4]" />}
                            title={t('provider.heading')}
                            tooltip={t('tooltips.provider')}
                        />
                        <div className="p-6 space-y-5">
                            <div className="flex flex-col gap-1.5 max-w-xl">
                                <label className={LABEL}>{t('provider.selectLabel')}</label>
                                <select value={provider} onChange={(e) => setProvider(e.target.value)} className={INPUT}>
                                    <option value="system">{t('provider.options.system')}</option>
                                    <option value="azure_openai">{t('provider.options.azureOpenai')}</option>
                                    <option value="anthropic">{t('provider.options.anthropic')}</option>
                                    <option value="openai">{t('provider.options.openai')}</option>
                                    <option value="chatgpt">ChatGPT</option>
                                    <option value="google">{t('provider.options.google')}</option>
                                    <option value="deepseek">{t('provider.options.deepseek')}</option>
                                    <option value="kimi">Kimi (Moonshot)</option>
                                    <option value="mistral">Mistral AI</option>
                                    <option value="cohere">Cohere</option>
                                </select>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{t('provider.recommendation')}</p>
                            </div>

                            {provider !== 'system' && (
                                <div className="flex flex-col gap-1.5 max-w-xl">
                                    <label className={`${LABEL} flex items-center gap-1.5`}>
                                        {t('provider.apiKeyLabel')}
                                        <InfoTooltip content={t('tooltips.apiKey')} />
                                    </label>
                                    <input
                                        type="password"
                                        value={apiKey}
                                        onChange={(e) => { setApiKey(e.target.value); setApiKeyDirty(true); }}
                                        placeholder={hasApiKey ? t('provider.apiKeyPlaceholderSaved') : "sk-..."}
                                        autoComplete="new-password"
                                        className={INPUT}
                                    />
                                    {hasApiKey && !apiKeyDirty && (
                                        <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                            <IconCircleCheck size={14} stroke={1.5} />
                                            {t('provider.apiKeySavedNotice')}
                                            {apiKeyHint && <code className="ml-1 font-mono text-slate-500">{apiKeyHint}</code>}
                                        </p>
                                    )}
                                </div>
                            )}

                            {(provider === 'azure_openai' || provider === 'anthropic') && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="flex flex-col gap-1.5">
                                        <label className={LABEL}>
                                            {t('provider.endpointLabel')}{' '}
                                            {provider === 'anthropic' && (
                                                <span className="normal-case font-normal text-slate-400">({t('provider.optionalAzureAi')})</span>
                                            )}
                                        </label>
                                        <input
                                            type="text"
                                            value={endpoint}
                                            onChange={(e) => setEndpoint(e.target.value)}
                                            placeholder={provider === 'anthropic' ? "https://<resource>.services.ai.azure.com/anthropic/v1" : t('provider.endpointPlaceholder')}
                                            className={`${INPUT} font-mono text-xs`}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <label className={LABEL}>
                                            {t('provider.deploymentLabel')}{' '}
                                            {provider === 'anthropic' && (
                                                <span className="normal-case font-normal text-slate-400">({t('provider.optionalDeployment')})</span>
                                            )}
                                        </label>
                                        <input
                                            type="text"
                                            value={deployment}
                                            onChange={(e) => setDeployment(e.target.value)}
                                            placeholder={provider === 'anthropic' ? "claude-3-5-sonnet" : t('provider.deploymentPlaceholder')}
                                            className={`${INPUT} font-mono text-xs`}
                                        />
                                    </div>
                                </div>
                            )}

                            {testResult && (
                                <div className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg border ${testResult.ok
                                    ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300"
                                    : "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300"}`}>
                                    {testResult.ok
                                        ? <IconCircleCheck size={16} stroke={1.5} className="shrink-0 mt-0.5" />
                                        : <IconCircleX size={16} stroke={1.5} className="shrink-0 mt-0.5" />}
                                    <span>{testResult.message}</span>
                                </div>
                            )}

                            {/* Resultado sellado de la última prueba, incluso entre sesiones. */}
                            {!testResult && lastTestStatus && (
                                <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                                    {lastTestStatus === 'SUCCESS'
                                        ? <IconCircleCheck size={14} stroke={1.5} className="text-emerald-600" />
                                        : <IconCircleX size={14} stroke={1.5} className="text-rose-600" />}
                                    {t(lastTestStatus === 'SUCCESS' ? 'provider.lastTestOk' : 'provider.lastTestFailed')}
                                </p>
                            )}

                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    onClick={testConnection}
                                    disabled={testing || (provider !== 'system' && !hasApiKey)}
                                    title={provider !== 'system' && !hasApiKey ? t('provider.saveKeyFirst') : t('provider.testConnectionTitle')}
                                    className={BTN_TEST}
                                >
                                    {testing
                                        ? <IconLoader2 size={16} stroke={1.5} className="animate-spin" />
                                        : <IconSparkles size={16} stroke={1.5} />}
                                    {t('provider.testConnection')}
                                </button>
                                <button
                                    onClick={deleteApiKey}
                                    disabled={deleting || !hasApiKey}
                                    title={!hasApiKey ? t('provider.noKeySaved') : t('provider.deleteKeyTitle')}
                                    className={BTN_DELETE}
                                >
                                    {deleting
                                        ? <IconLoader2 size={16} stroke={1.5} className="animate-spin" />
                                        : <IconTrash size={16} stroke={1.5} className="text-rose-600" />}
                                    {t('provider.deleteApiKey')}
                                </button>
                            </div>
                        </div>
                    </Card>

                    {/* Bloque 3 — Sensibilidad de anomalías */}
                    <Card dimmed={!aiEnabled}>
                        <CardHeader
                            icon={<IconAdjustments size={18} stroke={1.5} className="text-[#0078D4]" />}
                            title={t('sensitivity.heading')}
                            tooltip={t('tooltips.sensitivity')}
                        />
                        <div className="p-6">
                            <div className="flex flex-col gap-1.5 max-w-xl">
                                <label className={LABEL}>{t('sensitivity.levelLabel')}</label>
                                <select
                                    value={sensitivity}
                                    onChange={(e) => setSensitivity(e.target.value as Sensitivity)}
                                    className={INPUT}
                                >
                                    <option value="low">{t('sensitivity.options.low')}</option>
                                    <option value="medium">{t('sensitivity.options.medium')}</option>
                                    <option value="high">{t('sensitivity.options.high')}</option>
                                </select>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{t('sensitivity.description')}</p>
                            </div>
                        </div>
                    </Card>

                    {/* Bloque 4 — Qué datos se comparten */}
                    <Card dimmed={!aiEnabled}>
                        <CardHeader
                            icon={<IconShieldCheck size={18} stroke={1.5} className="text-[#0078D4]" />}
                            title={t('dataSharing.heading')}
                            tooltip={t('tooltips.dataSharing')}
                        />
                        <div className="p-6 space-y-4">
                            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-3xl">{t('dataSharing.description')}</p>
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={shareResourceNames}
                                    onChange={(e) => setShareResourceNames(e.target.checked)}
                                    className="mt-1 h-4 w-4 rounded border-slate-300 text-[#0078D4] focus:ring-[#0078D4]"
                                />
                                <div>
                                    <div className="text-sm font-medium text-[#1B2A41] dark:text-slate-200">{t('dataSharing.resourceNames.label')}</div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">{t('dataSharing.resourceNames.description')}</p>
                                </div>
                            </label>
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={shareTags}
                                    onChange={(e) => setShareTags(e.target.checked)}
                                    className="mt-1 h-4 w-4 rounded border-slate-300 text-[#0078D4] focus:ring-[#0078D4]"
                                />
                                <div>
                                    <div className="text-sm font-medium text-[#1B2A41] dark:text-slate-200">{t('dataSharing.tags.label')}</div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">{t('dataSharing.tags.description')}</p>
                                </div>
                            </label>
                        </div>
                    </Card>

                    <div className="pt-2">
                        <button
                            onClick={handleSave}
                            disabled={saving || (provider !== 'system' && !hasApiKey && !apiKey)}
                            className={BTN_PRIMARY}
                        >
                            <IconDeviceFloppy size={16} stroke={1.5} />
                            {saving ? t('saving') : t('saveConfiguration')}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
