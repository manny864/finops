"use client";
import { useTranslations } from "next-intl";
import React, { useState, useMemo } from "react";
import { useLocale } from "next-intl";
import Link from "next/link";
import {
    IconChecklist,
    IconX,
    IconSearch,
    IconFileSpreadsheet,
    IconExternalLink,
    IconArrowUpRight,
    IconFlame,
    IconCheck,
    IconClock,
    IconShield,
    IconCurrencyDollar,
    IconHeartRateMonitor,
    IconGauge,
    IconSettings,
    IconChevronLeft,
    IconChevronRight,
    IconFilter,
} from "@tabler/icons-react";
import type { CoinRecommendationItem } from "@/lib/coinTypes";

const CATEGORY_COLORS: Record<string, string> = {
    Cost: "#0054A6",
    Security: "#EF4444",
    Reliability: "#F59E0B",
    HighAvailability: "#F59E0B",
    Performance: "#8B5CF6",
    OperationalExcellence: "#00AEEF",
    "Operational Excellence": "#00AEEF",
};

const CATEGORY_LABELS: Record<string, string> = {
    Cost: "Cost Optimization",
    Security: "Security & Compliance",
    Reliability: "Reliability & HA",
    HighAvailability: "Reliability & HA",
    Performance: "Performance",
    OperationalExcellence: "Operational Excellence",
    "Operational Excellence": "Operational Excellence",
};

function getCategoryIcon(cat: string) {
    const c = (cat || "").toLowerCase();
    if (c.includes("cost")) return <IconCurrencyDollar size={14} className="shrink-0" />;
    if (c.includes("sec")) return <IconShield size={14} className="shrink-0" />;
    if (c.includes("rel") || c.includes("avail")) return <IconHeartRateMonitor size={14} className="shrink-0" />;
    if (c.includes("perf")) return <IconGauge size={14} className="shrink-0" />;
    return <IconSettings size={14} className="shrink-0" />;
}

interface CoinRecommendationsModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialStatusFilter?: "ALL" | "pending" | "accepted" | "implemented" | "snoozed" | "dismissed";
    initialCategoryFilter?: string;
    recommendations: CoinRecommendationItem[];
    totalPotentialSavingsUsd?: number;
    realizedSavingsUsd?: number;
}

export default function CoinRecommendationsModal({
    isOpen,
    onClose,
    initialStatusFilter = "ALL",
    initialCategoryFilter = "ALL",
    recommendations = [],
    totalPotentialSavingsUsd = 0,
    realizedSavingsUsd = 0,
}: CoinRecommendationsModalProps) {
  const t = useTranslations("CoinRecommendations");
    const locale = useLocale();
    const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter);
    const [categoryFilter, setCategoryFilter] = useState<string>(initialCategoryFilter);
    const [searchQuery, setSearchQuery] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    // Reiniciar filtro si cambia al abrir
    React.useEffect(() => {
        if (isOpen) {
            setStatusFilter(initialStatusFilter);
            setCategoryFilter(initialCategoryFilter);
            setCurrentPage(1);
            setSearchQuery("");
        }
    }, [isOpen, initialStatusFilter, initialCategoryFilter]);

    const countsByStatus = useMemo(() => {
        const counts = { ALL: recommendations.length, pending: 0, accepted: 0, implemented: 0, snoozed: 0, dismissed: 0 };
        for (const r of recommendations) {
            if (r.status in counts) {
                counts[r.status as keyof typeof counts]++;
            }
        }
        return counts;
    }, [recommendations]);

    const countsByCategory = useMemo(() => {
        const counts: Record<string, number> = { ALL: recommendations.length };
        for (const r of recommendations) {
            counts[r.category] = (counts[r.category] || 0) + 1;
        }
        return counts;
    }, [recommendations]);

    // Filtrado en tiempo real
    const filteredItems = useMemo(() => {
        return recommendations.filter((item) => {
            const matchesStatus = statusFilter === "ALL" || item.status === statusFilter;
            const matchesCategory =
                categoryFilter === "ALL" ||
                item.category === categoryFilter ||
                (categoryFilter === "Reliability" && (item.category === "HighAvailability" || item.category === "Reliability")) ||
                (categoryFilter === "OperationalExcellence" && (item.category === "OperationalExcellence" || item.category === "Operational Excellence"));

            const query = searchQuery.trim().toLowerCase();
            const matchesSearch =
                query === "" ||
                item.name.toLowerCase().includes(query) ||
                (item.description && item.description.toLowerCase().includes(query)) ||
                item.impactedResource.toLowerCase().includes(query) ||
                (item.resourceGroup && item.resourceGroup.toLowerCase().includes(query)) ||
                (item.subscriptionName && item.subscriptionName.toLowerCase().includes(query)) ||
                item.id.toLowerCase().includes(query);

            return matchesStatus && matchesCategory && matchesSearch;
        });
    }, [recommendations, statusFilter, categoryFilter, searchQuery]);

    // Paginación
    const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
    const paginatedItems = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredItems.slice(start, start + pageSize);
    }, [filteredItems, currentPage, pageSize]);

    const getLocalizedHref = (targetUrl?: string) => {
        const base = targetUrl || "/governance/advisor";
        const path = base.startsWith("/") ? base : `/${base}`;
        if (path.startsWith(`/${locale}/`)) return path;
        return `/${locale}${path}`;
    };

    if (!isOpen) return null;

    const handleExportCsv = () => {
        if (!filteredItems.length) return;

        const headers = [
            t("csvId"),
            t("csvRecommendation"),
            t("csvCategory"),
            t("csvImpact"),
            t("csvResource"),
            t("csvResourceGroup"),
            t("csvSubscription"),
            t("csvSavings"),
            t("csvStatus"),
            t("csvSnoozedUntil"),
            t("csvModule"),
        ];

        const rows = filteredItems.map((r) => [
            `"${r.id}"`,
            `"${(r.name || "").replace(/"/g, '""')}"`,
            `"${CATEGORY_LABELS[r.category] || r.category}"`,
            `"${r.impact || "Medium"}"`,
            `"${(r.impactedResource || "").replace(/"/g, '""')}"`,
            `"${(r.resourceGroup || "").replace(/"/g, '""')}"`,
            `"${(r.subscriptionName || "").replace(/"/g, '""')}"`,
            r.estimatedMonthlySavingsUsd || 0,
            `"${r.status}"`,
            `"${r.snoozedUntil || ""}"`,
            `"${r.targetModuleUrl || ""}"`,
        ]);

        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Recomendaciones_COIN_${statusFilter}_${categoryFilter}_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-8 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden text-slate-800 dark:text-slate-100">
                {/* Header Modal */}
                <div className="flex items-center justify-between p-5 md:px-7 md:py-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/80">
                    <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-[#0054A6] dark:text-[#38BDF8] border border-blue-200 dark:border-blue-800/50 flex items-center justify-center shrink-0">
                            <IconChecklist className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-lg font-bold text-[#1B2A41] dark:text-white">
                                    {t("title")}
                                </h3>
                                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-blue-100 dark:bg-blue-950/50 text-[#0054A6] dark:text-cyan-400 border border-blue-200 dark:border-blue-800/50">
                                    {t("countBadge", { shown: filteredItems.length, total: recommendations.length })}
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                {t("subtitle")}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleExportCsv}
                            disabled={filteredItems.length === 0}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-all shadow-sm"
                            title={t("downloadCsv")}
                        >
                            <IconFileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            <span className="hidden sm:inline">{t("exportCsv")}</span>
                        </button>
                        <button
                            onClick={onClose}
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                            <IconX className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Barra de Filtros de Estado (Funnel Tabs) */}
                <div className="p-4 md:px-7 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
                    {/* Tabs de Estado */}
                    <div className="flex flex-wrap items-center gap-1.5">
                        {[
                            { key: "ALL", label: t("filterAll"), count: countsByStatus.ALL, color: "text-slate-700 dark:text-slate-200" },
                            { key: "pending", label: t("filterPending"), count: countsByStatus.pending, color: "text-amber-600 dark:text-amber-400" },
                            { key: "accepted", label: t("filterAccepted"), count: countsByStatus.accepted, color: "text-blue-600 dark:text-blue-400" },
                            { key: "implemented", label: t("filterImplemented"), count: countsByStatus.implemented, color: "text-emerald-600 dark:text-emerald-400" },
                            { key: "snoozed", label: t("filterSnoozed"), count: countsByStatus.snoozed, color: "text-slate-500 dark:text-slate-400" },
                            { key: "dismissed", label: t("filterDismissed"), count: countsByStatus.dismissed, color: "text-slate-400 dark:text-slate-500" },
                        ].map((tab) => (
                            <button
                                key={tab.key}
                                onClick={() => {
                                    setStatusFilter(tab.key);
                                    setCurrentPage(1);
                                }}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                    statusFilter === tab.key
                                        ? "bg-white dark:bg-slate-800 border-[#0054A6] text-[#0054A6] dark:text-cyan-400 shadow-sm ring-1 ring-[#0054A6]/20"
                                        : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                                }`}
                            >
                                <span>{tab.label}</span>
                                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black bg-slate-100 dark:bg-slate-800 ${tab.color}`}>
                                    {tab.count}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Buscador Rápido */}
                    <div className="relative w-full sm:w-64">
                        <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                        <input
                            type="text"
                            placeholder={t("search")}
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="w-full pl-9 pr-3 py-1.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0054A6] transition-all"
                        />
                    </div>
                </div>

                {/* Filtro por Categoría WAF */}
                <div className="px-4 py-2.5 md:px-7 border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/40 dark:bg-slate-900/40 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
                        <IconFilter size={13} /> {t("colPillar")}:
                    </span>
                    {[
                        { key: "ALL", label: t("allPillars") },
                        { key: "Cost", label: "Cost Optimization" },
                        { key: "Security", label: "Security & Compliance" },
                        { key: "Reliability", label: "Reliability & HA" },
                        { key: "Performance", label: "Performance" },
                        { key: "OperationalExcellence", label: "Operational Excellence" },
                    ].map((cat) => {
                        const isSelected = categoryFilter === cat.key;
                        const catColor = CATEGORY_COLORS[cat.key] || "#0054A6";
                        return (
                            <button
                                key={cat.key}
                                onClick={() => {
                                    setCategoryFilter(cat.key);
                                    setCurrentPage(1);
                                }}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1 border ${
                                    isSelected
                                        ? "bg-white dark:bg-slate-800 border-slate-400 dark:border-slate-600 text-slate-900 dark:text-white font-bold shadow-sm ring-1 ring-slate-400/20"
                                        : "bg-transparent border-transparent text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                                }`}
                            >
                                {cat.key !== "ALL" && (
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: catColor }} />
                                )}
                                <span>{cat.label}</span>
                                {cat.key !== "ALL" && countsByCategory[cat.key] !== undefined && (
                                    <span className="text-[10px] opacity-75">({countsByCategory[cat.key]})</span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Tabla de Recomendaciones */}
                <div className="flex-1 overflow-y-auto overflow-x-auto min-h-[320px]">
                    <table className="w-full text-left text-xs border-collapse">
                        {/* Aca decia un paso 850 de slate, que NO EXISTE: la escala de Tailwind salta de 800 a 900
                            y el proyecto no define un 850 en su @theme. Tailwind no generaba
                            nada, asi que en oscuro quedaba el `bg-slate-50` del tema claro y la
                            barra de columnas salia BLANCA sobre la tabla oscura.

                            Es la misma trampa que el `\b` del barrido de modo oscuro: una clase
                            que se lee bien y no hace nada. Sin error, sin warning.

                            slate-800/90 + backdrop-blur es la convencion de los thead STICKY del
                            repo (2 de 3, y es lo que usa el modal hermano de commitments). La
                            opacidad alta importa aca: con /50 --que es lo mas comun en los thead
                            NO sticky-- las filas se ven pasar por debajo del encabezado. */}
                        <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90 backdrop-blur-xs z-10 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider text-[11px]">
                            <tr>
                                <th className="py-3 px-4 md:px-6">{t("colRecommendation")}</th>
                                <th className="py-3 px-3">{t("colPillar")}</th>
                                <th className="py-3 px-3">{t("colResource")}</th>
                                <th className="py-3 px-3 text-right">{t("colSavings")}</th>
                                <th className="py-3 px-3 text-center">{t("colStatus")}</th>
                                <th className="py-3 px-4 md:px-6 text-right">{t("colAction")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                            {paginatedItems.length > 0 ? (
                                paginatedItems.map((rec) => {
                                    const catColor = CATEGORY_COLORS[rec.category] || "#0054A6";
                                    const catLabel = CATEGORY_LABELS[rec.category] || rec.category;

                                    return (
                                        <tr
                                            key={rec.id}
                                            className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                                        >
                                            {/* Recomendación y Descripción */}
                                            <td className="py-3.5 px-4 md:px-6 max-w-xs md:max-w-md">
                                                <div className="font-bold text-[#1B2A41] dark:text-white leading-snug">
                                                    {rec.name}
                                                </div>
                                                {rec.description && (
                                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                                                        {rec.description}
                                                    </div>
                                                )}
                                                {rec.impact && (
                                                    <div className="mt-1 flex items-center gap-1.5">
                                                        <span
                                                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                                                rec.impact === "High"
                                                                    ? "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300"
                                                                    : rec.impact === "Medium"
                                                                    ? "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300"
                                                                    : "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300"
                                                            }`}
                                                        >
                                                            {t("impactLabel", { level: rec.impact })}
                                                        </span>
                                                        {rec.snoozedUntil && (
                                                            <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                                                Reabre: {rec.snoozedUntil.slice(0, 10)}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </td>

                                            {/* Pilar WAF Badge */}
                                            <td className="py-3.5 px-3 whitespace-nowrap">
                                                <span
                                                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border"
                                                    style={{
                                                        backgroundColor: `${catColor}15`,
                                                        borderColor: `${catColor}35`,
                                                        color: catColor,
                                                    }}
                                                >
                                                    {getCategoryIcon(rec.category)}
                                                    {catLabel}
                                                </span>
                                            </td>

                                            {/* Recurso / RG / Suscripción */}
                                            <td className="py-3.5 px-3">
                                                <div className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[200px]" title={rec.impactedResource}>
                                                    {rec.impactedResource}
                                                </div>
                                                {(rec.resourceGroup || rec.subscriptionName) && (
                                                    <div className="text-[10px] text-slate-400 truncate max-w-[200px]">
                                                        {rec.resourceGroup && <span>{rec.resourceGroup}</span>}
                                                        {rec.resourceGroup && rec.subscriptionName && <span> • </span>}
                                                        {rec.subscriptionName && <span>{rec.subscriptionName}</span>}
                                                    </div>
                                                )}
                                            </td>

                                            {/* Ahorro Estimado */}
                                            <td className="py-3.5 px-3 text-right whitespace-nowrap">
                                                {rec.estimatedMonthlySavingsUsd > 0 ? (
                                                    <span className="font-black text-emerald-600 dark:text-emerald-400">
                                                        ${rec.estimatedMonthlySavingsUsd.toFixed(2)} {t("usdPerMonth")}
                                                    </span>
                                                ) : (
                                                    <span className="text-[11px] text-slate-400 font-semibold">
                                                        {t("wafProtection")}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Estado Badge */}
                                            <td className="py-3.5 px-3 text-center whitespace-nowrap">
                                                {rec.status === "implemented" ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40">
                                                        <IconCheck size={11} /> {t("statusImplemented")}
                                                    </span>
                                                ) : rec.status === "accepted" ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/40">
                                                        <IconClock size={11} /> {t("statusAccepted")}
                                                    </span>
                                                ) : rec.status === "snoozed" ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                                        <IconClock size={11} /> {t("statusSnoozed")}
                                                    </span>
                                                ) : rec.status === "dismissed" ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                                        <IconX size={11} /> {t("statusDismissed")}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40">
                                                        <IconFlame size={11} /> {t("statusPending")}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Acción / Enlace */}
                                            <td className="py-3.5 px-4 md:px-6 text-right whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    {rec.portalUrl && (
                                                        <a
                                                            href={rec.portalUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                                            title={t("viewInPortal")}
                                                        >
                                                            <IconExternalLink size={15} />
                                                        </a>
                                                    )}
                                                    <Link
                                                        href={getLocalizedHref(rec.targetModuleUrl || `/governance/advisor?category=${rec.category}`)}
                                                        onClick={onClose}
                                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-blue-50 dark:bg-slate-800 text-[#0054A6] dark:text-cyan-400 border border-[#0054A6]/30 dark:border-cyan-500/30 hover:bg-blue-100 dark:hover:bg-slate-700 transition-all shadow-xs"
                                                    >
                                                        <span>{t("viewModule")}</span>
                                                        <IconArrowUpRight size={13} />
                                                    </Link>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan={6} className="py-16 text-center text-slate-400">
                                        <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto mb-2.5">
                                            <IconChecklist className="w-6 h-6" />
                                        </div>
                                        <p className="font-semibold text-sm text-slate-600 dark:text-slate-300">
                                            {t("empty")}
                                        </p>
                                        <p className="text-xs text-slate-400 mt-1">
                                            {t("emptyHint")}
                                        </p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Footer Paginación */}
                <div className="p-4 md:px-7 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                        <span>{t("showLabel")}</span>
                        <select
                            value={pageSize}
                            onChange={(e) => {
                                setPageSize(Number(e.target.value));
                                setCurrentPage(1);
                            }}
                            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none"
                        >
                            <option value={10}>{t("perPage10")}</option>
                            <option value={25}>{t("perPage25")}</option>
                            <option value={50}>{t("perPage50")}</option>
                        </select>
                        <span className="hidden md:inline text-slate-400">|</span>
                        <span>
                            {t("showingRange", {
                                from: filteredItems.length > 0 ? (currentPage - 1) * pageSize + 1 : 0,
                                to: Math.min(currentPage * pageSize, filteredItems.length),
                                total: filteredItems.length,
                            })}
                        </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all font-semibold flex items-center gap-1"
                        >
                            <IconChevronLeft size={14} /> {t("prev")}
                        </button>
                        <span className="px-3 py-1 font-bold text-slate-700 dark:text-slate-200">
                            {t("pageOf", { current: currentPage, total: totalPages })}
                        </span>
                        <button
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all font-semibold flex items-center gap-1"
                        >
                            {t("next")} <IconChevronRight size={14} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
