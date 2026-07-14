"use client";
import React, { useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { getFreshIdToken } from "@/lib/msalToken";
import { useCurrency } from "@/components/CurrencyProvider";
import { Loader2, AlertCircle, Info, PieChart } from "lucide-react";
import { isMockTenant } from '@/lib/mockData';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

// Paleta por categoría FinOps (consistente en light/dark).
const CATEGORY_COLORS: Record<string, string> = {
    Compute: "bg-blue-500",
    Storage: "bg-emerald-500",
    Networking: "bg-violet-500",
    Databases: "bg-amber-500",
    "Management and Governance": "bg-slate-500",
    Web: "bg-cyan-500",
    Analytics: "bg-pink-500",
    "AI and Machine Learning": "bg-fuchsia-500",
    Integration: "bg-teal-500",
    Security: "bg-red-500",
    Other: "bg-gray-400",
};
const colorFor = (cat: string) => CATEGORY_COLORS[cat] || "bg-gray-400";

export default function CostByCategoryDashboard() {
    const t = useTranslations("CostByCategory");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();
    const [days] = useState(30);

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${idToken}`,
                "x-tenant-id": selectedTenant?.id ?? "",
            },
        });
        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.details || json.error || "Error");
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/intelligence/cost-by-category?tenantId=${selectedTenant.id}&days=${days}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">{t("loading")}</p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName="Costo por Categoría" />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Error</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    if (!data) return null;

    const categories: Array<{ category: string; cost: number; percent: number }> = data.categories || [];

    if (data.empty || categories.length === 0) {
        return (
            <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 p-4 rounded-lg border border-blue-100 dark:border-blue-900/50">
                <Info className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm">{data.message || t("empty")}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Total */}
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{t("totalLabel")}</div>
                    <div className="text-3xl font-bold text-gray-900 dark:text-white">{format(data.total || 0)}</div>
                </div>
                {data.topCategory && (
                    <div className="text-right">
                        <div className="text-sm text-gray-500 dark:text-gray-400">{t("topCategory")}</div>
                        <div className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 justify-end">
                            <span className={`w-3 h-3 rounded-full ${colorFor(data.topCategory)}`} />
                            {data.topCategory}
                        </div>
                    </div>
                )}
            </div>

            {/* Barra apilada 100% */}
            <div className="w-full h-4 rounded-full overflow-hidden flex bg-gray-100 dark:bg-slate-800">
                {categories.map((c) => (
                    <div
                        key={c.category}
                        className={colorFor(c.category)}
                        style={{ width: `${c.percent}%` }}
                        title={`${c.category}: ${c.percent}%`}
                    />
                ))}
            </div>

            {/* Detalle por categoría */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {categories.map((c) => (
                    <div
                        key={c.category}
                        className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900"
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-3 h-3 rounded-full shrink-0 ${colorFor(c.category)}`} />
                            <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{c.category}</span>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                            <div className="text-sm font-semibold text-gray-900 dark:text-white">{format(c.cost)}</div>
                            <div className="text-xs text-gray-400">{c.percent}%</div>
                        </div>
                    </div>
                ))}
            </div>

            <p className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                <PieChart className="w-3.5 h-3.5" /> {t("source")}
            </p>
        </div>
    );
}
