"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from "@/lib/apiErrors";
import InfoTooltip from "@/components/InfoTooltip";
import {
    PlatformGlobalAiSettings,
    SavePlatformAiPayload,
    AnomalySensitivityLevel,
} from "@/types/superAdminAiConfig.types";
import {
    IconSparkles,
    IconRobot,
    IconCrown,
    IconKey,
    IconDeviceFloppy,
    IconTrash,
    IconShieldCheck,
    IconCircleCheck,
    IconAlertCircle,
    IconLoader2,
    IconCheck,
    IconX,
    IconInfoCircle,
} from "@tabler/icons-react";

export default function GlobalAiConfigurationPanel() {
    const t = useTranslations("AdminAiConfigGlobal");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "default";
    const isMock = isMockTenant(tenantId);

    // Estado de Configuración
    const [isPlatformMasterAiEnabled, setIsPlatformMasterAiEnabled] = useState(true);

    // No-Enterprise Config
    const [nonEntProvider, setNonEntProvider] = useState("anthropic");
    const [nonEntHasApiKey, setNonEntHasApiKey] = useState(false);
    const [nonEntApiKeyInput, setNonEntApiKeyInput] = useState("");
    const [nonEntEndpoint, setNonEntEndpoint] = useState("");
    const [nonEntDeployment, setNonEntDeployment] = useState("claude-3-5-sonnet");

    // Enterprise Config
    const [entProvider, setEntProvider] = useState("azure_openai");
    const [entHasApiKey, setEntHasApiKey] = useState(false);
    const [entApiKeyInput, setEntApiKeyInput] = useState("");
    const [entEndpoint, setEntEndpoint] = useState("");
    const [entDeployment, setEntDeployment] = useState("gpt-5.1");
    const [entResourceName, setEntResourceName] = useState("");

    // Sensibilidad y Privacidad
    const [sensitivity, setSensitivity] = useState<AnomalySensitivityLevel>("MEDIUM");
    const [shareResourceNames, setShareResourceNames] = useState(true);
    const [shareTags, setShareTags] = useState(true);

    // Estados de UI
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testingNonEnt, setTestingNonEnt] = useState(false);
    const [testingEnt, setTestingEnt] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Modal de Prueba de Conexión
    const [testModalResult, setTestModalResult] = useState<{ ok: boolean; message: string; target: string } | null>(null);

    // Modal de Confirmación de Eliminación
    const [deleteKeyTarget, setDeleteKeyTarget] = useState<"non_enterprise" | "enterprise" | null>(null);
    const [deletingKey, setDeletingKey] = useState(false);

    const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (isMock || !accounts || accounts.length === 0) return {};
        try {
            const token = await getFreshIdToken(instance, accounts[0]);
            return token ? { Authorization: `Bearer ${token}` } : {};
        } catch {
            return {};
        }
    }, [instance, accounts, isMock]);

    // Cargar configuración global
    const loadSettings = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const url = isMock
                ? "/api/superadmin/ai-global-config?mock=true"
                : "/api/superadmin/ai-global-config";

            const res = await fetch(url, { headers });
            const json = await res.json();

            if (!json.success && !json.isPlatformMasterAiEnabled) {
                throw new Error(json.error || "Error al cargar la configuración de IA");
            }

            const data: PlatformGlobalAiSettings = json.settings || json;

            setIsPlatformMasterAiEnabled(data.isPlatformMasterAiEnabled ?? true);

            if (data.nonEnterpriseConfig) {
                setNonEntProvider(data.nonEnterpriseConfig.provider || "anthropic");
                setNonEntHasApiKey(data.nonEnterpriseConfig.hasStoredApiKey ?? false);
                setNonEntEndpoint(data.nonEnterpriseConfig.azureEndpointUrl || "");
                setNonEntDeployment(data.nonEnterpriseConfig.deploymentModelName || "claude-3-5-sonnet");
            }

            if (data.enterpriseConfig) {
                setEntProvider(data.enterpriseConfig.provider || "azure_openai");
                setEntHasApiKey(data.enterpriseConfig.hasStoredApiKey ?? false);
                setEntEndpoint(data.enterpriseConfig.azureEndpointUrl || "");
                setEntDeployment(data.enterpriseConfig.deploymentModelName || "gpt-5.1");
                setEntResourceName(data.enterpriseConfig.resourceName || "");
            }

            setSensitivity(data.defaultAnomalySensitivity || "MEDIUM");
            setShareResourceNames(data.defaultShareResourceNames ?? true);
            setShareTags(data.defaultShareTags ?? true);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [isMock, getAuthHeaders]);

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    // Guardar Configuración Global
    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        setSuccessMessage(null);

        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const url = isMock
                ? "/api/superadmin/ai-global-config?mock=true"
                : "/api/superadmin/ai-global-config";

            const payload: SavePlatformAiPayload = {
                isPlatformMasterAiEnabled,
                nonEnterpriseConfig: {
                    provider: nonEntProvider,
                    apiKey: nonEntApiKeyInput || undefined,
                    azureEndpointUrl: nonEntEndpoint,
                    deploymentModelName: nonEntDeployment,
                },
                enterpriseConfig: {
                    provider: entProvider,
                    apiKey: entApiKeyInput || undefined,
                    azureEndpointUrl: entEndpoint,
                    deploymentModelName: entDeployment,
                    resourceName: entResourceName,
                },
                defaultAnomalySensitivity: sensitivity,
                defaultShareResourceNames: shareResourceNames,
                defaultShareTags: shareTags,
            };

            const res = await fetch(url, {
                method: "PATCH",
                headers,
                body: JSON.stringify(payload),
            });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || "No se pudo guardar la configuración.");
            }

            setSuccessMessage("Configuración Global de IA guardada exitosamente.");
            setNonEntApiKeyInput("");
            setEntApiKeyInput("");
            await loadSettings();
            setTimeout(() => setSuccessMessage(null), 4000);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setSaving(false);
        }
    };

    // Probar Conexión
    const handleTestConnection = async (type: "non_enterprise" | "enterprise") => {
        if (type === "non_enterprise") setTestingNonEnt(true);
        else setTestingEnt(true);

        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const url = isMock
                ? "/api/superadmin/ai-global-config/test?mock=true"
                : "/api/superadmin/ai-global-config/test";

            const payload =
                type === "enterprise"
                    ? {
                          testType: "enterprise" as const,
                          provider: entProvider,
                          apiKey: entApiKeyInput || undefined,
                          azureEndpointUrl: entEndpoint,
                          deploymentModelName: entDeployment,
                          resourceName: entResourceName,
                      }
                    : {
                          testType: "non_enterprise" as const,
                          provider: nonEntProvider,
                          apiKey: nonEntApiKeyInput || undefined,
                          azureEndpointUrl: nonEntEndpoint,
                          deploymentModelName: nonEntDeployment,
                      };

            const res = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
            });
            const json = await res.json();

            if (json.success) {
                setTestModalResult({
                    ok: true,
                    message: json.reply || "Conexión exitosa con el modelo.",
                    target: type === "enterprise" ? "Enterprise" : "No-Enterprise (Pro/Business)",
                });
            } else {
                setTestModalResult({
                    ok: false,
                    message: json.error || "Falló la prueba de conexión.",
                    target: type === "enterprise" ? "Enterprise" : "No-Enterprise (Pro/Business)",
                });
            }
        } catch (e: any) {
            setTestModalResult({
                ok: false,
                message: errorMessage(e),
                target: type === "enterprise" ? "Enterprise" : "No-Enterprise (Pro/Business)",
            });
        } finally {
            if (type === "non_enterprise") setTestingNonEnt(false);
            else setTestingEnt(false);
        }
    };

    // Eliminar API Key
    const handleConfirmDeleteKey = async () => {
        if (!deleteKeyTarget) return;
        setDeletingKey(true);
        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const url = isMock
                ? "/api/superadmin/ai-global-config/delete-key?mock=true"
                : "/api/superadmin/ai-global-config/delete-key";

            const res = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify({ target: deleteKeyTarget }),
            });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || "No se pudo eliminar la clave.");
            }

            if (deleteKeyTarget === "enterprise") {
                setEntHasApiKey(false);
                setEntApiKeyInput("");
            } else {
                setNonEntHasApiKey(false);
                setNonEntApiKeyInput("");
            }

            setDeleteKeyTarget(null);
            setSuccessMessage("API Key eliminada correctamente.");
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setDeletingKey(false);
        }
    };

    return (
        <div className="w-full max-w-full space-y-6 animate-in fade-in duration-200">
            {/* Header Principal */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center font-['Montserrat',sans-serif]">
                        <IconSparkles size={26} stroke={1.5} className="text-[#0078D4] inline mr-2.5" />
                        {t("title") || "IA — Configuración Global"}
                        <InfoTooltip
                            content={
                                t("tooltipTitle") ||
                                "Gobernanza global y enrutamiento LLM multi-tier para Copilot FinOps y Reportes Ejecutivos IA."
                            }
                        />
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-4xl leading-relaxed">
                        {t("subtitle") ||
                            "Proveedor/key de IA usado como fallback para cualquier tenant que no configuró su propia key en Administración → Configuración de IA (BYOK per-tenant). Solo visible para Super Administradores."}
                    </p>
                </div>

                {isMock && (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-400">
                        <IconSparkles size={14} />
                        <span>Modo Demostración</span>
                    </div>
                )}
            </div>

            {/* Banners de Notificación */}
            {error && (
                <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                    <IconX size={16} />
                    <span>{error}</span>
                </div>
            )}
            {successMessage && (
                <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                    <IconCheck size={16} />
                    <span>{successMessage}</span>
                </div>
            )}

            {loading ? (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-12 rounded-2xl text-center text-slate-500">
                    <div className="inline-flex items-center gap-2 text-xs">
                        <IconLoader2 size={18} className="animate-spin text-[#0078D4]" />
                        <span>Cargando configuración de IA global...</span>
                    </div>
                </div>
            ) : (
                <form onSubmit={handleSave} className="space-y-6">
                    {/* ─── BLOQUE 1: Interruptor Maestro (Ancho 100%) ─────────────────── */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                            <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif] flex items-center gap-2">
                                <IconSparkles size={18} stroke={1.5} className="text-[#0078D4]" />
                                <span>{t("aiFeatures.toggleLabel") || "Habilitar funciones de IA (plataforma)"}</span>
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-3xl leading-relaxed">
                                {t("aiFeatures.toggleDescription") ||
                                    "Interruptor maestro: si se apaga, la IA queda inhabilitada para TODOS los tenants (Copilot y Reporte Ejecutivo con IA), sin importar su propio toggle per-tenant. Pensado para incidentes con el proveedor o costos fuera de control."}
                            </p>
                        </div>

                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                            <input
                                type="checkbox"
                                checked={isPlatformMasterAiEnabled}
                                onChange={(e) => setIsPlatformMasterAiEnabled(e.target.checked)}
                                className="sr-only peer"
                            />
                            <div className="w-12 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#0078D4]"></div>
                        </label>
                    </div>

                    {/* ─── BLOQUE 2: Proveedor Planes No Enterprise (Ancho 100%) ──────── */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                            <div className="space-y-0.5">
                                <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif] flex items-center gap-2">
                                    <IconRobot size={20} className="text-[#0078D4]" />
                                    <span>{t("standard.sectionTitle") || "Proveedor IA - Planes no Enterprise (Professional y Business)"}</span>
                                </h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    {t("standard.sectionDescription") ||
                                        "Configura el proveedor de fallback para clientes Professional y Business. Si elegís Azure IA, necesitás API Key, Endpoint URL y Deployment (modelo)."}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Dropdown Proveedor */}
                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    {t("provider.label") || "Proveedor"}
                                </label>
                                <select
                                    value={nonEntProvider}
                                    onChange={(e) => setNonEntProvider(e.target.value)}
                                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                >
                                    <option value="anthropic">Anthropic (Claude Sonnet 3.5)</option>
                                    <option value="azure_openai">Azure IA (Privado y Seguro)</option>
                                    <option value="openai">OpenAI Direct</option>
                                    <option value="google">Google Gemini</option>
                                    <option value="deepseek">DeepSeek</option>
                                </select>
                            </div>

                            {/* Input API Key */}
                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                                    <span>{t("apiKey.label") || "API Key"}</span>
                                    {nonEntHasApiKey && (
                                        <span className="text-[11px] font-normal text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                            <IconCircleCheck size={13} />
                                            <span>Hay una key configurada (cifrada)</span>
                                        </span>
                                    )}
                                </label>
                                <div className="relative">
                                    <input
                                        type="password"
                                        value={nonEntApiKeyInput}
                                        onChange={(e) => setNonEntApiKeyInput(e.target.value)}
                                        placeholder={
                                            nonEntHasApiKey
                                                ? "•••••••••••••••• (ya hay una key guardada — dejar vacío para no cambiar)"
                                                : "Pegar API key..."
                                        }
                                        className="w-full pl-8 pr-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                    />
                                    <IconKey size={15} className="absolute left-2.5 top-2.5 text-slate-400" />
                                </div>
                            </div>
                        </div>

                        {/* Grid Endpoint y Deployment */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    Azure OpenAI Endpoint URL (opcional)
                                </label>
                                <input
                                    type="text"
                                    value={nonEntEndpoint}
                                    onChange={(e) => setNonEntEndpoint(e.target.value)}
                                    placeholder="https://mchavez-8282-resource.services.ai.azure.com/..."
                                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    Deployment (modelo)
                                </label>
                                <input
                                    type="text"
                                    value={nonEntDeployment}
                                    onChange={(e) => setNonEntDeployment(e.target.value)}
                                    placeholder="claude-3-5-sonnet o gpt-4o"
                                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                />
                            </div>
                        </div>

                        {/* Botones de acción No-Enterprise */}
                        <div className="flex items-center gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => handleTestConnection("non_enterprise")}
                                disabled={testingNonEnt}
                                className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                            >
                                {testingNonEnt ? <IconLoader2 size={14} className="animate-spin text-white" /> : <IconSparkles size={14} className="text-white" />}
                                <span>{testingNonEnt ? "Probando..." : t("testConnection") || "Probar conexión"}</span>
                            </button>

                            {nonEntHasApiKey && (
                                <button
                                    type="button"
                                    onClick={() => setDeleteKeyTarget("non_enterprise")}
                                    className="inline-flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
                                >
                                    <IconTrash size={14} />
                                    <span>{t("apiKey.deleteApiKey") || "Eliminar API Key"}</span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* ─── BLOQUE 3: Proveedor Planes Enterprise (Ancho 100%) ─────────── */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                            <div className="space-y-0.5">
                                <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif] flex items-center gap-2">
                                    <IconCrown size={20} className="text-[#0078D4]" />
                                    <span>{t("enterprise.sectionTitle") || "Proveedor IA - Planes Enterprise"}</span>
                                </h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    {t("enterprise.sectionDescription") ||
                                        "Configura el proveedor exclusivo y de alta velocidad para clientes del plan Enterprise."}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Dropdown Proveedor */}
                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    {t("provider.label") || "Proveedor"}
                                </label>
                                <select
                                    value={entProvider}
                                    onChange={(e) => setEntProvider(e.target.value)}
                                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                >
                                    <option value="azure_openai">Azure IA (Tier Enterprise Dedicado)</option>
                                    <option value="openai">OpenAI Direct API</option>
                                    <option value="anthropic">Anthropic Claude</option>
                                    <option value="google">Google Gemini</option>
                                </select>
                            </div>

                            {/* Input API Key */}
                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                                    <span>{t("apiKey.label") || "API Key"}</span>
                                    {entHasApiKey && (
                                        <span className="text-[11px] font-normal text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                            <IconCircleCheck size={13} />
                                            <span>Hay una key configurada (cifrada)</span>
                                        </span>
                                    )}
                                </label>
                                <div className="relative">
                                    <input
                                        type="password"
                                        value={entApiKeyInput}
                                        onChange={(e) => setEntApiKeyInput(e.target.value)}
                                        placeholder={
                                            entHasApiKey
                                                ? "•••••••••••••••• (ya hay una key guardada — dejar vacío para no cambiar)"
                                                : "Pegar API key..."
                                        }
                                        className="w-full pl-8 pr-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                    />
                                    <IconKey size={15} className="absolute left-2.5 top-2.5 text-slate-400" />
                                </div>
                            </div>
                        </div>

                        {/* Grid Endpoint y Deployment Enterprise */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    {t("enterprise.endpointLabel") || "Azure OpenAI Endpoint URL"}
                                </label>
                                <input
                                    type="text"
                                    value={entEndpoint}
                                    onChange={(e) => setEntEndpoint(e.target.value)}
                                    placeholder="https://mchavez-8282-resource.services.ai.azure.com/openai/v1/responses"
                                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    {t("enterprise.deploymentLabel") || "Deployment (modelo)"}
                                </label>
                                <input
                                    type="text"
                                    value={entDeployment}
                                    onChange={(e) => setEntDeployment(e.target.value)}
                                    placeholder="gpt-5.1 o gpt-4o"
                                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                />
                            </div>
                        </div>

                        {/* Botones de acción Enterprise */}
                        <div className="flex items-center gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => handleTestConnection("enterprise")}
                                disabled={testingEnt}
                                className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                            >
                                {testingEnt ? <IconLoader2 size={14} className="animate-spin text-white" /> : <IconSparkles size={14} className="text-white" />}
                                <span>{testingEnt ? "Probando..." : t("testConnection") || "Probar conexión"}</span>
                            </button>

                            {entHasApiKey && (
                                <button
                                    type="button"
                                    onClick={() => setDeleteKeyTarget("enterprise")}
                                    className="inline-flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
                                >
                                    <IconTrash size={14} />
                                    <span>{t("apiKey.deleteApiKey") || "Eliminar API Key"}</span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* ─── BLOQUE 4: Sensibilidad de Detección de Anomalías (Ancho 100%) ─ */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-3">
                        <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                            {t("sensitivity.label") || "Sensibilidad de detección de anomalías (default para tenants nuevos)"}
                        </h2>
                        <select
                            value={sensitivity}
                            onChange={(e) => setSensitivity(e.target.value as AnomalySensitivityLevel)}
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                        >
                            <option value="MEDIUM">{t("sensitivity.options.medium") || "Media — balance recomendado (default)"}</option>
                            <option value="LOW">{t("sensitivity.options.low") || "Baja — solo picos de gasto grandes (> 50%)"}</option>
                            <option value="HIGH">{t("sensitivity.options.high") || "Alta — detecta desvíos más chicos (> 15%)"}</option>
                            <option value="STRICT">{t("sensitivity.options.strict") || "Crítica / Estricta — máxima sensibilidad (> 10%)"}</option>
                        </select>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            {t("sensitivity.description") ||
                                "Se asigna a cada tenant al darse de alta. Cada tenant puede después cambiarla en su propia Configuración de IA."}
                        </p>
                    </div>

                    {/* ─── BLOQUE 5: Qué datos se comparten (Ancho 100%) ──────────────── */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
                        <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif] flex items-center gap-2">
                            <IconShieldCheck size={20} className="text-[#0078D4]" />
                            <span>{t("dataSharing.heading") || "Qué datos se comparten (default para tenants nuevos)"}</span>
                        </h2>

                        <div className="space-y-3">
                            <label className="flex items-start gap-3 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={shareResourceNames}
                                    onChange={(e) => setShareResourceNames(e.target.checked)}
                                    className="mt-0.5 rounded border-slate-300 text-[#0078D4] focus:ring-[#0078D4]"
                                />
                                <div>
                                    <span className="font-semibold">{t("dataSharing.resourceNames.label") || "Nombres de recursos y grupos de recursos"}</span>
                                    <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                                        {t("dataSharing.resourceNames.description") || "Default al dar de alta un tenant nuevo. Cada tenant puede ajustarlo después."}
                                    </p>
                                </div>
                            </label>

                            <label className="flex items-start gap-3 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={shareTags}
                                    onChange={(e) => setShareTags(e.target.checked)}
                                    className="mt-0.5 rounded border-slate-300 text-[#0078D4] focus:ring-[#0078D4]"
                                />
                                <div>
                                    <span className="font-semibold">{t("dataSharing.tags.label") || "Etiquetas (tags) de recursos"}</span>
                                    <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                                        {t("dataSharing.tags.description") || "Default al dar de alta un tenant nuevo. Cada tenant puede ajustarlo después."}
                                    </p>
                                </div>
                            </label>
                        </div>
                    </div>

                    {/* ─── BARRA INFERIOR DE GUARDADO (Ancho 100%) ───────────────────── */}
                    <div className="flex items-center justify-end pt-2">
                        <button
                            type="submit"
                            disabled={saving}
                            className="inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#0060AA] text-white px-8 py-3 rounded-lg text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
                        >
                            {saving ? (
                                <IconLoader2 size={16} className="animate-spin text-white" />
                            ) : (
                                <IconDeviceFloppy size={16} stroke={1.5} className="text-white" />
                            )}
                            <span>{saving ? "Guardando..." : t("save") || "Guardar Configuración Global"}</span>
                        </button>
                    </div>
                </form>
            )}

            {/* ─── MODAL DE PRUEBA DE CONEXIÓN (z-[100]) ─────────────────────────── */}
            {testModalResult && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 z-[100]">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2">
                                {testModalResult.ok ? (
                                    <IconCircleCheck size={22} className="text-emerald-600" />
                                ) : (
                                    <IconAlertCircle size={22} className="text-rose-600" />
                                )}
                                <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                                    Resultado de Prueba ({testModalResult.target})
                                </span>
                            </div>
                            <button
                                onClick={() => setTestModalResult(null)}
                                className="text-slate-400 hover:text-slate-600"
                            >
                                <IconX size={18} />
                            </button>
                        </div>

                        <div
                            className={`p-4 rounded-xl text-xs font-mono leading-relaxed ${
                                testModalResult.ok
                                    ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                    : "bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                            }`}
                        >
                            {testModalResult.message}
                        </div>

                        <div className="flex justify-end pt-2">
                            <button
                                onClick={() => setTestModalResult(null)}
                                className="px-4 py-2 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-900"
                            >
                                {t("close")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── MODAL DE CONFIRMACIÓN DE ELIMINACIÓN (z-[100]) ─────────────────── */}
            {deleteKeyTarget && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 z-[100]">
                        <div className="flex items-center gap-3 text-rose-600 pb-2 border-b border-slate-100 dark:border-slate-800">
                            <IconAlertCircle size={22} />
                            <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                                ¿Eliminar API Key de {deleteKeyTarget === "enterprise" ? "Enterprise" : "No-Enterprise"}?
                            </span>
                        </div>

                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                            {t("confirmDeleteKey") ||
                                "¿Eliminar la API key global? Los tenants que no configuraron su propia key (BYOK) se quedarán sin IA hasta que cargues una nueva."}
                        </p>

                        <div className="flex items-center justify-end gap-3 pt-2">
                            <button
                                onClick={() => setDeleteKeyTarget(null)}
                                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-50"
                            >
                                {t("cancel")}
                            </button>
                            <button
                                onClick={handleConfirmDeleteKey}
                                disabled={deletingKey}
                                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5"
                            >
                                {deletingKey && <IconLoader2 size={14} className="animate-spin" />}
                                <span>Eliminar Definitivamente</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export { GlobalAiConfigurationPanel };
