"use client";

import React, { useState } from "react";
import {
    IconX,
    IconCopy,
    IconCheck,
    IconDownload,
    IconSparkles,
    IconFileCode,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { resolveScriptComments } from "@/lib/scriptComments";
import { downloadPqFile } from "@/lib/export/downloadPqFile";
import { toast } from "sonner";

interface PowerBiScriptModalProps {
    isOpen: boolean;
    onClose: () => void;
    template: {
        id: string;
        name: string;
        description: string;
        descriptionKey?: string;
        category: string;
        categoryDisplayName?: string;
        categoryDisplayNameKey?: string;
        sampleVisualizations: string[];
        visualizationKeys?: string[];
        powerQueryM: string;
    } | null;
    baseUrl: string;
    activeApiKey: string;
}

function maskKey(key: string): string {
    if (!key) return "mcp_demo_key_...";
    if (key.length <= 8) return key;
    return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

export default function PowerBiScriptModal({
    isOpen,
    onClose,
    template,
    baseUrl,
    activeApiKey,
}: PowerBiScriptModalProps) {
    const t = useTranslations("PowerBITemplates");
    const tc = useTranslations("ScriptComments");
    const [autoInject, setAutoInject] = useState(true);
    const [copied, setCopied] = useState(false);

    if (!isOpen || !template) return null;

    const keyToUse = activeApiKey || "mcp_YOUR_API_KEY_HERE";
    // Los comentarios viajan como marcadores y se resuelven siempre, inyecte o
    // no las credenciales: antes salian en castellano sobre la UI en ingles.
    const baseScript = resolveScriptComments(template.powerQueryM, tc);
    const processedScript = autoInject
        ? baseScript
              .replace(/<YOUR_BASE_URL>/g, baseUrl)
              .replace(/<YOUR_MCP_KEY>/g, keyToUse)
        : baseScript;

    const handleCopy = () => {
        navigator.clipboard.writeText(processedScript);
        setCopied(true);
        toast.success(t("scriptCopied"));
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownload = () => {
        downloadPqFile(template.id, processedScript);
        toast.success(t("fileDownloaded", { file: `${template.id}.pq` }));
    };

    const categoryName =
        (template.categoryDisplayNameKey && t.has(template.categoryDisplayNameKey)
            ? t(template.categoryDisplayNameKey)
            : undefined) ||
        template.categoryDisplayName ||
        (template.category === "cost"
            ? "Cost Analytics"
            : template.category === "sustainability"
            ? "ESG & Carbon"
            : template.category === "governance"
            ? "Governance & Waste"
            : "Budgets & Forecast");

    return (
        <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-4 bg-slate-50/50 dark:bg-slate-800/40">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <IconFileCode size={22} className="text-[#0078D4]" />
                            <h2
                                className="text-lg font-bold text-[#1B2A41] dark:text-white"
                                style={{ fontFamily: 'Montserrat, "Montserrat Fallback", sans-serif' }}
                            >
                                {template.name}
                            </h2>
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-[#0078D4] dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                {categoryName}
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            {template.descriptionKey && t.has(template.descriptionKey) ? t(template.descriptionKey) : template.description}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        <IconX size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
                    {/* Visualizaciones Recomendadas */}
                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                            {t("recommended_visualizations")}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {(template.visualizationKeys && template.visualizationKeys.length === template.sampleVisualizations.length
                                ? template.visualizationKeys.map((k, i) => (t.has(k) ? t(k) : template.sampleVisualizations[i]))
                                : template.sampleVisualizations
                            ).map((v, i) => (
                                <span
                                    key={i}
                                    className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-medium border border-slate-200 dark:border-slate-700"
                                >
                                    {v}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Barra de Control de Auto-Inyección y Acciones */}
                    <div className="bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                        <label className="flex items-center gap-2.5 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={autoInject}
                                onChange={(e) => setAutoInject(e.target.checked)}
                                className="w-4 h-4 text-[#0078D4] rounded border-slate-300 focus:ring-[#0078D4] cursor-pointer"
                            />
                            <div>
                                <span className="text-xs font-bold text-[#1B2A41] dark:text-blue-200">
                                    {t("auto_inject_label")}
                                </span>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    {autoInject
                                        ? `${t("auto_inject_hint")} (URL: ${baseUrl}, Key: ${maskKey(activeApiKey)})`
                                        : t("manualReplaceHint")}
                                </p>
                            </div>
                        </label>

                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                type="button"
                                onClick={handleCopy}
                                className="flex items-center gap-1.5 text-xs font-semibold text-[#0078D4] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-slate-800 px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 shadow-2xs transition-all cursor-pointer"
                            >
                                {copied ? <IconCheck size={14} className="text-emerald-500" /> : <IconCopy size={14} />}
                                <span>{copied ? t("copied") : t("copy")}</span>
                            </button>

                            <button
                                type="button"
                                onClick={handleDownload}
                                className="flex items-center gap-1.5 text-xs font-semibold text-white bg-[#0078D4] hover:bg-[#0060AA] px-3 py-1.5 rounded-lg shadow-2xs transition-all cursor-pointer"
                                title="Descargar archivo .pq"
                            >
                                <IconDownload size={14} />
                                <span>{t("download_pq")}</span>
                            </button>
                        </div>
                    </div>

                    {/* Caja de Código Power Query M con Scrollbars macOS */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                {t("power_query_m_label")}
                            </span>
                        </div>
                        <pre className="bg-slate-950 text-slate-100 rounded-xl p-4 text-xs font-mono border border-slate-800 overflow-x-auto max-h-80 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-track]:bg-slate-900 leading-relaxed shadow-inner">
                            {processedScript}
                        </pre>
                    </div>

                    {/* Pasos para Conectar */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 rounded-xl p-4 text-xs">
                        <h4 className="font-bold text-[#1B2A41] dark:text-slate-200 mb-2 flex items-center gap-1.5">
                            <IconSparkles size={16} className="text-[#0078D4]" />
                            {t("steps_title")}
                        </h4>
                        <ol className="list-decimal ml-4 space-y-1.5 text-slate-600 dark:text-slate-300">
                            <li>{t("step1")}</li>
                            <li>{t("step2")}</li>
                            <li>{t("step3")}</li>
                            <li>{t("step4")}</li>
                        </ol>
                    </div>
                </div>
            </div>
        </div>
    );
}
