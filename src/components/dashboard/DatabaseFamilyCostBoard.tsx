"use client";

import React, { useEffect, useState } from "react";
import MockBanner from "@/components/MockBanner";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { toast } from "sonner";
import { DollarSign, Layers } from "lucide-react";
import { useTranslations } from "next-intl";

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DatabaseFamilyCostBoard({
    family,
    title,
    subtitle,
}: {
    family: "postgres-mysql" | "mongodb" | "redis";
    title: string;
    subtitle: string;
}) {
    const t = useTranslations("DatabaseFamilies");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (selectedTenant.id === "default" || (accounts.length === 0 && !isMockTenant(selectedTenant.id))) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const idToken = await getFreshIdToken(instance, accounts[0]);
                const url = new URL("/api/intelligence/databases/service-cost", window.location.origin);
                url.searchParams.set("tenantId", selectedTenant.id);
                url.searchParams.set("family", family);
                const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${idToken}` } });
                const json = await res.json();
                if (cancelled) return;
                if (!res.ok) {
                    toast.error(json.error || t("toastLoadError"));
                    return;
                }
                setData(json);
            } catch (e) {
                if (!cancelled) {
                    console.error(e);
                    toast.error(t("toastNetworkError"));
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedTenant.id, accounts.length, instance, family, t]);

    if (selectedTenant.id === "default") return null;

    if (loading) {
        return (
            <div className="p-6 max-w-5xl mx-auto flex items-center justify-center min-h-[320px]">
                <div className="animate-pulse flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-brand-soft border-t-brand-deep rounded-full animate-spin mb-4"></div>
                    <p className="text-gray-500 font-semibold">{t("loading")}</p>
                </div>
            </div>
        );
    }

    if (!data || (data.items || []).length === 0) {
        return (
            <div className="p-6 max-w-5xl mx-auto">
                <MockBanner />
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-8 text-center">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{title}</h2>
                    <p className="text-gray-600 dark:text-gray-400">{subtitle}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">{t("empty")}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-5xl mx-auto animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-6">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white">{title}</h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">{subtitle}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <DollarSign className="w-4 h-4" />
                        {t("kpiTotalCost")}
                    </h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{fmt.format(data.totalMonthlyCost || 0)}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <Layers className="w-4 h-4" />
                        {t("kpiResourceCount")}
                    </h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">
                        {(data.items || []).reduce((sum: number, i: any) => sum + Number(i.resourceCount || 0), 0)}
                    </p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-800 pb-3 mb-4">{t("tableTitle")}</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("colService")}</th>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("colResources")}</th>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("colMonthlyCost")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(data.items || []).map((item: any, idx: number) => (
                                <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">{item.serviceLabel}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-right">{Number(item.resourceCount || 0)}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{fmt.format(item.monthlyCost)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
