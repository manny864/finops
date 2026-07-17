"use client";
import React, { useEffect, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Cpu, Save, Lock, ShieldAlert, Loader2, CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getFreshIdToken } from '@/lib/msalToken';

type Sensitivity = 'low' | 'medium' | 'high';

export default function AiConfigPage() {
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
            toast.error("Selecciona un tenant válido primero.");
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
                toast.success("Configuración de IA actualizada exitosamente.");
                if (provider === 'system') {
                    setHasApiKey(false);
                } else if (apiKeyDirty) {
                    setHasApiKey(Boolean(apiKey));
                }
                setApiKeyDirty(false);
                setApiKey('');
            } else {
                const data = await res.json();
                toast.error(data.error || "Error al guardar la configuración.");
            }
        } catch (e) {
            console.error("Error saving AI config:", e);
            toast.error("Error al conectar con el servidor.");
        }
        setSaving(false);
    };

    const deleteApiKey = async () => {
        if (!selectedTenant || selectedTenant.id === 'default') return;

        const confirmed = window.confirm(
            "¿Eliminar la API key de este tenant? Se volverá a usar el proveedor Sistema (compartido, con límites de cuota) hasta que cargues una nueva."
        );
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
                toast.success("API key eliminada.");
                setProvider('system');
                setHasApiKey(false);
                setApiKey('');
                setApiKeyDirty(false);
            } else {
                const data = await res.json();
                toast.error(data.error || "No se pudo eliminar la key.");
            }
        } catch (e) {
            console.error("Error deleting AI key:", e);
            toast.error("Error al conectar con el servidor.");
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
                ? { ok: true, message: `Conexión OK — el modelo respondió: "${json.reply}"` }
                : { ok: false, message: json.error || "Falló la prueba de conexión." });
        } catch (e: any) {
            setTestResult({ ok: false, message: e?.message || "Error de red." });
        }
        setTesting(false);
    };

    if (userRole !== 'Admin' && systemRole !== 'SUPERADMIN') {
        return (
            <div className="flex flex-col items-center justify-center h-96">
                <Lock className="w-12 h-12 text-gray-400 mb-4" />
                <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300">Acceso Denegado</h2>
                <p className="text-sm text-gray-500 mt-2">Solo los administradores pueden configurar la IA.</p>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-4xl mx-auto animate-in fade-in duration-500">
            <div className="mb-8 border-b border-gray-200 dark:border-gray-800 pb-4">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                    <Cpu className="w-8 h-8 mr-3 text-[#0054A6] dark:text-[#00AEEF]" />
                    Configuración de Inteligencia Artificial
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">
                    Habilitá o deshabilitá las funciones de IA, elegí el modelo, ajustá la sensibilidad de detección de anomalías y qué datos se comparten con el proveedor.
                </p>
            </div>

            {loading ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Cargando configuración...</div>
            ) : (
                <div className="space-y-8">
                    {/* Habilitar/deshabilitar funciones de IA */}
                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
                            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Funciones de IA</h3>
                        </div>
                        <div className="p-6">
                            <label className="flex items-center justify-between max-w-md cursor-pointer">
                                <div>
                                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Habilitar funciones de IA</div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Apaga el Copilot FinOps y el Reporte Ejecutivo con IA para este tenant. El resto de la plataforma sigue funcionando con normalidad.
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
                            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Proveedor de IA (BYOK)</h3>
                        </div>
                        <div className="p-6">
                            <div className="flex flex-col mb-6">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Selecciona el motor de LLM</label>
                                <select
                                    value={provider}
                                    onChange={(e) => setProvider(e.target.value)}
                                    className="w-full max-w-md px-3 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-md focus:ring-[#0054A6] focus:border-[#0054A6] sm:text-sm"
                                >
                                    <option value="system">Sistema (Compartido - Con límites de cuota)</option>
                                    <option value="openai">OpenAI (Trae tu propia API Key)</option>
                                    <option value="azure_openai">Azure OpenAI (Privado y Seguro)</option>
                                    <option value="anthropic">Anthropic (Claude Sonnet 5)</option>
                                    <option value="google">Google (Gemini Flash · última versión gratis)</option>
                                    <option value="deepseek">DeepSeek (DeepSeek Chat)</option>
                                </select>
                                <p className="text-xs text-gray-500 mt-2">
                                    Recomendamos usar tu propia llave para garantizar que tus datos no sean utilizados para entrenamiento de modelos públicos y para obtener respuestas más rápidas sin throttling.
                                </p>
                            </div>

                            {provider !== 'system' && (
                                <div className="flex flex-col mb-2">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">API Key</label>
                                    <input
                                        type="password"
                                        value={apiKey}
                                        onChange={(e) => { setApiKey(e.target.value); setApiKeyDirty(true); }}
                                        placeholder={hasApiKey ? "•••••••••••••••• (ya guardada, dejá vacío para conservarla)" : "sk-..."}
                                        className="w-full max-w-md px-4 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-md focus:ring-[#0054A6] focus:border-[#0054A6] sm:text-sm"
                                    />
                                    {hasApiKey && !apiKeyDirty && (
                                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">Ya hay una API key guardada para este proveedor.</p>
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
                                    title={provider !== 'system' && !hasApiKey ? "Guardá una key primero" : "Probar conexión real con el proveedor guardado"}
                                    className="px-4 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-md disabled:opacity-50 flex items-center gap-2"
                                >
                                    {testing && <Loader2 className="w-4 h-4 animate-spin" />} Probar conexión
                                </button>
                                <button
                                    onClick={deleteApiKey}
                                    disabled={deleting || !hasApiKey}
                                    title={!hasApiKey ? "No hay ninguna key guardada" : "Eliminar la API key de este tenant"}
                                    className="px-4 py-2 bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-sm font-semibold rounded-md disabled:opacity-50 flex items-center gap-2"
                                >
                                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Eliminar API Key
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Sensibilidad de detección de anomalías */}
                    <div className={`bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden ${!aiEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
                            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Sensibilidad de Detección de Anomalías</h3>
                        </div>
                        <div className="p-6">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Nivel de sensibilidad
                            </label>
                            <select
                                value={sensitivity}
                                onChange={(e) => setSensitivity(e.target.value as Sensitivity)}
                                className="w-full max-w-md px-3 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-md focus:ring-[#0054A6] focus:border-[#0054A6] sm:text-sm"
                            >
                                <option value="low">Baja — solo picos de gasto grandes (menos alertas)</option>
                                <option value="medium">Media — balance recomendado (default)</option>
                                <option value="high">Alta — detecta desvíos más chicos (más alertas)</option>
                            </select>
                            <p className="text-xs text-gray-500 mt-2">
                                Afecta la detección automática de anomalías de gasto (Análisis de Anomalías) para este tenant.
                            </p>
                        </div>
                    </div>

                    {/* Qué datos se comparten */}
                    <div className={`bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden ${!aiEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
                            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center">
                                <ShieldAlert className="w-5 h-5 mr-2 text-amber-500" />
                                Qué Datos se Comparten
                            </h3>
                        </div>
                        <div className="p-6 space-y-4">
                            <p className="text-xs text-gray-500 mb-2">
                                Al generar el Reporte Ejecutivo con IA, estos campos se envían al proveedor de IA que hayas elegido arriba. Desactivalos si preferís que no viajen fuera de la plataforma.
                            </p>
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={shareResourceNames}
                                    onChange={(e) => setShareResourceNames(e.target.checked)}
                                    className="mt-1 h-4 w-4 rounded border-gray-300 text-[#0054A6] focus:ring-[#0054A6]"
                                />
                                <div>
                                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Nombres de recursos y grupos de recursos</div>
                                    <p className="text-xs text-gray-500">Si se desactiva, esos campos se reemplazan por "[REDACTED]" antes de enviarse.</p>
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
                                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Etiquetas (tags) de recursos</div>
                                    <p className="text-xs text-gray-500">Si se desactiva, se envía solo la cantidad de etiquetas, no su contenido.</p>
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
                            {saving ? 'Guardando...' : 'Guardar Configuración'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
