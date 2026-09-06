"use client";
import { useTranslations } from "next-intl";
import React, { useState, useMemo } from "react";
import {
    IconFileAnalytics,
    IconX,
    IconSearch,
    IconFileSpreadsheet,
    IconExternalLink,
    IconCpu,
    IconDatabase,
    IconServer,
    IconCloud
} from "@tabler/icons-react";
import { useCurrency } from "@/components/CurrencyProvider";
import type { GranularCommitmentRecommendationItem, CommitmentType, CommitmentTerm } from "@/types/commitmentComparison.types";

interface CommitmentRecommendationsDrilldownModalProps {
    isOpen: boolean;
    onClose: () => void;
    type: CommitmentType;
    term: CommitmentTerm;
    termDisplayName: string;
    totalSavingsUSD: number;
    coveragePercentage: number;
    items: GranularCommitmentRecommendationItem[];
}

function getResourceIcon(skuName: string, family: string) {
    const s = (skuName + " " + family).toLowerCase();
    if (s.includes("sql") || s.includes("mysql") || s.includes("postgres") || s.includes("database") || s.includes("cosmos")) {
        return <IconDatabase size={16} className="text-[#0078D4] dark:text-[#38BDF8] shrink-0" />;
    }
    if (s.includes("savings_plan") || s.includes("plan")) {
        return <IconCloud size={16} className="text-indigo-600 dark:text-indigo-400 shrink-0" />;
    }
    if (s.includes("host") || s.includes("server") || s.includes("app")) {
        return <IconServer size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />;
    }
    return <IconCpu size={16} className="text-[#0078D4] dark:text-[#38BDF8] shrink-0" />;
}

export default function CommitmentRecommendationsDrilldownModal({
    isOpen,
    onClose,
    type,
    termDisplayName,
    totalSavingsUSD,
    coveragePercentage,
    items,
}: CommitmentRecommendationsDrilldownModalProps) {
  const t = useTranslations("CommitmentDrilldown");
    const { format } = useCurrency();
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedSubscription, setSelectedSubscription] = useState<string>("ALL");

    const typeDisplayName = type === "RESERVATION" ? "Reservas de Instancias (RI)" : "Savings Plan";

    // Suscripciones únicas
    const subscriptions = useMemo(() => {
        const set = new Set<string>();
        items.forEach((item) => {
            if (item.subscriptionName) set.add(item.subscriptionName);
            else if (item.subscriptionId) set.add(item.subscriptionId);
        });
        return Array.from(set);
    }, [items]);

    // Filtrado en tiempo real
    const filteredItems = useMemo(() => {
        return items.filter((item) => {
            const matchesSearch =
                searchQuery === "" ||
                item.skuName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                item.region.toLowerCase().includes(searchQuery.toLowerCase()) ||
                item.resourceFamily.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (item.subscriptionName && item.subscriptionName.toLowerCase().includes(searchQuery.toLowerCase()));

            const matchesSub =
                selectedSubscription === "ALL" ||
                item.subscriptionName === selectedSubscription ||
                item.subscriptionId === selectedSubscription;

            return matchesSearch && matchesSub;
        });
    }, [items, searchQuery, selectedSubscription]);

    if (!isOpen) return null;

    const handleExportCsv = () => {
        if (!filteredItems.length) return;

        const headers = [
            "ID",
            "Tipo",
            "Termino",
            "SKU",
            "Familia",
            "Region",
            "Cantidad Sugerida / Compromiso",
            "Costo On-Demand (USD)",
            "Costo con Compromiso (USD)",
            "Ahorro Estimado (USD/mes)",
            "% Ahorro",
            "Suscripcion",
        ];

        const rows = filteredItems.map((item) => [
            item.id,
            item.type,
            item.term,
            `"${item.skuName}"`,
            `"${item.resourceFamily}"`,
            `"${item.region}"`,
            item.recommendedHourlyCommitmentUSD
                ? `"$${item.recommendedHourlyCommitmentUSD}/hr"`
                : item.recommendedQuantity,
            item.currentCostOnDemandUSD.toFixed(2),
            item.projectedCostWithCommitmentUSD.toFixed(2),
            item.estimatedMonthlySavingsUSD.toFixed(2),
            `${item.savingsPercentage}%`,
            `"${item.subscriptionName || item.subscriptionId || "Shared"}"`,
        ]);

        const csvContent =
            "data:text/csv;charset=utf-8," +
            [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute(
            "download",
            `recomendaciones_${type.toLowerCase()}_${termDisplayName.replace(/\s+/g, "_")}.csv`
        );
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-5xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] z-[100]">
                {/* ── Header ────────────────────────────────────────────────────────── */}
                <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 shrink-0">
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center">
                            <IconFileAnalytics size={22} className="text-[#0078D4] dark:text-[#38BDF8] inline mr-2 shrink-0" />
                            <span>
                                Desglose de Recomendaciones — {typeDisplayName} ({termDisplayName})
                            </span>
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Detalle granular de las {items.length} recomendaciones provistas por Azure Resource Graph y Cost Management para el término seleccionado.
                        </p>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="text-right hidden sm:block">
                            <span className="text-xs text-slate-400 block">{t("projectedSavings")}</span>
                            <span className="text-[#0078D4] dark:text-[#38BDF8] font-bold text-sm">
                                {format(totalSavingsUSD)} USD/mes
                            </span>
                        </div>
                        <button
                            onClick={onClose}
                            aria-label={t("closeModal")}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                        >
                            <IconX size={20} />
                        </button>
                    </div>
                </div>

                {/* ── Toolbar ───────────────────────────────────────────────────────── */}
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-wrap items-center justify-between gap-3 shrink-0">
                    <div className="flex items-center gap-3 flex-1 min-w-[280px]">
                        {/* Buscador */}
                        <div className="relative flex-1 max-w-md">
                            <IconSearch
                                size={16}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                            />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={t("search")}
                                className="w-full pl-9 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                            />
                        </div>

                        {/* Filtro por Suscripción */}
                        {subscriptions.length > 1 && (
                            <select
                                value={selectedSubscription}
                                onChange={(e) => setSelectedSubscription(e.target.value)}
                                className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200 font-medium focus:outline-none focus:ring-2 focus:ring-[#0078D4] cursor-pointer"
                            >
                                <option value="ALL">Todas las suscripciones ({subscriptions.length})</option>
                                {subscriptions.map((sub) => (
                                    <option key={sub} value={sub}>
                                        {sub}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>

                    {/* Botón Exportar CSV */}
                    <button
                        onClick={handleExportCsv}
                        disabled={filteredItems.length === 0}
                        className="inline-flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                        <IconFileSpreadsheet size={15} className="text-[#0078D4] dark:text-[#38BDF8]" />
                        <span>Exportar CSV</span>
                    </button>
                </div>

                {/* ── Table Container ───────────────────────────────────────────────── */}
                <div className="overflow-x-auto overflow-y-auto flex-1 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600">
                    {filteredItems.length === 0 ? (
                        <div className="py-16 text-center text-slate-400 dark:text-slate-500 text-sm">
                            {t("empty")}
                        </div>
                    ) : (
                        <table className="w-full text-left text-xs border-collapse">
                            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90 backdrop-blur-xs text-slate-700 dark:text-slate-200 font-semibold border-b border-slate-200 dark:border-slate-800 z-10">
                                <tr>
                                    <th className="py-3 px-4">{t("colSku")}</th>
                                    <th className="py-3 px-4">{t("colRegion")}</th>
                                    <th className="py-3 px-4 text-center">{t("colCommitment")}</th>
                                    <th className="py-3 px-4 text-right">{t("colOnDemand")}</th>
                                    <th className="py-3 px-4 text-right">{t("colCommitted")}</th>
                                    <th className="py-3 px-4 text-right">{t("colSavings")}</th>
                                    <th className="py-3 px-4">{t("colSubscription")}</th>
                                    <th className="py-3 px-4 text-center">{t("colAction")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {filteredItems.map((item, idx) => (
                                    <tr
                                        key={item.id || idx}
                                        className="hover:bg-blue-50/30 dark:hover:bg-slate-800/40 transition-colors"
                                    >
                                        {/* SKU / Familia */}
                                        <td className="py-3 px-4 font-medium text-slate-900 dark:text-white">
                                            <div className="flex items-center gap-2">
                                                {getResourceIcon(item.skuName, item.resourceFamily)}
                                                <div>
                                                    <span className="font-semibold text-slate-900 dark:text-white block">
                                                        {item.skuName}
                                                    </span>
                                                    <span className="text-[11px] text-slate-400 dark:text-slate-500">
                                                        {item.resourceFamily}
                                                    </span>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Región */}
                                        <td className="py-3 px-4 whitespace-nowrap">
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                                {item.region}
                                            </span>
                                        </td>

                                        {/* Cantidad / Compromiso */}
                                        <td className="py-3 px-4 text-center font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                                            {item.recommendedHourlyCommitmentUSD ? (
                                                <span className="text-[#0078D4] dark:text-[#38BDF8]">
                                                    ${item.recommendedHourlyCommitmentUSD.toFixed(4)}/hr
                                                </span>
                                            ) : (
                                                <span>{item.recommendedQuantity} {item.recommendedQuantity === 1 ? 'instancia' : 'instancias'}</span>
                                            )}
                                        </td>

                                        {/* Costo On-Demand */}
                                        <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-400 whitespace-nowrap font-mono">
                                            {format(item.currentCostOnDemandUSD)}
                                        </td>

                                        {/* Costo con Compromiso */}
                                        <td className="py-3 px-4 text-right text-slate-900 dark:text-white whitespace-nowrap font-mono font-semibold">
                                            {format(item.projectedCostWithCommitmentUSD)}
                                        </td>

                                        {/* Ahorro Estimado */}
                                        <td className="py-3 px-4 text-right whitespace-nowrap">
                                            <span className="text-[#0078D4] dark:text-[#38BDF8] font-bold block">
                                                +{format(item.estimatedMonthlySavingsUSD)}/mes
                                            </span>
                                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                                                (-{item.savingsPercentage}%)
                                            </span>
                                        </td>

                                        {/* Suscripción */}
                                        <td className="py-3 px-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                            <span className="truncate max-w-[150px] inline-block align-bottom" title={item.subscriptionName || item.subscriptionId}>
                                                {item.subscriptionName || item.subscriptionId || "Shared"}
                                            </span>
                                        </td>

                                        {/* Acción */}
                                        <td className="py-3 px-4 text-center whitespace-nowrap">
                                            <a
                                                href="https://portal.azure.com/#blade/Microsoft_Azure_Reservations/CreateBlade"
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-1 text-xs text-[#0078D4] dark:text-[#38BDF8] hover:underline font-semibold"
                                            >
                                                <span>Portal Azure</span>
                                                <IconExternalLink size={13} />
                                            </a>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* ── Footer ────────────────────────────────────────────────────────── */}
                <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 flex items-center justify-between shrink-0">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                        Evaluadas <strong className="text-slate-800 dark:text-white">{filteredItems.length}</strong> de {items.length} recomendaciones · Cobertura proyectada: <strong className="text-slate-800 dark:text-white">{coveragePercentage.toFixed(1)}%</strong>
                    </div>

                    <button
                        onClick={onClose}
                        className="bg-slate-800 dark:bg-slate-700 text-white hover:bg-slate-900 dark:hover:bg-slate-600 px-5 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors shadow-xs"
                    >
                        {t("closeWindow")}
                    </button>
                </div>
            </div>
        </div>
    );
}
