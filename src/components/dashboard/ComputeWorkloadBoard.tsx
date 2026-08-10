"use client";

import React, { useEffect, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import MockBanner from "@/components/MockBanner";
import { DollarSign, Layers, Activity } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
    ComputeFamily,
    ComputeWorkloadApiResponse,
    ComputeWorkloadItemBase,
} from "@/lib/computeWorkloadTypes";

export default function ComputeWorkloadBoard({
    family,
    title,
    subtitle,
    icon,
    emptyTitle,
    emptyMessage,
}: {
    family: ComputeFamily;
    title: string;
    subtitle: string;
    icon?: React.ReactNode;
    emptyTitle: string;
    emptyMessage: string;
}) {
    const t = useTranslations("ComputeHub");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<ComputeWorkloadApiResponse["data"] | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        if (
            selectedTenant.id === "default" ||
            (accounts.length === 0 && !isMockTenant(selectedTenant.id))
        ) {
            setLoading(false);
            setData(null);
            setMessage(null);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const headers: HeadersInit = {};
                if (!isMockTenant(selectedTenant.id) && accounts.length > 0) {
                    const idToken = await getFreshIdToken(instance, accounts[0]);
                    headers.Authorization = "Bearer " + idToken;
                }
                const url = new URL("/api/intelligence/compute/workloads", window.location.origin);
                url.searchParams.set("tenantId", selectedTenant.id);
                url.searchParams.set("family", family);
                const response = await fetch(url.toString(), { headers });
                const json = (await response.json()) as ComputeWorkloadApiResponse;
                if (cancelled) return;
                setData(json?.data || null);
                setMessage(json?.message || null);
            } catch {
                if (!cancelled) {
                    setData(null);
                    setMessage(emptyMessage);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedTenant.id, accounts.length, instance, family, emptyMessage]);

    if (selectedTenant.id === "default") return null;
    if (loading) return <div className="p-6 max-w-6xl mx-auto text-gray-500">{t("loading")}</div>;

    const items: ComputeWorkloadItemBase[] = data?.items || [];
    const totalMonthlyCost = Number(data?.summary?.totalMonthlyCostUsd || 0);
    const resourceCount = Number(data?.summary?.resourceCount || 0);
    const advisorRecommendations = Number(data?.summary?.advisorRecommendations || 0);

    return (
        <div className="p-6 max-w-6xl mx-auto animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-6">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
                    {icon}
                    {title}
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">{subtitle}</p>
            </div>

            {items.length === 0 ? (
                <div className="rounded-2xl border border-gray-200 bg-white px-8 py-12 text-center shadow-sm">
                    <p className="text-lg font-semibold text-gray-900">{emptyTitle}</p>
                    <p className="mt-2 text-gray-500">{message || emptyMessage}</p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                <DollarSign className="w-4 h-4" /> {t("kpiTotalMonthlyCost")}
                            </div>
                            <div className="text-2xl font-black text-gray-900 dark:text-white">${totalMonthlyCost.toLocaleString()}</div>
                        </div>
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                <Layers className="w-4 h-4" /> {t("kpiResourcesDetected")}
                            </div>
                            <div className="text-2xl font-black text-gray-900 dark:text-white">{resourceCount}</div>
                        </div>
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                <Activity className="w-4 h-4" /> {t("kpiAdvisorRecommendations")}
                            </div>
                            <div className="text-2xl font-black text-gray-900 dark:text-white">{advisorRecommendations}</div>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr>
                                    <th className="py-3 px-4 border-b border-gray-200 font-bold text-xs text-gray-500 uppercase">{t("colResource")}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 font-bold text-xs text-gray-500 uppercase">{t("colRegion")}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 font-bold text-xs text-gray-500 uppercase">{t("colState")}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 font-bold text-xs text-gray-500 uppercase">{t("colSku")}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 font-bold text-xs text-gray-500 uppercase">{t("colMetricA")}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 font-bold text-xs text-gray-500 uppercase">{t("colMetricB")}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 font-bold text-xs text-gray-500 uppercase text-right">{t("colMonthlyCost")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item) => (
                                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="py-3 px-4 border-b border-gray-100 text-sm font-semibold">{item.name}</td>
                                        <td className="py-3 px-4 border-b border-gray-100 text-sm">{item.region}</td>
                                        <td className="py-3 px-4 border-b border-gray-100 text-sm">{item.state}</td>
                                        <td className="py-3 px-4 border-b border-gray-100 text-sm">{item.sku}</td>
                                        <td className="py-3 px-4 border-b border-gray-100 text-sm">{item.metricA || t("na")}</td>
                                        <td className="py-3 px-4 border-b border-gray-100 text-sm">{item.metricB || t("na")}</td>
                                        <td className="py-3 px-4 border-b border-gray-100 text-sm font-bold text-right">${item.monthlyCostUsd.toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
