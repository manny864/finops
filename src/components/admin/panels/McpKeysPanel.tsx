"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from "@/lib/apiErrors";
import InfoTooltip from "@/components/InfoTooltip";
import { McpApiKeyItem } from "@/types/mcpApiKey.types";
import {
    IconKey,
    IconPlus,
    IconCopy,
    IconCheck,
    IconTrash,
    IconInfoCircle,
    IconCircleCheck,
    IconAlertTriangle,
    IconColumns,
    IconLoader2,
    IconSearch,
    IconChevronLeft,
    IconChevronRight,
    IconRefresh,
    IconCode,
    IconFileSpreadsheet,
    IconRobot,
    IconTerminal,
    IconSparkles,
} from "@tabler/icons-react";

type GuideTab = "claude" | "cursor" | "powerbi" | "curl";

interface ColumnConfig {
    id: string;
    label: string;
    visible: boolean;
    width: number;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
    { id: "name", label: "Etiqueta / Nombre", visible: true, width: 260 },
    { id: "keyPrefix", label: "Clave Enmascarada", visible: true, width: 220 },
    { id: "createdBy", label: "Creada Por", visible: true, width: 220 },
    { id: "createdAt", label: "Fecha Creación", visible: true, width: 170 },
    { id: "lastUsed", label: "Último Uso", visible: true, width: 160 },
    { id: "status", label: "Estado", visible: true, width: 130 },
    { id: "actions", label: "Acciones", visible: true, width: 100 },
];

export default function McpKeysPanel() {
    const t = useTranslations("AdminMcpKeys");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "default";
    const isMock = isMockTenant(tenantId);

    const [keys, setKeys] = useState<McpApiKeyItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [labelInput, setLabelInput] = useState("");

    // Modal de revelación única de key cruda (Zero-Knowledge Reveal)
    const [revealedKey, setRevealedKey] = useState<string | null>(null);
    const [keyCopied, setKeyCopied] = useState(false);

    // Modal de confirmación de revocación
    const [revokingKey, setRevokingKey] = useState<McpApiKeyItem | null>(null);
    const [revoking, setRevoking] = useState(false);

    // Pestaña activa de la guía de integración
    const [activeGuideTab, setActiveGuideTab] = useState<GuideTab>("claude");
    const [guideCopied, setGuideCopied] = useState(false);

    // Búsqueda y Paginación CMP
    const [searchTerm, setSearchTerm] = useState("");
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);

    // Configuración y Redimensionamiento de Columnas
    const storageKey = `table_columns_config_mcp_keys_${tenantId}`;
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

    // Guardar columnas en localStorage
    useEffect(() => {
        if (typeof window !== "undefined") {
            try {
                localStorage.setItem(storageKey, JSON.stringify(columns));
            } catch {
                /* noop */
            }
        }
    }, [columns, storageKey]);

    // Cerrar dropdown de columnas al hacer clic afuera
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

    // Carga de API keys
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
                ? `/api/admin/mcp-keys?tenantId=${tenantId}&mock=true`
                : `/api/admin/mcp-keys?tenantId=${tenantId}`;
            const res = await fetch(url, { headers });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || "Error al cargar las MCP API Keys");
            }

            const rawKeys: McpApiKeyItem[] = (json.keys || []).map((k: any) => ({
                id: String(k.id),
                tenantId: k.tenantId || k.tenant_id || tenantId,
                name: k.name || k.label || "Sin etiqueta",
                keyPrefix: k.keyPrefix || k.key_prefix || "mcp_live_",
                maskedKey: k.maskedKey || `${k.key_prefix || "mcp_live_"}••••••••${String(k.id).slice(-4)}`,
                lastUsedAtIso: k.lastUsedAtIso || (k.last_used_at ? new Date(k.last_used_at).toISOString() : null),
                expiresAtIso: k.expiresAtIso || null,
                createdByEmail: k.createdByEmail || k.created_by_email || "admin@cscloudsolutions.com",
                createdAtIso: k.createdAtIso || (k.created_at ? new Date(k.created_at).toISOString() : new Date().toISOString()),
                formattedCreatedAt: k.formattedCreatedAt || (k.created_at ? new Date(k.created_at).toLocaleDateString() : "-"),
                isRevoked: Boolean(k.isRevoked || k.revoked_at),
                revokedAtIso: k.revokedAtIso || (k.revoked_at ? new Date(k.revoked_at).toISOString() : null),
            }));

            setKeys(rawKeys);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [tenantId, isMock, getAuthHeaders]);

    useEffect(() => {
        loadKeys();
    }, [loadKeys]);

    // Crear Key
    const handleCreateKey = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = labelInput.trim();
        if (!trimmed) {
            setError(t("errorLabelRequired") || "Ingresa una etiqueta descriptiva");
            return;
        }

        setCreating(true);
        setError(null);

        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const res = await fetch("/api/admin/mcp-keys", {
                method: "POST",
                headers,
                body: JSON.stringify({ tenantId, name: trimmed, label: trimmed }),
            });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || t("errorCreatingKey") || "No se pudo crear la key");
            }

            const rawToken = json.rawKey || json.key;
            setRevealedKey(rawToken);
            setLabelInput("");
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
                ? `/api/admin/mcp-keys?tenantId=${tenantId}&keyId=${revokingKey.id}&mock=true`
                : `/api/admin/mcp-keys?tenantId=${tenantId}&keyId=${revokingKey.id}`;

            const res = await fetch(url, { method: "DELETE", headers });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || "No se pudo revocar la key");
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

    // Alternar visibilidad de columna
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
                k.createdByEmail.toLowerCase().includes(q)
        );
    }, [keys, searchTerm]);

    const totalPages = Math.max(1, Math.ceil(filteredKeys.length / pageSize));
    const paginatedKeys = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredKeys.slice(start, start + pageSize);
    }, [filteredKeys, currentPage, pageSize]);

    // Copiar al portapapeles
    const handleCopyText = (text: string, isKey = false) => {
        navigator.clipboard.writeText(text);
        if (isKey) {
            setKeyCopied(true);
            setTimeout(() => setKeyCopied(false), 2000);
        } else {
            setGuideCopied(true);
            setTimeout(() => setGuideCopied(false), 2000);
        }
    };

    // Dominio base dinámico para snippets
    const origin = typeof window !== "undefined" ? window.location.origin : "https://app.cscloudsolutions.com";

    // Snippets de la guía
    const guideSnippets: Record<GuideTab, string> = {
        claude: JSON.stringify(
            {
                mcpServers: {
                    "cscloud-finops": {
                        url: `${origin}/api/mcp`,
                        headers: {
                            Authorization: "Bearer <TU_MCP_KEY>",
                        },
                    },
                },
            },
            null,
            2
        ),
        cursor: JSON.stringify(
            {
                name: "CSCloudSolutions FinOps",
                type: "sse",
                url: `${origin}/api/mcp`,
                headers: {
                    Authorization: "Bearer <TU_MCP_KEY>",
                },
            },
            null,
            2
        ),
        powerbi: `let
    // Power BI M Query Feed para CSCloudSolutions FinOps
    Source = Json.Document(Web.Contents("${origin}/api/exports/powerbi-feed?type=costs", [
        Headers = [
            #"Authorization" = "Bearer <TU_MCP_KEY>",
            #"Content-Type" = "application/json"
        ]
    ])),
    #"Converted to Table" = Table.FromList(Source[data], Splitter.SplitByNothing(), null, null, ExtraValues.Error)
in
    #"Converted to Table"`,
        curl: `curl -X POST "${origin}/api/mcp" \\
  -H "Authorization: Bearer <TU_MCP_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "get_cost_summary",
      "arguments": { "days": 30 }
    },
    "id": 1
  }'`,
    };

    return (
        <div className="w-full max-w-full space-y-8 animate-in fade-in duration-200">
            {/* Header y Subtítulo de Sección */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center font-['Montserrat',sans-serif]">
                        <IconKey size={26} stroke={1.5} className="text-[#0078D4] inline mr-2.5" />
                        {t("pageTitle") || "MCP API Keys"}
                        <InfoTooltip
                            content={
                                t("tooltipTitle") ||
                                "Permite que agentes de IA (Claude Desktop, Cursor, Custom GPTs) o reportes de Power BI consulten datos del tenant mediante el protocolo abierto Model Context Protocol (MCP) en modo solo lectura."
                            }
                        />
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-4xl leading-relaxed">
                        {t("description") ||
                            "Keys de acceso al bridge MCP (/api/mcp) y al feed de Power BI. Permite que agentes de IA (Claude Desktop, Cursor, Copilot, Custom GPTs) o Power BI consulten datos del tenant en modo solo lectura."}
                    </p>
                </div>

                {isMock && (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-400">
                        <IconSparkles size={14} />
                        <span>Modo Demostración</span>
                    </div>
                )}
            </div>

            {/* Error Banner */}
            {error && (
                <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                    <IconAlertTriangle size={16} />
                    <span>{error}</span>
                </div>
            )}

            {/* ─── SECCIÓN 1: Tarjeta Crear Nueva Key (Ancho 100%) ─────────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                    <IconPlus size={18} stroke={1.5} className="text-[#0078D4]" />
                    <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                        {t("createNewKeyTitle") || "Crear nuevo key"}
                    </h2>
                    <InfoTooltip content="Genera un token seguro que comienza con mcp_live_. Solo se almacena su hash SHA-256 en la base de datos." />
                </div>

                <form onSubmit={handleCreateKey} className="space-y-3">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        {t("labelFieldLabel") || 'Etiqueta descriptiva (ej.: "Claude Desktop Juan" o "Power BI Feed"): '}
                    </label>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        <input
                            type="text"
                            value={labelInput}
                            onChange={(e) => setLabelInput(e.target.value)}
                            placeholder={t("labelPlaceholder") || "ej. Claude Desktop - Entorno Desarrollo"}
                            className="flex-1 px-4 py-2.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                            disabled={creating}
                        />
                        <button
                            type="submit"
                            disabled={creating || !labelInput.trim()}
                            className="inline-flex items-center justify-center gap-1.5 bg-[#0078D4] text-white hover:bg-[#0060AA] px-6 py-2.5 rounded-lg font-semibold text-xs whitespace-nowrap shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {creating ? (
                                <IconLoader2 size={16} className="animate-spin text-white" />
                            ) : (
                                <IconPlus size={16} stroke={1.5} className="inline text-white" />
                            )}
                            <span>{t("createKeyButton") || "Crear key"}</span>
                        </button>
                    </div>
                </form>
            </div>

            {/* ─── SECCIÓN 2: Tabla Keys Existentes (Estándar CMP) ─────────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden space-y-4 p-6">
                {/* Cabecera y Controles de Tabla */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-2 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                            {t("existingKeysTitle", { count: filteredKeys.length }) || `Keys existentes (${filteredKeys.length})`}
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
                                placeholder="Filtrar keys..."
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
                                            {/* Resize Handle */}
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
                                            <span>{t("loadingLabel") || "Cargando keys..."}</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : paginatedKeys.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.filter((c) => c.visible).length} className="px-4 py-8 text-center text-slate-500 italic">
                                        {searchTerm
                                            ? "No se encontraron keys que coincidan con la búsqueda."
                                            : t("noKeysMessage") || "Sin keys creadas. Ingresá una etiqueta arriba para generar tu primer acceso."}
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
                                                    <IconKey size={14} className="text-[#0078D4] shrink-0" />
                                                    <span className="truncate max-w-[220px]" title={k.name}>
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

                                        {columns.find((c) => c.id === "createdBy")?.visible && (
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-[#0078D4] flex items-center justify-center font-bold text-[10px] shrink-0">
                                                        {(k.createdByEmail || "A").charAt(0).toUpperCase()}
                                                    </div>
                                                    <span className="truncate max-w-[180px]" title={k.createdByEmail}>
                                                        {k.createdByEmail}
                                                    </span>
                                                </div>
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "createdAt")?.visible && (
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                                {k.formattedCreatedAt}
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "lastUsed")?.visible && (
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                                {k.lastUsedAtIso ? (
                                                    new Date(k.lastUsedAtIso).toLocaleString()
                                                ) : (
                                                    <span className="text-slate-400 italic">{t("neverUsedLabel") || "Nunca"}</span>
                                                )}
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "status")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                {k.isRevoked ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700">
                                                        {t("revokedStatus") || "Revocada"}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-[#0078D4] border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                                        {t("activeStatus") || "Activa"}
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
                                                        title="Revocar key"
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
                            Página {currentPage} de {totalPages}
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

            {/* ─── SECCIÓN 3: Tarjeta interactiva ¿Cómo usar el MCP Bridge? ────────── */}
            <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/50 p-6 rounded-2xl shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                    <IconInfoCircle size={20} stroke={1.5} className="text-[#0078D4]" />
                    <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                        {t("howToUseTitle") || "¿Cómo usar el protocolo MCP en tus herramientas de IA?"}
                    </h2>
                </div>

                {/* Tabs de Selección de Herramienta */}
                <div className="flex flex-wrap items-center gap-2 border-b border-blue-200/60 dark:border-blue-900/50 pb-2">
                    <button
                        type="button"
                        onClick={() => setActiveGuideTab("claude")}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            activeGuideTab === "claude"
                                ? "bg-[#0078D4] text-white shadow-sm"
                                : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-blue-100/50"
                        }`}
                    >
                        <IconRobot size={14} />
                        <span>Claude Desktop</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveGuideTab("cursor")}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            activeGuideTab === "cursor"
                                ? "bg-[#0078D4] text-white shadow-sm"
                                : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-blue-100/50"
                        }`}
                    >
                        <IconCode size={14} />
                        <span>Cursor IDE / VS Code</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveGuideTab("powerbi")}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            activeGuideTab === "powerbi"
                                ? "bg-[#0078D4] text-white shadow-sm"
                                : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-blue-100/50"
                        }`}
                    >
                        <IconFileSpreadsheet size={14} />
                        <span>Power BI Feed</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveGuideTab("curl")}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            activeGuideTab === "curl"
                                ? "bg-[#0078D4] text-white shadow-sm"
                                : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-blue-100/50"
                        }`}
                    >
                        <IconTerminal size={14} />
                        <span>cURL JSON-RPC</span>
                    </button>
                </div>

                {/* Explicación según tab */}
                <p className="text-xs text-slate-600 dark:text-slate-400">
                    {activeGuideTab === "claude" &&
                        "Agrega este bloque a tu archivo claude_desktop_config.json para que Claude Desktop consulte tus costos y recursos FinOps."}
                    {activeGuideTab === "cursor" &&
                        "Configura el MCP Server en Cursor Settings → Features → MCP Servers para interactuar con FinOps desde tu editor."}
                    {activeGuideTab === "powerbi" &&
                        "Pega esta consulta en Power Query (Editor Avanzado) para traer los costos a tu modelo analítico en Power BI Desktop."}
                    {activeGuideTab === "curl" &&
                        "Ejecuta llamadas directas JSON-RPC 2.0 para invocar herramientas como get_cost_summary, get_waste_zombies o get_anomalies_feed."}
                </p>

                {/* Bloque de Código */}
                <div className="relative bg-slate-900 dark:bg-slate-950 rounded-xl p-4 font-mono text-xs text-slate-200 border border-slate-800 overflow-x-auto">
                    <pre>{guideSnippets[activeGuideTab]}</pre>
                    <button
                        type="button"
                        onClick={() => handleCopyText(guideSnippets[activeGuideTab], false)}
                        className="absolute right-3 top-3 inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition-colors border border-slate-700 shadow-sm"
                    >
                        {guideCopied ? <IconCheck size={12} className="text-[#10B981]" /> : <IconCopy size={12} />}
                        <span>{guideCopied ? "Copiado" : "Copiar Configuración"}</span>
                    </button>
                </div>
            </div>

            {/* ─── MODAL 1: Key Creada con Éxito (Zero-Knowledge Reveal - z-[100]) ─── */}
            {revealedKey && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-lg w-full space-y-5 shadow-2xl">
                        <div className="text-center space-y-2">
                            <IconCircleCheck size={42} stroke={1.5} className="text-[#10B981] mx-auto" />
                            <h3 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                                {t("saveKeyNowTitle") || "Guarda tu MCP API Key"}
                            </h3>
                        </div>

                        {/* Banner de advertencia ámbar suave */}
                        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 p-3.5 rounded-xl text-xs flex items-start gap-2 leading-relaxed">
                            <IconAlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-600" />
                            <span>
                                {t("saveKeyNowDescription") ||
                                    "Esta es la única vez que verás la key completa. Cópiala y guárdala en un lugar seguro; no podremos mostrártela de nuevo."}
                            </span>
                        </div>

                        {/* Key en texto plano con botón de copiado */}
                        <div className="space-y-1.5">
                            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                                MCP API Key (Token Secreto):
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
                                    <span>{keyCopied ? "¡Copiado!" : "Copiar"}</span>
                                </button>
                            </div>
                        </div>

                        {/* Botón de cierre */}
                        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                            <button
                                type="button"
                                onClick={() => setRevealedKey(null)}
                                className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-5 py-2 rounded-lg text-xs font-semibold transition-colors"
                            >
                                Entendido / Cerrar
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
                                ¿Revocar esta MCP API Key?
                            </h3>
                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                                {t("confirmRevokeKey") ||
                                    "¿Estás seguro de que deseas revocar esta key? Las aplicaciones, agentes de IA o reportes de Power BI que la utilicen perderán el acceso de inmediato."}
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
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmRevoke}
                                disabled={revoking}
                                className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
                            >
                                {revoking && <IconLoader2 size={14} className="animate-spin" />}
                                <span>Revocar Key</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
