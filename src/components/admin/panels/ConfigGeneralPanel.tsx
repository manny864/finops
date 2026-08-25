"use client";
/**
 * Configuración Global — pestaña General.
 *
 * Bloques: Apariencia (tema), Marca (logo), Integraciones (webhook / ITSM /
 * Power BI) y Zona de Peligro.
 *
 * La configuración se lee UNA vez en este componente y baja por props. Antes
 * cada sub-bloque llamaba a `useTenant()` y hacía su propio fetch, así que un
 * cambio de tenant disparaba tres requests desacoplados que podían quedar
 * inconsistentes entre sí.
 */
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import {
    IconAlertTriangle,
    IconCheck,
    IconCopy,
    IconDeviceDesktop,
    IconDeviceFloppy,
    IconKey,
    IconLock,
    IconMoon,
    IconPalette,
    IconPhoto,
    IconPlugConnected,
    IconSettings,
    IconSparkles,
    IconSun,
    IconTrash,
    IconUpload,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { toast } from 'sonner';
import { getFreshIdToken } from '@/lib/msalToken';

import InfoTooltip from '@/components/InfoTooltip';
import { isMockTenant } from '@/lib/mockData';
import { hasAccess } from '@/lib/tierLogic';
import { errorMessage } from '@/lib/apiErrors';
import type {
    ItsmSystemType,
    TenantGlobalConfig,
} from '@/types/tenantConfiguration.types';
import { themeToClient, themeToDb } from '@/types/tenantConfiguration.types';

/* Botonera corporativa (Directiva 21): fondo blanco, borde = color del texto. */
const BTN_PRIMARY =
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold " +
    "bg-[#0078D4] text-white border border-[#0078D4] hover:bg-[#0060AA] hover:border-[#0060AA] " +
    "disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

const BTN_TEST =
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold " +
    "bg-white dark:bg-slate-900 text-[#0078D4] border border-[#0078D4] hover:bg-blue-50 dark:hover:bg-blue-950/30 " +
    "disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

const BTN_NEUTRAL =
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold " +
    "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 " +
    "hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

const BTN_DANGER =
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold " +
    "bg-white dark:bg-slate-900 text-rose-600 border border-rose-300 dark:border-rose-800 " +
    "hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

const INPUT =
    "w-full px-3.5 py-2.5 rounded-lg text-sm bg-white dark:bg-slate-800 " +
    "border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white " +
    "placeholder-slate-400 dark:placeholder-slate-500 outline-none " +
    "focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] transition-colors " +
    "disabled:bg-slate-50 dark:disabled:bg-slate-900 disabled:text-slate-500";

const LABEL = "text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400";

function Card({ children }: { children: React.ReactNode }) {
    return (
        <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden mb-6">
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

export default function ConfigPage() {
    const t = useTranslations('AdminConfig');
    const { selectedTenant } = useTenant();
    const { instance, accounts, inProgress } = useMsal();
    const [mounted, setMounted] = useState(false);
    const [config, setConfig] = useState<TenantGlobalConfig | null>(null);
    const [loading, setLoading] = useState(true);

    const tenantId = selectedTenant?.id || '';
    const isMock = isMockTenant(tenantId);
    // Directiva 24 (prevención del 401 a los 11 ms): no despachar hasta que MSAL
    // haya terminado de resolver la sesión y haya una cuenta (o sea demo).
    const canFetch = Boolean(tenantId) && tenantId !== 'default' && inProgress === 'none' && (isMock || accounts.length > 0);

    useEffect(() => { setMounted(true); }, []);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (isMock || accounts.length === 0) return {};
        const idToken = await getFreshIdToken(instance, accounts[0]);
        return { Authorization: `Bearer ${idToken}` };
    }, [isMock, accounts, instance]);

    const loadConfig = useCallback(async () => {
        if (!canFetch) { setLoading(false); return; }
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/config/general?tenantId=${encodeURIComponent(tenantId)}`, {
                headers: await authHeaders(),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t('loadFailed'));
            setConfig(json.config as TenantGlobalConfig);
        } catch (e) {
            console.error('[ConfigGeneral] load error:', e);
            toast.error(t('loadFailed'), { description: errorMessage(e) });
            setConfig(null);
        } finally {
            setLoading(false);
        }
    }, [canFetch, tenantId, authHeaders, t]);

    useEffect(() => { loadConfig(); }, [loadConfig]);

    if (!mounted) return null;

    return (
        <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6 animate-in fade-in duration-500">
            <div className="mb-6 border-b border-slate-200 dark:border-slate-800 pb-4">
                <h1 className="text-2xl font-extrabold text-[#1B2A41] dark:text-white tracking-tight flex items-center gap-2 font-[Montserrat,'Montserrat_Fallback',sans-serif]">
                    <IconSettings size={26} stroke={1.5} className="text-[#0078D4]" />
                    {t('pageTitle')}
                    <InfoTooltip content={t('tooltips.page')} />
                </h1>
                <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm">{t('pageSubtitle')}</p>
            </div>

            {isMock && (
                <div className="w-full mb-6 flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                    <IconAlertTriangle size={16} stroke={1.5} className="shrink-0" />
                    {t('mockBanner')}
                </div>
            )}

            {tenantId === 'default' ? (
                <div className="text-sm text-slate-500 dark:text-slate-400">{t('webhook.selectTenantPrompt')}</div>
            ) : (
                <>
                    <AppearanceCard config={config} tenantId={tenantId} authHeaders={authHeaders} isMock={isMock} />

                    <Card>
                        <CardHeader
                            icon={<IconPhoto size={18} stroke={1.5} className="text-[#0078D4]" />}
                            title={t('brandingSection')}
                            tooltip={t('tooltips.branding')}
                        />
                        <div className="p-6"><BrandingConfig /></div>
                    </Card>

                    <Card>
                        <CardHeader
                            icon={<IconPlugConnected size={18} stroke={1.5} className="text-[#0078D4]" />}
                            title={t('integrationsSection')}
                            tooltip={t('tooltips.integrations')}
                        />
                        <div className="p-6 flex flex-col gap-8">
                            <WebhookConfig config={config} tenantId={tenantId} authHeaders={authHeaders} loading={loading} />
                            <div className="border-t border-slate-200 dark:border-slate-800 pt-6">
                                <ITSMConfig config={config} tenantId={tenantId} authHeaders={authHeaders} onSaved={loadConfig} />
                            </div>
                            <div className="border-t border-slate-200 dark:border-slate-800 pt-6">
                                <PowerBIExportConfig config={config} tenantId={tenantId} authHeaders={authHeaders} isMock={isMock} />
                            </div>
                        </div>
                    </Card>
                </>
            )}
        </div>
    );
}

/* ------------------------------- Apariencia ------------------------------- */

function AppearanceCard({
    config, tenantId, authHeaders, isMock,
}: {
    config: TenantGlobalConfig | null;
    tenantId: string;
    authHeaders: () => Promise<Record<string, string>>;
    isMock: boolean;
}) {
    const t = useTranslations('AdminConfig');
    const { theme, setTheme } = useTheme();
    const [saving, setSaving] = useState(false);

    // La preferencia guardada manda sobre el localStorage de next-themes: es la
    // que sigue al usuario entre navegadores.
    useEffect(() => {
        if (config?.theme) setTheme(themeToClient(config.theme));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config?.theme]);

    const applyTheme = async (next: 'light' | 'dark' | 'system') => {
        const previous = theme;
        setTheme(next); // optimista: el cambio visual es inmediato
        if (isMock) return;
        setSaving(true);
        try {
            const res = await fetch('/api/admin/config/general', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
                body: JSON.stringify({ tenantId, theme: themeToDb(next) }),
            });
            if (!res.ok) {
                const json = await res.json().catch(() => ({}));
                throw new Error(json.error || t('themeSaveFailed'));
            }
        } catch (e) {
            if (previous) setTheme(previous); // revertir: no dejar una UI que miente sobre lo guardado
            toast.error(t('themeSaveFailed'), { description: errorMessage(e) });
        } finally {
            setSaving(false);
        }
    };

    const options: Array<{ key: 'light' | 'dark' | 'system'; label: string; icon: React.ReactNode }> = [
        { key: 'light', label: t('themeLight'), icon: <IconSun size={16} stroke={1.5} /> },
        { key: 'dark', label: t('themeDark'), icon: <IconMoon size={16} stroke={1.5} /> },
        { key: 'system', label: t('themeSystem'), icon: <IconDeviceDesktop size={16} stroke={1.5} /> },
    ];

    return (
        <Card>
            <CardHeader
                icon={<IconPalette size={18} stroke={1.5} className="text-[#0078D4]" />}
                title={t('appearanceSection')}
                tooltip={t('tooltips.appearance')}
            />
            <div className="p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h4 className="font-semibold text-[#1B2A41] dark:text-white flex items-center gap-2">
                            {t('themeTitle')}
                            <InfoTooltip content={t('tooltips.theme')} />
                        </h4>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('themeSubtitle')}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {options.map((opt) => {
                            const active = theme === opt.key;
                            return (
                                <button
                                    key={opt.key}
                                    onClick={() => applyTheme(opt.key)}
                                    disabled={saving}
                                    aria-pressed={active}
                                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-50 ${
                                        active
                                            ? 'bg-white dark:bg-slate-900 text-[#0078D4] border-[#0078D4]'
                                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                                    }`}
                                >
                                    {opt.icon}
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        </Card>
    );
}

/* ----------------------------- Webhook alertas ---------------------------- */

function WebhookConfig({
    config, tenantId, authHeaders, loading,
}: {
    config: TenantGlobalConfig | null;
    tenantId: string;
    authHeaders: () => Promise<Record<string, string>>;
    loading: boolean;
}) {
    const t = useTranslations('AdminConfig');
    const [webhookUrl, setWebhookUrl] = useState('');
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        setWebhookUrl(config?.integrations.proactiveAlertsWebhookUrl || '');
    }, [config?.integrations.proactiveAlertsWebhookUrl]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/admin/config/webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
                body: JSON.stringify({ tenantId, webhookUrl }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || t('webhook.saveErrorToast'));
            toast.success(t('webhook.savedToast'));
        } catch (e) {
            toast.error(t('webhook.saveErrorToast'), { description: errorMessage(e) });
        }
        setSaving(false);
    };

    const handleTest = async () => {
        setTesting(true);
        try {
            const res = await fetch('/api/admin/config/integrations/test-webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
                body: JSON.stringify({ tenantId, webhookUrl }),
            });
            const json = await res.json().catch(() => ({}));
            if (json.ok) toast.success(t('webhook.testOk'));
            else toast.error(t('webhook.testFailed'), { description: json.error || json.detail || `HTTP ${json.status ?? res.status}` });
        } catch (e) {
            toast.error(t('webhook.testFailed'), { description: errorMessage(e) });
        }
        setTesting(false);
    };

    return (
        <div id="notifications-config" className="flex flex-col scroll-mt-24">
            <h4 className="font-semibold text-[#1B2A41] dark:text-white flex items-center gap-2">
                {t('webhook.title')}
                <InfoTooltip content={t('tooltips.webhook')} />
            </h4>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-4">{t('webhook.description')}</p>

            {loading ? (
                <div className="text-sm text-slate-400">{t('webhook.loading')}</div>
            ) : (
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    <input
                        type="url"
                        value={webhookUrl}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                        placeholder={t('webhook.placeholder')}
                        className={`${INPUT} lg:flex-1`}
                    />
                    <div className="flex gap-2 shrink-0">
                        <button onClick={handleTest} disabled={testing || !webhookUrl.trim()} className={BTN_TEST}>
                            <IconSparkles size={16} stroke={1.5} />
                            {testing ? t('webhook.testing') : t('webhook.test')}
                        </button>
                        <button onClick={handleSave} disabled={saving} className={BTN_PRIMARY}>
                            <IconDeviceFloppy size={16} stroke={1.5} />
                            {saving ? t('webhook.saving') : t('webhook.save')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ---------------------------------- ITSM ---------------------------------- */

function ITSMConfig({
    config, tenantId, authHeaders, onSaved,
}: {
    config: TenantGlobalConfig | null;
    tenantId: string;
    authHeaders: () => Promise<Record<string, string>>;
    onSaved: () => void;
}) {
    const t = useTranslations('AdminConfig');
    const { selectedTenant } = useTenant();
    const isPro = hasAccess(selectedTenant?.tier || 'Professional', 'Professional');

    const [system, setSystem] = useState<ItsmSystemType>('NONE');
    const [baseUrl, setBaseUrl] = useState('');
    const [userEmail, setUserEmail] = useState('');
    const [projectKey, setProjectKey] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    const integrations = config?.integrations;
    useEffect(() => {
        setSystem(integrations?.itsmSystem || 'NONE');
        setBaseUrl(integrations?.itsmBaseUrl || '');
        setUserEmail(integrations?.itsmUserEmail || '');
        setProjectKey(integrations?.itsmProjectKey || '');
        setApiKey(''); // el secreto guardado nunca baja al cliente
    }, [integrations]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/admin/config/general', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
                body: JSON.stringify({
                    tenantId,
                    itsm: { system, baseUrl, userEmail, projectKey, ...(apiKey.trim() ? { apiKey } : {}) },
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || t('itsm.saveFailed'));
            setApiKey('');
            toast.success(t('itsm.savedToast'));
            onSaved();
        } catch (e) {
            toast.error(t('itsm.saveFailed'), { description: errorMessage(e) });
        }
        setSaving(false);
    };

    const handleTest = async () => {
        setTesting(true);
        try {
            const res = await fetch('/api/admin/config/integrations/test-itsm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
                body: JSON.stringify({ tenantId }),
            });
            const json = await res.json().catch(() => ({}));
            if (json.ok) toast.success(t('itsm.testOk'), { description: json.identity });
            else toast.error(t('itsm.testFailed'), { description: json.error || `HTTP ${json.status ?? res.status}` });
        } catch (e) {
            toast.error(t('itsm.testFailed'), { description: errorMessage(e) });
        }
        setTesting(false);
    };

    const disabled = !isPro;
    const needsCreds = system !== 'NONE';

    return (
        <div className="flex flex-col">
            <h4 className="font-semibold text-[#1B2A41] dark:text-white flex items-center gap-2">
                {t('itsm.title')}
                <InfoTooltip content={t('tooltips.itsm')} />
                {!isPro && (
                    <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                        {t('itsm.proBadge')}
                    </span>
                )}
            </h4>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-4">{t('itsm.description')}</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                <div className="flex flex-col gap-1.5">
                    <label className={LABEL}>{t('itsm.targetSystem')}</label>
                    <select
                        value={system}
                        onChange={(e) => setSystem(e.target.value as ItsmSystemType)}
                        disabled={disabled}
                        className={INPUT}
                    >
                        <option value="NONE">{t('itsm.systemNone')}</option>
                        <option value="JIRA">Jira Software</option>
                        <option value="AZURE_DEVOPS">Azure DevOps Boards</option>
                        <option value="SERVICENOW">ServiceNow</option>
                    </select>
                </div>

                {needsCreds && (
                    <>
                        <div className="flex flex-col gap-1.5">
                            <label className={LABEL}>{t('itsm.baseUrl')}</label>
                            <input
                                type="url"
                                value={baseUrl}
                                onChange={(e) => setBaseUrl(e.target.value)}
                                disabled={disabled}
                                placeholder={system === 'AZURE_DEVOPS' ? 'https://dev.azure.com/mi-organizacion' : t('itsm.jiraUrlPlaceholder')}
                                className={INPUT}
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className={LABEL}>{t('itsm.userEmail')}</label>
                            <input
                                type="email"
                                value={userEmail}
                                onChange={(e) => setUserEmail(e.target.value)}
                                disabled={disabled || system === 'AZURE_DEVOPS'}
                                placeholder={system === 'AZURE_DEVOPS' ? t('itsm.userNotNeeded') : 'finops@empresa.com'}
                                className={INPUT}
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className={LABEL}>{t('itsm.projectKey')}</label>
                            <input
                                type="text"
                                value={projectKey}
                                onChange={(e) => setProjectKey(e.target.value)}
                                disabled={disabled}
                                placeholder="FINOPS"
                                className={INPUT}
                            />
                        </div>

                        <div className="flex flex-col gap-1.5 md:col-span-2">
                            <label className={`${LABEL} flex items-center gap-1.5`}>
                                {t('itsm.apiToken')}
                                <InfoTooltip content={t('tooltips.itsmToken')} />
                            </label>
                            <input
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                disabled={disabled}
                                autoComplete="new-password"
                                placeholder={integrations?.isItsmConfigured ? t('itsm.tokenStored') : t('itsm.tokenPlaceholder')}
                                className={INPUT}
                            />
                        </div>
                    </>
                )}
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
                <button onClick={handleTest} disabled={disabled || testing || !integrations?.isItsmConfigured} className={BTN_TEST}>
                    <IconSparkles size={16} stroke={1.5} />
                    {testing ? t('itsm.testing') : t('itsm.test')}
                </button>
                <button onClick={handleSave} disabled={disabled || saving} className={BTN_PRIMARY}>
                    <IconLock size={16} stroke={1.5} />
                    {saving ? t('itsm.saving') : t('itsm.saveCredentials')}
                </button>
            </div>
        </div>
    );
}

/* -------------------------- Power BI / Fabric ----------------------------- */

function PowerBIExportConfig({
    config, tenantId, authHeaders, isMock,
}: {
    config: TenantGlobalConfig | null;
    tenantId: string;
    authHeaders: () => Promise<Record<string, string>>;
    isMock: boolean;
}) {
    const t = useTranslations('AdminConfig');
    const { selectedTenant } = useTenant();
    const isEnterprise = hasAccess(selectedTenant?.tier || 'Professional', 'Enterprise');
    const [copied, setCopied] = useState(false);
    const [issuing, setIssuing] = useState(false);
    const [issuedToken, setIssuedToken] = useState<string | null>(null);

    const exportUrl = config?.integrations.powerBiExportUrl || '';

    const handleCopy = async (value: string) => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        toast.success(t('powerbi.copiedToast'));
        setTimeout(() => setCopied(false), 2000);
    };

    /**
     * Emite un API key dedicado en vez de exponer el client_secret del Service
     * Principal: el key es revocable, se guarda hasheado (sha256) y sólo lo ve
     * el admin una vez. Reusa /api/admin/mcp-keys, que es el mecanismo que el
     * feed ya valida.
     */
    const handleIssueToken = async () => {
        if (isMock) { setIssuedToken('mcp_demo0000000000000000000000000000'); return; }
        setIssuing(true);
        try {
            const res = await fetch('/api/admin/mcp-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
                body: JSON.stringify({ tenantId, label: 'Power BI / Fabric Connector' }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.key) throw new Error(json.error || t('powerbi.tokenFailed'));
            setIssuedToken(json.key);
        } catch (e) {
            toast.error(t('powerbi.tokenFailed'), { description: errorMessage(e) });
        }
        setIssuing(false);
    };

    return (
        <div className="flex flex-col">
            <h4 className="font-semibold text-[#1B2A41] dark:text-white flex items-center gap-2">
                {t('powerbi.title')}
                <InfoTooltip content={t('tooltips.powerbi')} />
                {!isEnterprise && (
                    <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                        {t('powerbi.enterpriseBadge')}
                    </span>
                )}
            </h4>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-4">
                {t.rich('powerbi.description', { b: (chunks) => <b>{chunks}</b> })}
            </p>

            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <input
                    type="text"
                    readOnly
                    value={isEnterprise ? exportUrl : '••••••••••••••••••••••••••••••••'}
                    className={`${INPUT} lg:flex-1 font-mono text-xs`}
                />
                <div className="flex gap-2 shrink-0">
                    <button onClick={() => handleCopy(exportUrl)} disabled={!isEnterprise || !exportUrl} className={BTN_TEST}>
                        {copied ? <IconCheck size={16} stroke={1.5} className="text-emerald-600" /> : <IconCopy size={16} stroke={1.5} />}
                        {copied ? t('powerbi.copied') : t('powerbi.copyUrl')}
                    </button>
                    <button onClick={handleIssueToken} disabled={!isEnterprise || issuing} className={BTN_PRIMARY}>
                        <IconKey size={16} stroke={1.5} />
                        {issuing ? t('powerbi.issuing') : t('powerbi.issueToken')}
                    </button>
                </div>
            </div>

            {issuedToken && (
                <div className="mt-4 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-4">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                        <IconAlertTriangle size={14} stroke={1.5} />
                        {t('powerbi.tokenOnce')}
                    </p>
                    <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
                        <code className="flex-1 px-3 py-2 rounded-md bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/50 text-xs font-mono break-all text-[#1B2A41] dark:text-slate-200">
                            {issuedToken}
                        </code>
                        <button onClick={() => handleCopy(issuedToken)} className={BTN_NEUTRAL}>
                            <IconCopy size={16} stroke={1.5} />
                            {t('powerbi.copyToken')}
                        </button>
                    </div>
                    <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">{t('powerbi.tokenHeaderHint')}</p>
                </div>
            )}
        </div>
    );
}

/* --------------------------------- Marca ---------------------------------- */

function BrandingConfig() {
    const t = useTranslations('AdminConfig');
    const { selectedTenant, setSelectedTenant, userRole } = useTenant();
    const { instance, accounts } = useMsal();
    const [uploading, setUploading] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [cacheBust, setCacheBust] = useState(0);

    const canManage = userRole === 'Admin' || userRole === 'Owner';
    const isMock = isMockTenant(selectedTenant?.id || '');

    if (!selectedTenant || selectedTenant.id === 'default') {
        return <div className="text-sm text-slate-500">{t('branding.selectTenantPrompt')}</div>;
    }

    const handleUpload = async (file: File) => {
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            toast.error(t('branding.logoTooLarge'));
            return;
        }
        setUploading(true);
        try {
            // El upload es multipart: no fijar Content-Type, el browser arma el boundary.
            const headers: Record<string, string> = {};
            if (!isMock && accounts.length > 0) {
                headers.Authorization = `Bearer ${await getFreshIdToken(instance, accounts[0])}`;
            }
            const form = new FormData();
            form.append('tenantId', selectedTenant.id);
            form.append('file', file);
            const res = await fetch('/api/admin/tenants/logo', { method: 'POST', headers, body: form });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t('branding.uploadFailed'));
            setSelectedTenant({ ...selectedTenant, has_logo: true, logo_version: String(Date.now()) });
            setCacheBust(Date.now());
            toast.success(t('branding.updatedToast'));
        } catch (e) {
            toast.error(t('branding.uploadErrorToast'), { description: errorMessage(e) });
        }
        setUploading(false);
    };

    const handleRemove = async () => {
        if (!window.confirm(t('branding.removeConfirm'))) return;
        setRemoving(true);
        try {
            const headers: Record<string, string> = {};
            if (!isMock && accounts.length > 0) {
                headers.Authorization = `Bearer ${await getFreshIdToken(instance, accounts[0])}`;
            }
            const res = await fetch(`/api/admin/tenants/logo?tenantId=${encodeURIComponent(selectedTenant.id)}`, {
                method: 'DELETE',
                headers,
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t('branding.removeFailed'));
            setSelectedTenant({ ...selectedTenant, has_logo: false, logo_version: null });
            toast.success(t('branding.removedToast'));
        } catch (e) {
            toast.error(t('branding.removeErrorToast'), { description: errorMessage(e) });
        }
        setRemoving(false);
    };

    return (
        <div id="logo-upload" className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 scroll-mt-24">
            <div>
                <h4 className="font-semibold text-[#1B2A41] dark:text-white flex items-center gap-2">
                    {t('branding.title')}
                    <InfoTooltip content={t('tooltips.logo')} />
                </h4>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">{t('branding.description')}</p>
                {!canManage && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">{t('branding.adminOnly')}</p>
                )}
            </div>

            <div className="flex items-center gap-4 shrink-0">
                <div className="w-44 h-16 flex items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 overflow-hidden">
                    {selectedTenant.has_logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={`/api/tenant-logo/${selectedTenant.id}?v=${cacheBust}`}
                            alt={t('branding.currentLogoAlt')}
                            className="max-h-full max-w-full object-contain"
                        />
                    ) : (
                        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wide">{t('branding.noLogo')}</span>
                    )}
                </div>

                <div className="flex flex-col gap-2">
                    <label className={`${canManage ? BTN_PRIMARY : `${BTN_PRIMARY} opacity-50 cursor-not-allowed`} cursor-pointer`}>
                        <IconUpload size={16} stroke={1.5} />
                        {uploading ? t('branding.uploading') : t('branding.uploadLogo')}
                        <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={!canManage || uploading}
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleUpload(file);
                                e.target.value = '';
                            }}
                        />
                    </label>
                    {selectedTenant.has_logo && (
                        <button onClick={handleRemove} disabled={!canManage || removing} className={BTN_DANGER}>
                            <IconTrash size={16} stroke={1.5} />
                            {removing ? t('branding.removing') : t('branding.removeLogo')}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
