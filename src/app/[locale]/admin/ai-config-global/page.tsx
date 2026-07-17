"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { fetchWithAuthRetry } from "@/lib/msalToken";
import { Loader2, Sparkles, CheckCircle2, XCircle, KeyRound, Trash2, ShieldAlert } from "lucide-react";

const PROVIDERS = [
    { value: "google", label: "Google Gemini (Flash — gratis en free tier)" },
    { value: "openai", label: "OpenAI (GPT-4o)" },
    { value: "azure_openai", label: "Azure OpenAI (GPT-4o)" },
    { value: "anthropic", label: "Anthropic (Claude Sonnet 5)" },
    { value: "deepseek", label: "DeepSeek" },
];

type Sensitivity = "low" | "medium" | "high";

export default function AiConfigGlobalPage() {
    const { instance, accounts } = useMsal();
    const account = accounts[0];

    const [provider, setProvider] = useState("google");
    const [hasApiKey, setHasApiKey] = useState(false);
    const [apiKeyInput, setApiKeyInput] = useState("");
    const [aiEnabled, setAiEnabled] = useState(true);
    const [sensitivity, setSensitivity] = useState<Sensitivity>("medium");
    const [shareResourceNames, setShareResourceNames] = useState(true);
    const [shareTags, setShareTags] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [testing, setTesting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchWithAuthRetry(instance, account, "/api/admin/config/ai-global");
            const json = await res.json();
            if (!json.success) throw new Error(json.error || "Error al cargar la configuración.");
            setProvider(json.provider);
            setHasApiKey(json.hasApiKey);
            setAiEnabled(json.aiEnabled ?? true);
            setSensitivity((json.anomalySensitivity as Sensitivity) || "medium");
            setShareResourceNames(json.shareResourceNames ?? true);
            setShareTags(json.shareTags ?? true);
        } catch (e: any) {
            setError(e?.message || "Error de red.");
        } finally {
            setLoading(false);
        }
    }, [instance, account]);

    useEffect(() => { if (account) load(); }, [account, load]);

    const save = async () => {
        setSaving(true);
        setError(null);
        setTestResult(null);
        try {
            const res = await fetchWithAuthRetry(instance, account, "/api/admin/config/ai-global", {
                method: "PATCH",
                body: JSON.stringify({
                    provider,
                    apiKey: apiKeyInput || undefined,
                    aiEnabled,
                    anomalySensitivity: sensitivity,
                    shareResourceNames,
                    shareTags,
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || "No se pudo guardar.");
            setApiKeyInput("");
            await load();
        } catch (e: any) {
            setError(e?.message || "Error de red.");
        } finally {
            setSaving(false);
        }
    };

    const deleteApiKey = async () => {
        // Acción destructiva e irreversible (no queda backup de la key cifrada
        // borrada) que además afecta a CUALQUIER tenant sin su propia key BYOK
        // (queda sin fallback de IA hasta que se cargue una nueva) — se pide
        // confirmación explícita antes de mandar el DELETE.
        const confirmed = window.confirm(
            "¿Eliminar la API key global? Los tenants que no configuraron su propia key (BYOK) se quedarán sin IA hasta que cargues una nueva."
        );
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
            if (!json.success) throw new Error(json.error || "No se pudo eliminar la key.");
            setApiKeyInput("");
            await load();
        } catch (e: any) {
            setError(e?.message || "Error de red.");
        } finally {
            setDeleting(false);
        }
    };

    const testConnection = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const res = await fetchWithAuthRetry(instance, account, "/api/admin/config/ai-global/test", { method: "POST" });
            const json = await res.json();
            setTestResult(json.success
                ? { ok: true, message: `Conexión OK — el modelo respondió: "${json.reply}"` }
                : { ok: false, message: json.error || "Falló la prueba de conexión." });
        } catch (e: any) {
            setTestResult({ ok: false, message: e?.message || "Error de red." });
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="content animate-in fade-in max-w-2xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Sparkles className="w-6 h-6 text-brand-deep dark:text-brand-bright" /> IA — Configuración Global
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Proveedor/key de IA usado como fallback para cualquier tenant que no configuró su propia key en
                    Administración → Configuración de IA (BYOK per-tenant). Solo visible para Super Administradores.
                </p>
            </div>

            {loading ? (
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            ) : (
                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
                        <label className="flex items-center justify-between cursor-pointer">
                            <div>
                                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Habilitar funciones de IA (plataforma)</div>
                                <p className="text-xs text-slate-500 mt-1">
                                    Interruptor maestro: si se apaga, la IA queda inhabilitada para TODOS los tenants (Copilot y Reporte Ejecutivo con IA), sin importar su propio toggle per-tenant. Pensado para incidentes con el proveedor o costos fuera de control.
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
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Proveedor</label>
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
                                <KeyRound className="w-3.5 h-3.5" /> API Key
                            </label>
                            <input
                                type="password"
                                value={apiKeyInput}
                                onChange={(e) => setApiKeyInput(e.target.value)}
                                placeholder={hasApiKey ? "•••••••••••••••• (ya hay una key guardada — dejar vacío para no cambiarla)" : "Pegar API key..."}
                                className="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg px-3 py-2 text-sm font-mono"
                            />
                            <p className="text-xs text-slate-500 mt-1">
                                {hasApiKey ? "✓ Hay una key configurada (cifrada en la base)." : "⚠ No hay ninguna key configurada todavía."}
                                {provider === "google" && " Conseguí una gratis en "}
                                {provider === "google" && (
                                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-brand-deep dark:text-brand-bright underline">
                                        Google AI Studio
                                    </a>
                                )}
                                {provider === "google" && "."}
                            </p>
                        </div>

                        {error && (
                            <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300 text-sm px-3 py-2 rounded-lg">
                                {error}
                            </div>
                        )}

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
                                onClick={save}
                                disabled={saving}
                                className="px-4 py-2 bg-brand-deep hover:bg-brand-bright text-white text-sm font-bold rounded-lg disabled:opacity-50 flex items-center gap-2"
                            >
                                {saving && <Loader2 className="w-4 h-4 animate-spin" />} Guardar
                            </button>
                            <button
                                onClick={testConnection}
                                disabled={testing || !hasApiKey}
                                title={!hasApiKey ? "Guardá una key primero" : "Probar conexión real con el proveedor guardado"}
                                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-bold rounded-lg disabled:opacity-50 flex items-center gap-2"
                            >
                                {testing && <Loader2 className="w-4 h-4 animate-spin" />} Probar conexión
                            </button>
                            <button
                                onClick={deleteApiKey}
                                disabled={deleting || !hasApiKey}
                                title={!hasApiKey ? "No hay ninguna key guardada" : "Eliminar la API key guardada (afecta a tenants sin BYOK)"}
                                className="ml-auto px-4 py-2 bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-sm font-bold rounded-lg disabled:opacity-50 flex items-center gap-2"
                            >
                                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Eliminar API Key
                            </button>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                            Sensibilidad de detección de anomalías (default para tenants nuevos)
                        </label>
                        <select
                            value={sensitivity}
                            onChange={(e) => setSensitivity(e.target.value as Sensitivity)}
                            className="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg px-3 py-2 text-sm"
                        >
                            <option value="low">Baja — solo picos de gasto grandes (menos alertas)</option>
                            <option value="medium">Media — balance recomendado (default)</option>
                            <option value="high">Alta — detecta desvíos más chicos (más alertas)</option>
                        </select>
                        <p className="text-xs text-slate-500 mt-2">
                            Se asigna a cada tenant al darse de alta. Cada tenant puede después cambiarla en su propia Configuración de IA.
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
                        <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                            <ShieldAlert className="w-4 h-4 text-amber-500" />
                            Qué datos se comparten (default para tenants nuevos)
                        </div>
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={shareResourceNames}
                                onChange={(e) => setShareResourceNames(e.target.checked)}
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-deep focus:ring-brand-deep"
                            />
                            <div>
                                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">Nombres de recursos y grupos de recursos</div>
                                <p className="text-xs text-slate-500">Default al dar de alta un tenant nuevo. Cada tenant puede ajustarlo después.</p>
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
                                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">Etiquetas (tags) de recursos</div>
                                <p className="text-xs text-slate-500">Default al dar de alta un tenant nuevo. Cada tenant puede ajustarlo después.</p>
                            </div>
                        </label>
                    </div>
                </div>
            )}
        </div>
    );
}
