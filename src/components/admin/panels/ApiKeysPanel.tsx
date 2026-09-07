"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import DemoModeBadge from "@/components/DemoModeBadge";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from "@/lib/apiErrors";
import InfoTooltip from "@/components/InfoTooltip";
import { PublicApiKeyItem, PublicApiScope } from "@/types/publicApiKey.types";
import {
    IconLockAccess,
    IconPlus,
    IconCopy,
    IconCheck,
    IconTrash,
    IconFileCode,
    IconCircleCheck,
    IconAlertTriangle,
    IconColumns,
    IconLoader2,
    IconSearch,
    IconChevronLeft,
    IconChevronRight,
    IconRefresh,
    IconSparkles,
    IconGauge,
    IconShieldCheck,
    IconTerminal,
    IconBrandTypescript,
    IconBrandPython,
    IconBrandPowershell,
} from "@tabler/icons-react";

type DocTab = "curl" | "typescript" | "python" | "powershell";

interface ColumnConfig {
    id: string;
    label: string;
    visible: boolean;
    width: number;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
    { id: "name", label: "Nombre", visible: true, width: 240 },
    { id: "keyPrefix", label: "Clave Enmascarada", visible: true, width: 220 },
    { id: "scopes", label: "Scopes Asignados", visible: true, width: 260 },
    { id: "rateLimit", label: "Límite Velocidad", visible: true, width: 150 },
    { id: "createdBy", label: "Creada Por", visible: true, width: 200 },
    { id: "lastUsed", label: "Último Uso", visible: true, width: 160 },
    { id: "status", label: "Estado", visible: true, width: 120 },
    { id: "actions", label: "Acciones", visible: true, width: 90 },
];

const SCOPE_DEFINITIONS: { id: PublicApiScope; label: string; desc: string }[] = [
    { id: "read:cost", label: "read:cost", desc: "Lectura de costos y facturación agregada" },
    { id: "read:resources", label: "read:resources", desc: "Inventario de recursos y etiquetas" },
    { id: "read:budgets", label: "read:budgets", desc: "Presupuestos y alertas de desborde" },
    { id: "read:recommendations", label: "read:recommendations", desc: "Recomendaciones de optimización" },
    { id: "read:anomalies", label: "read:anomalies", desc: "Detección de anomalías de gasto" },
    { id: "write:metrics", label: "write:metrics", desc: "Ingesta de telemetría y métricas externas" },
];

export default function ApiKeysPanel() {
    const t = useTranslations("AdminApiKeys");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "default";
    const isMock = isMockTenant(tenantId);

    const [keys, setKeys] = useState<PublicApiKeyItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    // Formulario de creación
    const [nameInput, setNameInput] = useState("");
    const [rateLimit, setRateLimit] = useState<number>(60);
    const [selectedScopes, setSelectedScopes] = useState<PublicApiScope[]>(["read:cost", "read:resources"]);

    // Modal de revelación de token creado (Zero-Knowledge Reveal)
    const [revealedKey, setRevealedKey] = useState<string | null>(null);
    const [keyCopied, setKeyCopied] = useState(false);

    // Modal de revocación
    const [revokingKey, setRevokingKey] = useState<PublicApiKeyItem | null>(null);
    const [revoking, setRevoking] = useState(false);

    // Pestaña activa de la documentación
    const [activeDocTab, setActiveDocTab] = useState<DocTab>("curl");
    const [docCopied, setDocCopied] = useState(false);

    // Búsqueda y Paginación CMP
    const [searchTerm, setSearchTerm] = useState("");
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);

    // Configuración y Redimensionamiento de Columnas
    const storageKey = `table_columns_config_public_api_keys_${tenantId}`;
    const [columns, setColumns] = useState<ColumnConfig[]>(() => {
        if (typeof window !== "undefined") {
            try {
                const saved = localStorage.getItem(storageKey);
                if (saved) return JSON.parse(saved);
            } catch {
                /* noop */
            }
        }
        return DEFAULT_COLUMNS;
    });
    const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false);
    const columnPickerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (typeof window !== "undefined") {
            try {
                localStorage.setItem(storageKey, JSON.stringify(columns));
            } catch {
                /* noop */
            }
        }
    }, [columns, storageKey]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (columnPickerRef.current && !columnPickerRef.current.contains(event.target as Node)) {
                setIsColumnPickerOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Headers de autenticación
    const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (isMock || !accounts || accounts.length === 0) return {};
        try {
            const token = await getFreshIdToken(instance, accounts[0]);
            return token ? { Authorization: `Bearer ${token}` } : {};
        } catch {
            return {};
        }
    }, [instance, accounts, isMock]);

    // Cargar API Keys
    const loadKeys = useCallback(async () => {
        if (!tenantId || tenantId === "default") {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const headers = await getAuthHeaders();
            const url = isMock
                ? `/api/admin/public-api-keys?tenantId=${tenantId}&mock=true`
                : `/api/admin/public-api-keys?tenantId=${tenantId}`;

            const res = await fetch(url, { headers });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || t("errorLoading") || "Error al cargar las claves de API");
            }

            const rawKeys: PublicApiKeyItem[] = (json.keys || []).map((k: any) => ({
                id: String(k.id),
                tenantId: k.tenantId || k.tenant_id || tenantId,
                name: k.name || "Sin nombre",
                keyPrefix: k.keyPrefix || k.key_prefix || "pak_live_",
                maskedKey: k.maskedKey || `${k.key_prefix || "pak_live_"}••••••••${String(k.id).slice(-4)}`,
                rateLimitPerMinute: Number(k.rateLimitPerMinute || k.rate_limit_per_min) || 60,
                scopes: Array.isArray(k.scopes)
                    ? k.scopes
                    : typeof k.scopes === "string"
                    ? JSON.parse(k.scopes)
                    : ["read:cost", "read:resources"],
                lastUsedAtIso: k.lastUsedAtIso || (k.last_used_at ? new Date(k.last_used_at).toISOString() : null),
                createdByEmail: k.createdByEmail || k.created_by || "admin@cscloudsolutions.com",
                createdAtIso: k.createdAtIso || (k.created_at ? new Date(k.created_at).toISOString() : new Date().toISOString()),
                formattedCreatedAt: k.formattedCreatedAt || (k.created_at ? new Date(k.created_at).toLocaleDateString() : "-"),
                isRevoked: k.isRevoked !== undefined ? k.isRevoked : k.enabled === 0 || k.enabled === false,
                revokedAtIso: k.revokedAtIso || null,
            }));

            setKeys(rawKeys);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [tenantId, isMock, getAuthHeaders, t]);

    useEffect(() => {
        loadKeys();
    }, [loadKeys]);

    // Alternar Scopes
    const handleToggleScope = (scope: PublicApiScope) => {
        setSelectedScopes((prev) =>
            prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
        );
    };

    // Crear Key
    const handleCreateKey = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = nameInput.trim();
        if (!trimmed) {
            setError(t("errorNameRequired") || "El nombre es obligatorio");
            return;
        }

        if (selectedScopes.length === 0) {
            setError("Debes seleccionar al menos un scope de acceso");
            return;
        }

        setCreating(true);
        setError(null);

        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const res = await fetch(`/api/admin/public-api-keys?tenantId=${tenantId}`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    tenantId,
                    name: trimmed,
                    rateLimitPerMinute: rateLimit,
                    rate_limit_per_min: rateLimit,
                    scopes: selectedScopes,
                }),
            });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || t("errorCreating") || "Error al crear la clave");
            }

            const rawToken = json.rawKey || json.key;
            setRevealedKey(rawToken);
            setNameInput("");
            setSelectedScopes(["read:cost", "read:resources"]);
            setRateLimit(60);
            await loadKeys();
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setCreating(false);
        }
    };

    // Revocar Key
    const handleConfirmRevoke = async () => {
        if (!revokingKey) return;
        setRevoking(true);
        try {
            const headers = await getAuthHeaders();
            const url = isMock
                ? `/api/admin/public-api-keys/${revokingKey.id}?tenantId=${tenantId}&mock=true`
                : `/api/admin/public-api-keys/${revokingKey.id}?tenantId=${tenantId}`;

            const res = await fetch(url, { method: "DELETE", headers });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || t("errorDeleting") || "No se pudo revocar la clave");
            }

            setRevokingKey(null);
            await loadKeys();
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setRevoking(false);
        }
    };

    // Redimensionamiento de Columnas
    const handleResizeMouseDown = (columnId: string, e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const targetCol = columns.find((c) => c.id === columnId);
        if (!targetCol) return;
        const startWidth = targetCol.width;

        const onMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX;
            const newWidth = Math.max(100, Math.min(600, startWidth + delta));
            setColumns((prev) => prev.map((col) => (col.id === columnId ? { ...col, width: newWidth } : col)));
        };

        const onMouseUp = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    };

    const toggleColumnVisibility = (columnId: string) => {
        setColumns((prev) =>
            prev.map((col) => (col.id === columnId ? { ...col, visible: !col.visible } : col))
        );
    };

    const resetColumnsToDefault = () => {
        setColumns(DEFAULT_COLUMNS);
    };

    // Filtrado y Paginado
    const filteredKeys = useMemo(() => {
        if (!searchTerm.trim()) return keys;
        const q = searchTerm.toLowerCase();
        return keys.filter(
            (k) =>
                k.name.toLowerCase().includes(q) ||
                k.keyPrefix.toLowerCase().includes(q) ||
                k.createdByEmail.toLowerCase().includes(q) ||
                k.scopes.some((s) => s.toLowerCase().includes(q))
        );
    }, [keys, searchTerm]);

    const totalPages = Math.max(1, Math.ceil(filteredKeys.length / pageSize));
    const paginatedKeys = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredKeys.slice(start, start + pageSize);
    }, [filteredKeys, currentPage, pageSize]);

    // Copiar al Portapapeles
    const handleCopyText = (text: string, isKey = false) => {
        navigator.clipboard.writeText(text);
        if (isKey) {
            setKeyCopied(true);
            setTimeout(() => setKeyCopied(false), 2000);
        } else {
            setDocCopied(true);
            setTimeout(() => setDocCopied(false), 2000);
        }
    };

    const origin = typeof window !== "undefined" ? window.location.origin : "https://app.cscloudsolutions.com";

    // Snippets de Documentación
    const docSnippets: Record<DocTab, string> = {
        curl: `curl -X GET "${origin}/api/v1/costs?from=2026-08-01&to=2026-08-22" \\
  -H "Authorization: Bearer <TU_PAK_API_KEY>" \\
  -H "Content-Type: application/json"`,
        typescript: `import axios from 'axios';

const response = await axios.get('${origin}/api/v1/costs', {
  params: { from: '2026-08-01', to: '2026-08-22' },
  headers: {
    Authorization: 'Bearer <TU_PAK_API_KEY>',
    'Content-Type': 'application/json',
  },
});

console.log(response.data);`,
        python: `import requests

url = "${origin}/api/v1/costs"
headers = {
    "Authorization": "Bearer <TU_PAK_API_KEY>",
    "Content-Type": "application/json"
}
params = {"from": "2026-08-01", "to": "2026-08-22"}

response = requests.get(url, headers=headers, params=params)
print(response.json())`,
        powershell: `$headers = @{
    "Authorization" = "Bearer <TU_PAK_API_KEY>"
    "Content-Type"  = "application/json"
}

$response = Invoke-RestMethod -Uri "${origin}/api/v1/costs?from=2026-08-01&to=2026-08-22" -Method Get -Headers $headers
$response | ConvertTo-Json`,
    };

    return (
        <div className="w-full max-w-full space-y-8 animate-in fade-in duration-200">
            {/* Header y Subtítulo de Sección */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center font-['Montserrat',sans-serif]">
                        <IconLockAccess size={26} stroke={1.5} className="text-[#0078D4] inline mr-2.5" />
                        {t("pageTitle") || "API Pública"}
                        <InfoTooltip
                            content={
                                t("tooltipTitle") ||
                                "Gestioná claves de API REST versionadas (pak_xxx) para acceso programático a endpoints de FinOps con control granular de scopes y rate limiting."
                            }
                        />
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-4xl leading-relaxed">
                        {t("pageSubtitle") ||
                            "Gestioná claves de API REST versionadas (pak_xxx) para acceso público a los endpoints de FinOps. Cada clave tiene scopes y límites de velocidad asignados."}
                    </p>
                </div>

                {isMock && (
                    <DemoModeBadge />
                )}
            </div>

            {/* Error Banner */}
            {error && (
                <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                    <IconAlertTriangle size={16} />
                    <span>{error}</span>
                </div>
            )}

            {/* ─── SECCIÓN 1: Tarjeta Crear Nueva Clave (Ancho 100%) ───────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-6">
                <div className="flex items-center gap-2">
                    <IconPlus size={18} stroke={1.5} className="text-[#0078D4]" />
                    <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                        {t("createTitle") || "Crear nueva clave de API"}
                    </h2>
                    <InfoTooltip content="Genera una clave pak_live_ con permisos restringidos por scope y cuota por minuto." />
                </div>

                <form onSubmit={handleCreateKey} className="space-y-6">
                    {/* Grid de 2 Columnas: Nombre + Slider Rate Limit */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Columna 1: Nombre */}
                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                {t("nameLabel") || "Nombre de la clave"}
                            </label>
                            <input
                                type="text"
                                value={nameInput}
                                onChange={(e) => setNameInput(e.target.value)}
                                placeholder={t("namePlaceholder") || "ej: Production API / Pipeline CI-CD"}
                                className="w-full px-4 py-2.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                disabled={creating}
                            />
                        </div>

                        {/* Columna 2: Slider Rate Limit */}
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                    <IconGauge size={15} className="text-[#0078D4]" />
                                    <span>{t("rateLimitLabel")}</span>
                                </label>
                                <span className="font-bold text-xs text-[#0078D4] dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-900">
                                    {rateLimit} req/min
                                </span>
                            </div>
                            <input
                                type="range"
                                min="10"
                                max="300"
                                step="10"
                                value={rateLimit}
                                onChange={(e) => setRateLimit(Number(e.target.value))}
                                className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[#0078D4]"
                                disabled={creating}
                            />
                            <div className="flex justify-between text-[10px] text-slate-400">
                                <span>10 req/min</span>
                                <span>150 req/min</span>
                                <span>300 req/min</span>
                            </div>
                        </div>
                    </div>

                    {/* Scopes y Permisos Granulares */}
                    <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-1.5">
                            <IconShieldCheck size={16} className="text-[#0078D4]" />
                            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                {t("scopesLabel") || "Scopes de Acceso Asignados"}
                            </label>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {SCOPE_DEFINITIONS.map((scope) => {
                                const isChecked = selectedScopes.includes(scope.id);
                                return (
                                    <label
                                        key={scope.id}
                                        className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                                            isChecked
                                                ? "border-blue-300 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20 shadow-xs"
                                                : "border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/30 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => handleToggleScope(scope.id)}
                                            className="mt-0.5 rounded border-slate-300 text-[#0078D4] focus:ring-[#0078D4] accent-[#0078D4]"
                                        />
                                        <div className="space-y-0.5">
                                            <span className="font-mono font-bold text-[11px] text-[#0078D4] dark:text-blue-400">
                                                {scope.label}
                                            </span>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                                                {scope.desc}
                                            </p>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </div>

                    {/* Botón de Creación */}
                    <div className="flex justify-end pt-2">
                        <button
                            type="submit"
                            disabled={creating || !nameInput.trim() || selectedScopes.length === 0}
                            className="inline-flex items-center justify-center gap-1.5 bg-[#0078D4] text-white hover:bg-[#0060AA] px-6 py-2.5 rounded-lg font-semibold text-xs whitespace-nowrap shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {creating ? (
                                <IconLoader2 size={16} className="animate-spin text-white" />
                            ) : (
                                <IconPlus size={16} stroke={1.5} className="inline text-white" />
                            )}
                            <span>{t("createButton") || "Crear clave"}</span>
                        </button>
                    </div>
                </form>
            </div>

            {/* ─── SECCIÓN 2: Tabla Claves de API Activas (Estándar CMP) ─────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden space-y-4 p-6">
                {/* Cabecera y Controles */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-2 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                            Claves de API Activas ({filteredKeys.length})
                        </h2>
                        <button
                            onClick={loadKeys}
                            className="p-1 text-slate-400 hover:text-[#0078D4] rounded transition-colors"
                            title="Refrescar lista"
                        >
                            <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                        {/* Buscador */}
                        <div className="relative flex-1 sm:w-56">
                            <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setCurrentPage(1);
                                }}
                                placeholder="Filtrar claves..."
                                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                            />
                        </div>

                        {/* Selector de Columnas (z-[100]) */}
                        <div className="relative" ref={columnPickerRef}>
                            <button
                                type="button"
                                onClick={() => setIsColumnPickerOpen((prev) => !prev)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200 transition-colors shadow-sm"
                            >
                                <IconColumns size={15} stroke={1.5} className="text-[#0078D4]" />
                                <span>Personalizar Columnas</span>
                            </button>

                            {isColumnPickerOpen && (
                                <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-[100] p-3 space-y-2 animate-in fade-in">
                                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200">
                                        <span>Columnas Visibles</span>
                                        <button
                                            onClick={resetColumnsToDefault}
                                            className="text-[11px] font-normal text-[#0078D4] hover:underline"
                                        >
                                            Restaurar
                                        </button>
                                    </div>
                                    <div className="space-y-1 max-h-48 overflow-y-auto">
                                        {columns.map((col) => (
                                            <label
                                                key={col.id}
                                                className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 p-1.5 rounded cursor-pointer"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={col.visible}
                                                    onChange={() => toggleColumnVisibility(col.id)}
                                                    className="rounded border-slate-300 text-[#0078D4] focus:ring-[#0078D4]"
                                                />
                                                <span>{col.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Contenedor de Tabla con Scrollbar visible en macOS */}
                <div className="w-full max-w-full overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800">
                    <table className="w-full text-left text-xs border-collapse">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                                {columns
                                    .filter((c) => c.visible)
                                    .map((col) => (
                                        <th
                                            key={col.id}
                                            style={{ width: `${col.width}px` }}
                                            className="relative px-4 py-3 font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[11px] select-none"
                                        >
                                            <span>{col.label}</span>
                                            <div
                                                onMouseDown={(e) => handleResizeMouseDown(col.id, e)}
                                                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[#0078D4] transition-colors"
                                            />
                                        </th>
                                    ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading ? (
                                <tr>
                                    <td colSpan={columns.filter((c) => c.visible).length} className="px-4 py-8 text-center text-slate-500">
                                        <div className="inline-flex items-center gap-2">
                                            <IconLoader2 size={16} className="animate-spin text-[#0078D4]" />
                                            <span>{t("loadingKeys")}</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : paginatedKeys.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.filter((c) => c.visible).length} className="px-4 py-8 text-center text-slate-500 italic">
                                        {searchTerm
                                            ? "No se encontraron claves que coincidan con la búsqueda."
                                            : t("noKeys") || "Todavía no hay claves de API creadas. Utilizá el formulario superior para generar una clave."}
                                    </td>
                                </tr>
                            ) : (
                                paginatedKeys.map((k) => (
                                    <tr
                                        key={k.id}
                                        className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${
                                            k.isRevoked ? "opacity-60 bg-slate-50/30" : ""
                                        }`}
                                    >
                                        {columns.find((c) => c.id === "name")?.visible && (
                                            <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-100">
                                                <div className="flex items-center gap-1.5">
                                                    <IconLockAccess size={14} className="text-[#0078D4] shrink-0" />
                                                    <span className="truncate max-w-[200px]" title={k.name}>
                                                        {k.name}
                                                    </span>
                                                </div>
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "keyPrefix")?.visible && (
                                            <td className="px-4 py-3 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                                                <div className="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                                                    <span>{k.maskedKey}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyText(k.maskedKey, false)}
                                                        className="text-slate-400 hover:text-[#0078D4] transition-colors"
                                                        title="Copiar prefijo"
                                                    >
                                                        <IconCopy size={13} />
                                                    </button>
                                                </div>
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "scopes")?.visible && (
                                            <td className="px-4 py-3">
                                                <div className="flex flex-wrap gap-1 max-w-[240px]">
                                                    {k.scopes.map((scope) => (
                                                        <span
                                                            key={scope}
                                                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-50 dark:bg-blue-950/40 text-[#0078D4] dark:text-blue-300 border border-blue-100 dark:border-blue-900"
                                                        >
                                                            {scope}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "rateLimit")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className="font-semibold text-slate-700 dark:text-slate-300">
                                                    {k.rateLimitPerMinute} req/min
                                                </span>
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "createdBy")?.visible && (
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                                <span className="truncate max-w-[160px] block" title={k.createdByEmail}>
                                                    {k.createdByEmail}
                                                </span>
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "lastUsed")?.visible && (
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                                {k.lastUsedAtIso ? (
                                                    new Date(k.lastUsedAtIso).toLocaleString()
                                                ) : (
                                                    <span className="text-slate-400 italic">{t("never") || "Nunca"}</span>
                                                )}
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "status")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                {k.isRevoked ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700">
                                                        Revocada
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-[#0078D4] border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                                        Activa
                                                    </span>
                                                )}
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "actions")?.visible && (
                                            <td className="px-4 py-3 text-right">
                                                {!k.isRevoked && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setRevokingKey(k)}
                                                        className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                                                        title="Revocar clave"
                                                    >
                                                        <IconTrash size={15} stroke={1.5} />
                                                    </button>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Paginación Estándar CMP */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                        <span>Mostrar:</span>
                        <select
                            value={pageSize}
                            onChange={(e) => {
                                setPageSize(Number(e.target.value));
                                setCurrentPage(1);
                            }}
                            className="px-2 py-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded text-xs focus:ring-1 focus:ring-[#0078D4]"
                        >
                            <option value={15}>15</option>
                            <option value={30}>30</option>
                            <option value={45}>45</option>
                            <option value={60}>60</option>
                        </select>
                        <span>de {filteredKeys.length} registros</span>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="p-1.5 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                        >
                            <IconChevronLeft size={14} />
                        </button>
                        <span className="px-3">
                            {t("pageOf", { current: currentPage, total: totalPages })}
                        </span>
                        <button
                            type="button"
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="p-1.5 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                        >
                            <IconChevronRight size={14} />
                        </button>
                    </div>
                </div>
            </div>

            {/* ─── SECCIÓN 3: Tarjeta Documentación Rápida y Ejemplos (Ancho 100%) ─── */}
            <div className="bg-slate-900 text-slate-100 p-6 rounded-2xl shadow-sm space-y-4 border border-slate-800">
                <div className="flex items-center gap-2">
                    <IconFileCode size={20} stroke={1.5} className="text-[#0078D4]" />
                    <h2 className="font-bold text-sm text-white font-['Montserrat',sans-serif]">
                        {t("apiInvocationTitle")}
                    </h2>
                </div>

                {/* Tabs de Selección de Lenguaje */}
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2">
                    <button
                        type="button"
                        onClick={() => setActiveDocTab("curl")}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            activeDocTab === "curl"
                                ? "bg-[#0078D4] text-white shadow-sm"
                                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                        }`}
                    >
                        <IconTerminal size={14} />
                        <span>cURL</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveDocTab("typescript")}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            activeDocTab === "typescript"
                                ? "bg-[#0078D4] text-white shadow-sm"
                                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                        }`}
                    >
                        <IconBrandTypescript size={14} />
                        <span>Node.js / TypeScript</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveDocTab("python")}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            activeDocTab === "python"
                                ? "bg-[#0078D4] text-white shadow-sm"
                                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                        }`}
                    >
                        <IconBrandPython size={14} />
                        <span>Python</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveDocTab("powershell")}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            activeDocTab === "powershell"
                                ? "bg-[#0078D4] text-white shadow-sm"
                                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                        }`}
                    >
                        <IconBrandPowershell size={14} />
                        <span>PowerShell</span>
                    </button>
                </div>

                {/* Bloque de Código con botón Copiar */}
                <div className="relative bg-slate-950 rounded-xl p-4 font-mono text-xs text-slate-200 border border-slate-800 overflow-x-auto">
                    <pre>{docSnippets[activeDocTab]}</pre>
                    <button
                        type="button"
                        onClick={() => handleCopyText(docSnippets[activeDocTab], false)}
                        className="absolute right-3 top-3 inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition-colors border border-slate-700 shadow-sm"
                    >
                        {docCopied ? <IconCheck size={12} className="text-[#10B981]" /> : <IconCopy size={12} />}
                        <span>{docCopied ? "Copiado" : "Copiar Código"}</span>
                    </button>
                </div>
            </div>

            {/* ─── MODAL 1: Clave Creada con Éxito (Zero-Knowledge Reveal - z-[100]) ─ */}
            {revealedKey && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-lg w-full space-y-5 shadow-2xl">
                        <div className="text-center space-y-2">
                            <IconCircleCheck size={42} stroke={1.5} className="text-[#10B981] mx-auto" />
                            <h3 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                                {t("newKeyTitle") || "Clave de API Pública Creada"}
                            </h3>
                        </div>

                        {/* Banner de advertencia ámbar */}
                        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 p-3.5 rounded-xl text-xs flex items-start gap-2 leading-relaxed">
                            <IconAlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-600" />
                            <span>
                                {t("saveKeyNotice")}
                            </span>
                        </div>

                        {/* Input con clave en texto plano */}
                        <div className="space-y-1.5">
                            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                                API Key Token:
                            </label>
                            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
                                <code className="font-mono text-xs text-[#0078D4] dark:text-blue-400 break-all flex-1 select-all font-bold">
                                    {revealedKey}
                                </code>
                                <button
                                    type="button"
                                    onClick={() => handleCopyText(revealedKey, true)}
                                    className="inline-flex items-center gap-1 bg-[#0078D4] hover:bg-[#0060AA] text-white px-3 py-1.5 rounded text-xs font-semibold transition-colors shrink-0 shadow-sm"
                                >
                                    {keyCopied ? <IconCheck size={13} /> : <IconCopy size={13} />}
                                    <span>{keyCopied ? t("copied") : t("copy")}</span>
                                </button>
                            </div>
                        </div>

                        {/* Botón de Cierre */}
                        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                            <button
                                type="button"
                                onClick={() => setRevealedKey(null)}
                                className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-5 py-2 rounded-lg text-xs font-semibold transition-colors"
                            >
                                Entendido
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── MODAL 2: Confirmación de Revocación (z-[100]) ───────────────────── */}
            {revokingKey && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full space-y-5 shadow-2xl">
                        <div className="text-center space-y-2">
                            <IconAlertTriangle size={42} stroke={1.5} className="text-rose-600 mx-auto" />
                            <h3 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                                {t("revokeConfirmTitle")}
                            </h3>
                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                                {t("confirmDelete") ||
                                    "¿Eliminar esta clave? Las aplicaciones y pipelines que la utilicen dejarán de funcionar de inmediato."}
                            </p>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-xs space-y-1">
                            <p className="font-semibold text-slate-800 dark:text-slate-200">{revokingKey.name}</p>
                            <p className="font-mono text-[11px] text-slate-500">{revokingKey.maskedKey}</p>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <button
                                type="button"
                                onClick={() => setRevokingKey(null)}
                                disabled={revoking}
                                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                {t("cancel")}
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmRevoke}
                                disabled={revoking}
                                className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
                            >
                                {revoking && <IconLoader2 size={14} className="animate-spin" />}
                                <span>Revocar Clave</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
