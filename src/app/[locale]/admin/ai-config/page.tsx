"use client";
import React, { useEffect, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Cpu, Save, Lock, ShieldAlert, Loader2, CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getFreshIdToken } from '@/lib/msalToken';
import { useTranslations } from 'next-intl';

type Sensitivity = 'low' | 'medium' | 'high';

export default function AiConfigPage() {
    const t = useTranslations('AdminAiConfig');
    const { selectedTenant, userRole, systemRole } = useTenant();
    const { instance, accounts } = useMsal();

    const [provider, setProvider] = useState('system');
    const [apiKey, setApiKey] = useState('');
    const [apiKeyDirty, setApiKeyDirty] = useState(false);
    const [hasApiKey, setHasApiKey] = useState(false);
    const [aiEnabled, setAiEnabled] = useState(true);
    const [sensitivity, setSensitivity] = useState<Sensitivity>('medium');
    const [shareResourceNames, setShareResourceNames] = useState(true);
    const [shareTags, setShareTags] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

    const authHeaders = async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    };

    useEffect(() => {
        const loadConfig = async () => {
            if (!selectedTenant?.id || selectedTenant.id === 'default') {
                setLoading(false);
                return;
            }
            setLoading(true);
            try {
                const headers = await authHeaders();
                const res = await fetch(`/api/admin/config/ai?tenantId=${selectedTenant.id}`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    setProvider(data.aiProvider || 'system');
                    setHasApiKey(Boolean(data.hasApiKey));
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTenant?.id]);

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
                setApiKey('');
                setApiKeyDirty(false);
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
                body: JSON.stringify({ tenantId: selectedTenant.id })
            });
            const json = await res.json();
            setTestResult(json.success
                ? { ok: true, message: t('testResult.success', { reply: json.reply }) }
                : { ok: false, message: json.error || t('errors.testFailed') });
        } catch (e: any) {
            setTestResult({ ok: false, message: e?.message || t('errors.networkError') });
        }
        setTesting(false);
    };

    if (userRole !== 'Admin' && systemRole !== 'SUPERADMIN') {
        return (
            <div className="flex flex-col items-center justify-center h-96">
                <Lock className="w-12 h-12 text-gray-400 mb-4" />
                <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300">{t('accessDenied.title')}</h2>
                <p className="text-sm text-gray-500 mt-2">{t('accessDenied.description')}</p>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-4xl mx-auto animate-in fade-in duration-500">
            <div className="mb-8 border-b border-gray-200 dark:border-gray-800 pb-4">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                    <Cpu className="w-8 h-8 mr-3 text-[#0054A6] dark:text-[#00AEEF]" />
                    {t('title')}
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">
                    {t('subtitle')}
                </p>
            </div>

            {loading ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">{t('loading')}</div>
            ) : (
                <div className="space-y-8">
                    {/* Habilitar/deshabilitar funciones de IA */}
                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
                            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('aiFeatures.heading')}</h3>
                        </div>
                        <div className="p-6">
                            <label className="flex items-center justify-between max-w-md cursor-pointer">
                                <div>
                                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('aiFeatures.toggleLabel')}</div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {t('aiFeatures.toggleDescription')}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={aiEnabled}
                                    onClick={() => setAiEnabled(!aiEnabled)}
                                    className={`ml-4 shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                        aiEnabled ? 'bg-[#0054A6]' : 'bg-gray-300 dark:bg-slate-700'
                                    }`}
                                >
                                    <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                            aiEnabled ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                    />
                                </button>
                            </label>
                        </div>
                    </div>

                    {/* Proveedor de IA (BYOK) */}
                    <div className={`bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden ${!aiEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
                            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('provider.heading')}</h3>
                        </div>
                        <div className="p-6">
                            <div className="flex flex-col mb-6">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('provider.selectLabel')}</label>
                                <select
                                    value={provider}
                                    onChange={(e) => setProvider(e.target.value)}
                                    className="w-full max-w-md px-3 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-md focus:ring-[#0054A6] focus:border-[#0054A6] sm:text-sm"
                                >
                                    <option value="system">{t('provider.options.system')}</option>
                                    <option value="openai">{t('provider.options.openai')}</option>
                                    <option value="azure_openai">{t('provider.options.azureOpenai')}</option>
                                    <option value="anthropic">{t('provider.options.anthropic')}</option>
                                    <option value="google">{t('provider.options.google')}</option>
                                    <option value="deepseek">{t('provider.options.deepseek')}</option>
                                </select>
                                <p className="text-xs text-gray-500 mt-2">
                                    {t('provider.recommendation')}
                                </p>
                            </div>

                            {provider !== 'system' && (
                                <div className="flex flex-col mb-2">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('provider.apiKeyLabel')}</label>
                                    <input
                                        type="password"
                                        value={apiKey}
                                        onChange={(e) => { setApiKey(e.target.value); setApiKeyDirty(true); }}
                                        placeholder={hasApiKey ? t('provider.apiKeyPlaceholderSaved') : "sk-..."}
                                        className="w-full max-w-md px-4 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-md focus:ring-[#0054A6] focus:border-[#0054A6] sm:text-sm"
                                    />
                                    {hasApiKey && !apiKeyDirty && (
                                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">{t('provider.apiKeySavedNotice')}</p>
                                    )}
                                </div>
                            )}

                            {testResult && (
                                <div className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg border mb-2 ${testResult.ok
                                    ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300"
                                    : "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300"}`}>
                                    {testResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                                    <span>{testResult.message}</span>
                                </div>
                            )}

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={testConnection}
                                    disabled={testing || (provider !== 'system' && !hasApiKey)}
                                    title={provider !== 'system' && !hasApiKey ? t('provider.saveKeyFirst') : t('provider.testConnectionTitle')}
                                    className="px-4 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-md disabled:opacity-50 flex items-center gap-2"
                                >
                                    {testing && <Loader2 className="w-4 h-4 animate-spin" />} {t('provider.testConnection')}
                                </button>
                                <button
                                    onClick={deleteApiKey}
                                    disabled={deleting || !hasApiKey}
                                    title={!hasApiKey ? t('provider.noKeySaved') : t('provider.deleteKeyTitle')}
                                    className="px-4 py-2 bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-sm font-semibold rounded-md disabled:opacity-50 flex items-center gap-2"
                                >
                                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {t('provider.deleteApiKey')}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Sensibilidad de detección de anomalías */}
                    <div className={`bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden ${!aiEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
                            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('sensitivity.heading')}</h3>
                        </div>
                        <div className="p-6">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                {t('sensitivity.levelLabel')}
                            </label>
                            <select
                                value={sensitivity}
                                onChange={(e) => setSensitivity(e.target.value as Sensitivity)}
                                className="w-full max-w-md px-3 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-md focus:ring-[#0054A6] focus:border-[#0054A6] sm:text-sm"
                            >
                                <option value="low">{t('sensitivity.options.low')}</option>
                                <option value="medium">{t('sensitivity.options.medium')}</option>
                                <option value="high">{t('sensitivity.options.high')}</option>
                            </select>
                            <p className="text-xs text-gray-500 mt-2">
                                {t('sensitivity.description')}
                            </p>
                        </div>
                    </div>

                    {/* Qué datos se comparten */}
                    <div className={`bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden ${!aiEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
                            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center">
                                <ShieldAlert className="w-5 h-5 mr-2 text-amber-500" />
                                {t('dataSharing.heading')}
                            </h3>
                        </div>
                        <div className="p-6 space-y-4">
                            <p className="text-xs text-gray-500 mb-2">
                                {t('dataSharing.description')}
                            </p>
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={shareResourceNames}
                                    onChange={(e) => setShareResourceNames(e.target.checked)}
                                    className="mt-1 h-4 w-4 rounded border-gray-300 text-[#0054A6] focus:ring-[#0054A6]"
                                />
                                <div>
                                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('dataSharing.resourceNames.label')}</div>
                                    <p className="text-xs text-gray-500">{t('dataSharing.resourceNames.description')}</p>
                                </div>
                            </label>
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={shareTags}
                                    onChange={(e) => setShareTags(e.target.checked)}
                                    className="mt-1 h-4 w-4 rounded border-gray-300 text-[#0054A6] focus:ring-[#0054A6]"
                                />
                                <div>
                                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('dataSharing.tags.label')}</div>
                                    <p className="text-xs text-gray-500">{t('dataSharing.tags.description')}</p>
                                </div>
                            </label>
                        </div>
                    </div>

                    <div className="pt-2">
                        <button
                            onClick={handleSave}
                            disabled={saving || (provider !== 'system' && !hasApiKey && !apiKey)}
                            className="flex items-center px-4 py-2 bg-[#0054A6] text-white rounded-md shadow-sm text-sm font-semibold hover:bg-[#004080] disabled:opacity-50 transition-colors"
                        >
                            <Save className="w-4 h-4 mr-2" />
                            {saving ? t('saving') : t('saveConfiguration')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
