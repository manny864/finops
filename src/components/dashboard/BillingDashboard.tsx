"use client";
import React, { useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import { getFreshIdToken } from "@/lib/msalToken";
import { useCurrency } from "@/components/CurrencyProvider";
import { Loader2, AlertCircle } from "lucide-react";
import { isMockTenant } from '@/lib/mockData';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import CostByCategoryDashboard from "./CostByCategoryDashboard";
import RealConsumptionDashboard from "./RealConsumptionDashboard";

export default function BillingDashboard({
    initialTab = "real",
    hideTabs = false,
}: {
    initialTab?: "real" | "category" | "environmental";
    hideTabs?: boolean;
}) {
    const t = useProviderTranslations("Billing");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();
    const [days] = useState(new Date().getDate());
    const [activeTab, setActiveTab] = useState<"real" | "category" | "environmental">(initialTab);

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
            throw new Error(json.details || json.error || t("genericError"));
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant?.id ? `/api/intelligence/billing?days=${days}&tenantId=${selectedTenant.id}` : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    if (error) {
        const tierError = parseTierRequiredError(error.message);
        if (tierError) {
            return <TierLockedNotice requiredTier={tierError} />;
        }
        return (
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <AlertCircle className="w-5 h-5" />
                <div>
                    <div className="font-semibold">{t("error")}</div>
                    <div className="text-sm">{error.message}</div>
                </div>
            </div>
        );
    }

    const isMock = selectedTenant?.id ? isMockTenant(selectedTenant.id) : false;

    return (
        <div className="space-y-6">
            {isMock && (
                <div className="flex items-center gap-2 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-700 dark:text-amber-300">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{t("mockData")}</span>
                </div>
            )}

            {!hideTabs && (
                <div className="flex border-b border-gray-200 dark:border-slate-700 gap-6">
                    <button
                        onClick={() => setActiveTab("real")}
                        className={`pb-3 px-1 font-medium transition-colors ${
                            activeTab === "real"
                                ? "border-b-2 border-blue-600 text-blue-600 dark:text-blue-400"
                                : "text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200"
                        }`}
                    >
                        {t("tabs.real")}
                    </button>
                    <button
                        onClick={() => setActiveTab("category")}
                        className={`pb-3 px-1 font-medium transition-colors ${
                            activeTab === "category"
                                ? "border-b-2 border-blue-600 text-blue-600 dark:text-blue-400"
                                : "text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200"
                        }`}
                    >
                        {t("tabs.category")}
                    </button>
                    <button
                        onClick={() => setActiveTab("environmental")}
                        className={`pb-3 px-1 font-medium transition-colors ${
                            activeTab === "environmental"
                                ? "border-b-2 border-blue-600 text-blue-600 dark:text-blue-400"
                                : "text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200"
                        }`}
                    >
                        {t("tabs.environmental")}
                    </button>
                </div>
            )}

            {/* Tab Content */}
            <div className="mt-6">
                {isLoading ? (
                    <div className="flex items-center justify-center gap-2 text-gray-600 dark:text-slate-400 py-8">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>{t("loading")}</span>
                    </div>
                ) : activeTab === "real" ? (
                    <RealConsumptionDashboard />
                ) : activeTab === "category" ? (
                    <CostByCategoryDashboard />
                ) : (
                    <div className="space-y-4">
                        <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                            <div className="text-sm text-gray-600 dark:text-slate-400">{t("environmental.title")}</div>
                            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
                                {Number(data?.environmentalImpact || 0).toFixed(2)} kg CO2e
                            </div>
                            <div className="text-sm text-gray-600 dark:text-slate-400 mt-1">
                                {data?.environmentalImpactSource === "avoided"
                                    ? t("environmental.sourceAvoided")
                                    : data?.environmentalImpactSource === "footprint"
                                        ? t("environmental.sourceFootprint")
                                        : t("environmental.sourceNone")}
                            </div>
                        </div>
                        {Array.isArray(data?.byRegion) && data.byRegion.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {data.byRegion.slice(0, 4).map((item: any) => (
                                    <div key={item.region} className="p-4 border border-gray-200 dark:border-slate-700 rounded-lg">
                                        <div className="text-sm text-gray-600 dark:text-slate-400">{item.region}</div>
                                        <div className="text-lg font-semibold text-gray-900 dark:text-white mt-2">
                                            {Number(item.kgCO2e || 0).toFixed(2)} kg CO2e
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
