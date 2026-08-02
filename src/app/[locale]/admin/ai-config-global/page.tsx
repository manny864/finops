"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { fetchWithAuthRetry } from "@/lib/msalToken";
import { Loader2, Sparkles, CheckCircle2, XCircle, KeyRound, Trash2, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

type Sensitivity = "low" | "medium" | "high";

export default function AiConfigGlobalPage() {
    const t = useTranslations("AdminAiConfigGlobal");
    const { instance, accounts } = useMsal();
    const account = accounts[0];

    const PROVIDERS = [
        { value: "google", label: t("providers.google") || "Google Gemini" },
        { value: "openai", label: t("providers.openai") || "OpenAI" },
        { value: "chatgpt", label: "ChatGPT" },
        { value: "azure_openai", label: t("providers.azureOpenai") || "Azure OpenAI" },
        { value: "anthropic", label: t("providers.anthropic") || "Anthropic Claude" },
        { value: "deepseek", label: t("providers.deepseek") || "DeepSeek" },
        { value: "kimi", label: "Kimi (Moonshot)" },
        { value: "mistral", label: "Mistral AI" },
        { value: "cohere", label: "Cohere" },
    ];

    const [provider, setProvider] = useState("google");
    const [hasApiKey, setHasApiKey] = useState(false);
    const [apiKeyInput, setApiKeyInput] = useState("");
    
    const [enterpriseProvider, setEnterpriseProvider] = useState("azure_openai");
    const [hasEnterpriseApiKey, setHasEnterpriseApiKey] = useState(false);
    const [enterpriseApiKeyInput, setEnterpriseApiKeyInput] = useState("");
    const [aiEnabled, setAiEnabled] = useState(true);
    const [sensitivity, setSensitivity] = useState<Sensitivity>("medium");
    const [shareResourceNames, setShareResourceNames] = useState(true);
    const [shareTags, setShareTags] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [testing, setTesting] = useState(false);
    const [deletingEnterprise, setDeletingEnterprise] = useState(false);
    const [testingEnterprise, setTestingEnterprise] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
    const [testResultEnterprise, setTestResultEnterprise] = useState<{ ok: boolean; message: string } | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchWithAuthRetry(instance, account, "/api/admin/config/ai-global");
            const json = await res.json();
            if (!json.success) throw new Error(json.error || t("errors.loadFailed"));
            setProvider(json.provider);
            setHasApiKey(json.hasApiKey);
            setEnterpriseProvider(json.enterpriseProvider || "azure_openai");
            setHasEnterpriseApiKey(json.hasEnterpriseApiKey);
            setAiEnabled(json.aiEnabled ?? true);
            setSensitivity((json.anomalySensitivity as Sensitivity) || "medium");
            setShareResourceNames(json.shareResourceNames ?? true);
            setShareTags(json.shareTags ?? true);
        } catch (e: any) {
            setError(e?.message || t("errors.networkError"));
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [instance, account]);

    useEffect(() => { if (account) load(); }, [account, load]);

    const save = async () => {
        setSaving(true);
        setError(null);
        setTestResult(null);
        setTestResultEnterprise(null);
        try {
            const res = await fetchWithAuthRetry(instance, account, "/api/admin/config/ai-global", {
                method: "PATCH",
                body: JSON.stringify({
                    provider,
                    apiKey: apiKeyInput || undefined,
                    enterpriseProvider,
                    enterpriseApiKey: enterpriseApiKeyInput || undefined,
                    aiEnabled,
                    anomalySensitivity: sensitivity,
                    shareResourceNames,
                    shareTags,
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || t("errors.saveFailed"));
            setApiKeyInput("");
            setEnterpriseApiKeyInput("");
            await load();
        } catch (e: any) {
            setError(e?.message || t("errors.networkError"));
        } finally {
            setSaving(false);
        }
    };

    const deleteApiKey = async () => {
        // Acción destructiva e irreversible (no queda backup de la key cifrada
        // borrada) que además afecta a CUALQUIER tenant sin su propia key BYOK
        // (queda sin fallback de IA hasta que se cargue una nueva) — se pide
        // confirmación explícita antes de mandar el DELETE.
        const confirmed = window.confirm(t("confirmDeleteKey"));
        if (!confirmed) return;

        setDeleting(true);
        setError(null);
        setTestResult(null);
        try {
            const res = await fetchWithAuthRetry(instance, account, "/api/admin/config/ai-global", {
                method: "PATCH",
                body: JSON.stringify({ provider, apiKey: null }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || t("errors.deleteFailed"));
            setApiKeyInput("");
            await load();
        } catch (e: any) {
            setError(e?.message || t("errors.networkError"));
        } finally {
            setDeleting(false);
        }
    };

    const deleteEnterpriseApiKey = async () => {
        const confirmed = window.confirm(t("confirmDeleteKey"));
        if (!confirmed) return;

        setDeletingEnterprise(true);
        setError(null);
        setTestResultEnterprise(null);
        try {
            const res = await fetchWithAuthRetry(instance, account, "/api/admin/config/ai-global", {
                method: "PATCH",
                body: JSON.stringify({ provider, enterpriseApiKey: null }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || t("errors.deleteFailed"));
            setEnterpriseApiKeyInput("");
            await load();
        } catch (e: any) {
            setError(e?.message || t("errors.networkError"));
        } finally {
            setDeletingEnterprise(false);
        }
    };

    const testConnection = async (type: 'standard' | 'enterprise' = 'standard') => {
        if (type === 'enterprise') {
            setTestingEnterprise(true);
            setTestResultEnterprise(null);
        } else {
            setTesting(true);
            setTestResult(null);
        }
        try {
            const res = await fetchWithAuthRetry(instance, account, "/api/admin/config/ai-global/test", { 
                method: "POST",
                body: JSON.stringify({ testType: type })
            });
            const json = await res.json();
            const resultObj = json.success
                ? { ok: true, message: t("testResult.success", { reply: json.reply }) }
                : { ok: false, message: json.error || t("errors.testFailed") };
            
            if (type === 'enterprise') setTestResultEnterprise(resultObj);
            else setTestResult(resultObj);
        } catch (e: any) {
            if (type === 'enterprise') setTestResultEnterprise({ ok: false, message: e?.message || t("errors.networkError") });
            else setTestResult({ ok: false, message: e?.message || t("errors.networkError") });
        } finally {
            if (type === 'enterprise') setTestingEnterprise(false);
            else setTesting(false);
        }
    };


    return (
        <div className="content animate-in fade-in max-w-2xl space-y-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <Sparkles className="w-6 h-6 text-brand-deep dark:text-brand-bright" /> {t("title")}
                    </h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        {t("subtitle")}
                    </p>
                </div>

            {loading ? (
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            ) : (
                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
                        <label className="flex items-center justify-between cursor-pointer">
                            <div>
                                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("aiFeatures.toggleLabel")}</div>
                                <p className="text-xs text-slate-500 mt-1">
                                    {t("aiFeatures.toggleDescription")}
                                </p>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={aiEnabled}
                                onClick={() => setAiEnabled(!aiEnabled)}
                                className={`ml-4 shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    aiEnabled ? "bg-brand-deep" : "bg-slate-300 dark:bg-slate-700"
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        aiEnabled ? "translate-x-6" : "translate-x-1"
                                    }`}
                                />
                            </button>
                        </label>
                    </div>

                    <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4 ${!aiEnabled ? "opacity-50" : ""}`}>
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{t("provider.label")}</label>
                            <select
                                value={provider}
                                onChange={(e) => setProvider(e.target.value)}
                                className="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg px-3 py-2 text-sm"
                            >
                                {PROVIDERS.map((p) => (
                                    <option key={p.value} value={p.value}>{p.label}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1.5">
                                <KeyRound className="w-3.5 h-3.5" /> {t("apiKey.label")}
                            </label>
                            <input
                                type="password"
                                value={apiKeyInput}
                                onChange={(e) => setApiKeyInput(e.target.value)}
                                placeholder={hasApiKey ? t("apiKey.placeholderSaved") : t("apiKey.placeholderEmpty")}
                                className="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg px-3 py-2 text-sm font-mono"
                            />
                            <p className="text-xs text-slate-500 mt-1">
                                {hasApiKey ? t("apiKey.configuredNotice") : t("apiKey.missingNotice")}
                                {provider === "google" && " " + t("apiKey.getFreeKeyPrefix") + " "}
                                {provider === "google" && (
                                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-brand-deep dark:text-brand-bright underline">
                                        Google AI Studio
                                    </a>
                                )}
                                {provider === "google" && "."}
                            </p>
                        </div>



                        {testResult && (
                            <div className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg border ${testResult.ok
                                ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300"
                                : "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300"}`}>
                                {testResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                                <span>{testResult.message}</span>
                            </div>
                        )}

                        <div className="flex items-center gap-2 pt-1">
                            <button
                                onClick={() => testConnection('standard')}
                                disabled={testing || !hasApiKey}
                                title={!hasApiKey ? t("apiKey.saveKeyFirst") : t("apiKey.testConnectionTitle")}
                                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-bold rounded-lg disabled:opacity-50 flex items-center gap-2"
                            >
                                {testing && <Loader2 className="w-4 h-4 animate-spin" />} {t("testConnection")}
                            </button>
                            <button
                                onClick={deleteApiKey}
                                disabled={deleting || !hasApiKey}
                                title={!hasApiKey ? t("apiKey.noKeySaved") : t("apiKey.deleteKeyTitle")}
                                className="ml-auto px-4 py-2 bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-sm font-bold rounded-lg disabled:opacity-50 flex items-center gap-2"
                            >
                                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {t("apiKey.deleteApiKey")}
                            </button>
                        </div>
                    </div>

                    <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4 ${!aiEnabled ? "opacity-50" : ""}`}>
                        <div className="border-b border-slate-200 dark:border-slate-800 pb-4 mb-4">
                            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-brand-deep" />
                                Proveedor IA - Planes Enterprise
                            </h3>
                            <p className="text-xs text-slate-500 mt-1">Configura el proveedor exclusivo para clientes del plan Enterprise.</p>
                        </div>
                        
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{t("provider.label")}</label>
                            <select
                                value={enterpriseProvider}
                                onChange={(e) => setEnterpriseProvider(e.target.value)}
                                className="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg px-3 py-2 text-sm"
                            >
                                {PROVIDERS.map((p) => (
                                    <option key={p.value} value={p.value}>{p.label}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1.5">
                                <KeyRound className="w-3.5 h-3.5" /> {t("apiKey.label")}
                            </label>
                            <input
                                type="password"
                                value={enterpriseApiKeyInput}
                                onChange={(e) => setEnterpriseApiKeyInput(e.target.value)}
                                placeholder={hasEnterpriseApiKey ? t("apiKey.placeholderSaved") : t("apiKey.placeholderEmpty")}
                                className="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg px-3 py-2 text-sm font-mono"
                            />
                            <p className="text-xs text-slate-500 mt-1">
                                {hasEnterpriseApiKey ? t("apiKey.configuredNotice") : t("apiKey.missingNotice")}
                            </p>
                        </div>
                        
                        {testResultEnterprise && (
                            <div className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg border ${testResultEnterprise.ok
                                ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300"
                                : "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300"}`}>
                                {testResultEnterprise.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                                <span>{testResultEnterprise.message}</span>
                            </div>
                        )}

                        <div className="flex items-center gap-2 pt-1">
                            <button
                                onClick={() => testConnection('enterprise')}
                                disabled={testingEnterprise || !hasEnterpriseApiKey}
                                title={!hasEnterpriseApiKey ? t("apiKey.saveKeyFirst") : t("apiKey.testConnectionTitle")}
                                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-bold rounded-lg disabled:opacity-50 flex items-center gap-2"
                            >
                                {testingEnterprise && <Loader2 className="w-4 h-4 animate-spin" />} {t("testConnection")}
                            </button>
                            <button
                                onClick={deleteEnterpriseApiKey}
                                disabled={deletingEnterprise || !hasEnterpriseApiKey}
                                title={!hasEnterpriseApiKey ? t("apiKey.noKeySaved") : t("apiKey.deleteKeyTitle")}
                                className="ml-auto px-4 py-2 bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-sm font-bold rounded-lg disabled:opacity-50 flex items-center gap-2"
                            >
                                {deletingEnterprise ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {t("apiKey.deleteApiKey")}
                            </button>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                            {t("sensitivity.label")}
                        </label>
                        <select
                            value={sensitivity}
                            onChange={(e) => setSensitivity(e.target.value as Sensitivity)}
                            className="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg px-3 py-2 text-sm"
                        >
                            <option value="low">{t("sensitivity.options.low")}</option>
                            <option value="medium">{t("sensitivity.options.medium")}</option>
                            <option value="high">{t("sensitivity.options.high")}</option>
                        </select>
                        <p className="text-xs text-slate-500 mt-2">
                            {t("sensitivity.description")}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
                        <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                            <ShieldAlert className="w-4 h-4 text-amber-500" />
                            {t("dataSharing.heading")}
                        </div>
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={shareResourceNames}
                                onChange={(e) => setShareResourceNames(e.target.checked)}
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-deep focus:ring-brand-deep"
                            />
                            <div>
                                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("dataSharing.resourceNames.label")}</div>
                                <p className="text-xs text-slate-500">{t("dataSharing.resourceNames.description")}</p>
                            </div>
                        </label>
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={shareTags}
                                onChange={(e) => setShareTags(e.target.checked)}
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-deep focus:ring-brand-deep"
                            />
                            <div>
                                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("dataSharing.tags.label")}</div>
                                <p className="text-xs text-slate-500">{t("dataSharing.tags.description")}</p>
                            </div>
                        </label>
                    </div>
                    <div className="pt-4 flex flex-col items-end gap-4">
                        {error && (
                            <div className="w-full bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300 text-sm px-4 py-3 rounded-xl flex items-start gap-2">
                                <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                                <div>
                                    <strong className="block font-semibold mb-1">Error al guardar</strong>
                                    {error}
                                </div>
                            </div>
                        )}
                        <button
                            onClick={save}
                            disabled={saving}
                            className="px-6 py-3 bg-brand-deep hover:bg-brand-bright text-white text-sm font-bold rounded-xl disabled:opacity-50 flex items-center gap-2 shadow-sm"
                        >
                            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                            {t("save")}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
