"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
    IconChartDots,
    IconCode,
    IconDownload,
    IconKey,
    IconLoader2,
    IconFileText,
} from "@tabler/icons-react";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { resolveScriptComments } from "@/lib/scriptComments";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { downloadPqFile } from "@/lib/export/downloadPqFile";
import PowerBiScriptModal from "@/components/reports/PowerBiScriptModal";
import { toast } from "sonner";

/**
 * El registro manda la clave y el texto en castellano de fallback: resolver
 * aca evita que la tarjeta se lea en castellano sobre la UI en ingles.
 */
function traducirLista(claves: string[] | undefined, textos: string[], t: any): string[] {
    if (!claves || claves.length !== textos.length) return textos;
    return claves.map((clave, i) => (t.has(clave) ? t(clave) : textos[i]));
}

interface TemplateMeta {
    id: string;
    name: string;
    description: string;
    descriptionKey?: string;
    category: string;
    categoryDisplayName?: string;
    categoryDisplayNameKey?: string;
    feedType: string;
    sampleVisualizations: string[];
    visualizationKeys?: string[];
    downloadUrl: string;
}

interface TemplateDetail extends TemplateMeta {
    powerQueryM: string;
}

export default function PowerBiTemplatesPanel() {
    const t = useTranslations("PowerBITemplates");
    const tc = useTranslations("ScriptComments");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "";
    const isMock = isMockTenant(tenantId);

    const [list, setList] = useState<TemplateMeta[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<TemplateDetail | null>(null);
    const [activeApiKey, setActiveApiKey] = useState<string>("");

    const baseUrl = useMemo(() => {
        if (typeof window !== "undefined") {
            return window.location.origin;
        }
        return "https://app.cscloudsolutions.com";
    }, []);

    // Cargar plantillas desde API
    useEffect(() => {
        let isMounted = true;
        (async () => {
            try {
                const res = await fetch("/api/templates/powerbi");
                const json = await res.json();
                if (isMounted && json.success) {
                    setList(json.templates || []);
                }
            } catch (err) {
                console.error("[PowerBiTemplates] Error cargando plantillas:", err);
            } finally {
                if (isMounted) setLoading(false);
            }
        })();
        return () => {
            isMounted = false;
        };
    }, []);

    // Cargar API Key activa del tenant para auto-inyección
    useEffect(() => {
        if (isMock) {
            setActiveApiKey("mcp_live_sec_demo_finops_token");
            return;
        }
        if (!tenantId || tenantId === "default" || accounts.length === 0) return;

        (async () => {
            try {
                const token = await getFreshIdToken(instance, accounts[0]);
                const res = await fetch(`/api/admin/mcp-keys?tenantId=${tenantId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const json = await res.json();
                if (json.keys && json.keys.length > 0) {
                    setActiveApiKey(json.keys[0].key || json.keys[0].id || "mcp_key_active");
                }
            } catch {
                // Si no hay key activa, se usa placeholder descriptivo
            }
        })();
    }, [accounts, instance, isMock, tenantId]);

    const openDetail = async (id: string) => {
        try {
            const res = await fetch(`/api/templates/powerbi/${id}`);
            const json = await res.json();
            if (json.success) setSelected(json.template);
        } catch (err) {
            console.error("[PowerBiTemplates] Error obteniendo detalle:", err);
            toast.error(t("detailLoadError"));
        }
    };

    const handleQuickDownload = async (tpl: TemplateMeta) => {
        try {
            const res = await fetch(`/api/templates/powerbi/${tpl.id}`);
            const json = await res.json();
            if (json.success && json.template?.powerQueryM) {
                const raw = resolveScriptComments(json.template.powerQueryM, tc);
                const script = activeApiKey
                    ? raw.replace(/<YOUR_BASE_URL>/g, baseUrl).replace(/<YOUR_MCP_KEY>/g, activeApiKey)
                    : raw;
                downloadPqFile(tpl.id, script);
                toast.success(t("fileDownloaded", { file: `${tpl.id}.pq` }));
            } else {
                window.open(`${tpl.downloadUrl}?format=pq`, "_blank");
            }
        } catch {
            window.open(`${tpl.downloadUrl}?format=pq`, "_blank");
        }
    };

    const getCategoryBadge = (cat: string, displayName?: string) => {
        const name = displayName || (cat === "cost" ? "Cost Analytics" : cat === "sustainability" ? "ESG & Carbon" : cat === "governance" ? "Governance & Waste" : "Budgets & Forecast");
        return (
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-[#0078D4] dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                {name}
            </span>
        );
    };

    return (
        <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6 animate-in fade-in duration-300">
            {/* 1. HEADER PRINCIPAL (ANCHO 100%) */}
            <div className="w-full flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                    <div className="flex items-center gap-2">
                        <IconChartDots size={26} stroke={1.75} className="text-[#0078D4]" />
                        <h1
                            className="text-2xl font-bold tracking-tight text-[#1B2A41] dark:text-white"
                            style={{ fontFamily: 'Montserrat, "Montserrat Fallback", sans-serif' }}
                        >
                            {t("page_title")}
                        </h1>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-3xl leading-relaxed">
                        {t("page_desc")}
                    </p>
                </div>

                <div className="shrink-0">
                    <Link
                        href="/admin/mcp-keys"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0078D4] hover:text-[#0060AA] bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 px-3.5 py-2 rounded-lg transition-all shadow-2xs"
                    >
                        <IconKey size={15} className="text-[#0078D4]" />
                        <span>{t("mcp_key_hint")} {t("mcp_key_link_text")}</span>
                    </Link>
                </div>
            </div>

            {/* 2. GRID DE 4 TARJETAS DE PLANTILLAS POWER BI (GRID 2x2 - ANCHO 100%) */}
            {loading ? (
                <div className="w-full flex items-center justify-center py-20 text-slate-500 gap-2.5">
                    <IconLoader2 size={20} className="animate-spin text-[#0078D4]" />
                    <span className="text-xs font-medium">{t("loading_templates")}</span>
                </div>
            ) : (
                <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6">
                    {list.map((tpl) => (
                        <div
                            key={tpl.id}
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm hover:border-[#0078D4]/50 transition-all flex flex-col justify-between"
                        >
                            <div>
                                <div className="flex items-start justify-between gap-2 mb-2.5">
                                    <h3
                                        className="text-base font-bold text-[#1B2A41] dark:text-white"
                                        style={{ fontFamily: 'Montserrat, "Montserrat Fallback", sans-serif' }}
                                    >
                                        {tpl.name}
                                    </h3>
                                    {getCategoryBadge(tpl.category, tpl.categoryDisplayNameKey && t.has(tpl.categoryDisplayNameKey) ? t(tpl.categoryDisplayNameKey) : tpl.categoryDisplayName)}
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
                                    {tpl.descriptionKey && t.has(tpl.descriptionKey) ? t(tpl.descriptionKey) : tpl.description}
                                </p>

                                <div className="mb-6 bg-slate-50 dark:bg-slate-800/40 rounded-xl p-3.5 border border-slate-100 dark:border-slate-800/60">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1">
                                        <IconFileText size={13} className="text-[#0078D4]" />
                                        {t("suggested_visualizations")}
                                    </p>
                                    <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1 ml-1">
                                        {traducirLista(tpl.visualizationKeys, tpl.sampleVisualizations, t).slice(0, 4).map((v, i) => (
                                            <li key={i} className="flex items-center gap-1.5">
                                                <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4]" />
                                                <span>{v}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => openDetail(tpl.id)}
                                    className="bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-semibold shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer"
                                >
                                    <IconCode size={15} />
                                    <span>{t("view_script_btn")}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleQuickDownload(tpl)}
                                    className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0078D4] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700/60 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 shadow-2xs cursor-pointer"
                                    title={`Descargar archivo de consulta ${tpl.id}.pq`}
                                >
                                    <IconDownload size={15} className="text-[#0078D4]" />
                                    <span>.pq</span>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* 3. MODAL DE SCRIPT POWER QUERY M */}
            <PowerBiScriptModal
                isOpen={!!selected}
                onClose={() => setSelected(null)}
                template={selected}
                baseUrl={baseUrl}
                activeApiKey={activeApiKey}
            />
        </div>
    );
}
