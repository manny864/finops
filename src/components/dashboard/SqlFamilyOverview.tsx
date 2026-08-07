"use client";

import React, { useEffect, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { DollarSign, Layers } from "lucide-react";

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SqlFamilyOverview() {
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
                const url = new URL("/api/intelligence/databases/sql-family", window.location.origin);
                url.searchParams.set("tenantId", selectedTenant.id);
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
    }, [selectedTenant.id, accounts.length, instance, t]);

    if (selectedTenant.id === "default") return null;

    if (loading) {
        return <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 py-2">{t("loading")}</div>;
    }

    const items = data?.items || [];

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 mb-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-3">{t("sqlFamilyTitle")}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t("sqlFamilySubtitle")}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div className="rounded-lg border border-gray-200 dark:border-slate-800 p-4">
                    <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
                        <DollarSign className="w-4 h-4" />
                        {t("kpiTotalCost")}
                    </div>
                    <div className="text-xl font-extrabold text-gray-900 dark:text-white mt-1">{fmt.format(data?.totalMonthlyCost || 0)}</div>
                </div>
                <div className="rounded-lg border border-gray-200 dark:border-slate-800 p-4">
                    <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
                        <Layers className="w-4 h-4" />
                        {t("kpiResourceCount")}
                    </div>
                    <div className="text-xl font-extrabold text-gray-900 dark:text-white mt-1">{items.reduce((sum: number, i: any) => sum + Number(i.resourceCount || 0), 0)}</div>
                </div>
            </div>

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
                        {items.map((item: any, idx: number) => (
                            <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">{item.serviceLabel}</td>
                                <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-right">{Number(item.resourceCount || 0)}</td>
                                <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{fmt.format(item.monthlyCost || 0)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
