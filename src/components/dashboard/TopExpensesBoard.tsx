"use client";
import React from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { getFreshIdToken } from "@/lib/msalToken";
import { Loader2, AlertCircle, Info } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LabelList } from "recharts";
import { isMockTenant } from "@/lib/mockData";

const fmtUsd = (n: number | null | undefined) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-4 flex flex-col">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3">{title}</h3>
            {children}
        </div>
    );
}

function TopBarChart({ data, color, costLabel, nameLabel }: { data: Array<{ name: string; cost: number }>; color: string; costLabel: string; nameLabel: string }) {
    if (!data || data.length === 0) {
        return <div className="flex items-center justify-center h-44 text-sm text-gray-400 dark:text-gray-500">—</div>;
    }
    const height = Math.max(140, data.length * 56);
    return (
        <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 20 }}>
                <XAxis
                    type="number"
                    tick={{ fontSize: 10 }}
                    domain={[0, "auto"]}
                    label={{ value: costLabel, position: "insideBottom", offset: -8, fontSize: 10 }}
                />
                <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    width={150}
                    label={{ value: nameLabel, angle: -90, position: "insideLeft", fontSize: 10 }}
                />
                <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                <Bar dataKey="cost" fill={color} radius={[0, 4, 4, 0]} barSize={26}>
                    <LabelList dataKey="cost" position="right" formatter={(v: any) => fmtUsd(Number(v))} style={{ fontSize: 11, fontWeight: 700, fill: "currentColor" }} className="fill-gray-700 dark:fill-gray-200" />
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
}

export default function TopExpensesBoard() {
    const t = useTranslations("TopExpenses");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}`, "x-tenant-id": selectedTenant?.id ?? "" } });
        if (!res.ok) { const j = await res.json(); throw new Error(j.details || j.error || "Error"); }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/intelligence/top-expenses?tenantId=${selectedTenant.id}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    if (!selectedTenant || selectedTenant.id === "default") return null;

    const subsCount = data?.topSubscriptions?.length ?? 3;
    const subsTitle = t("top_subscriptions_title", { count: subsCount });

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{t("title")}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t("subtitle")}</p>
            </div>

            {isLoading && (
                <div className="flex flex-col items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                    <p className="text-gray-500 dark:text-gray-400">{t("loading")}</p>
                </div>
            )}

            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                    <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Error</h3>
                    <p className="text-sm">{error.message}</p>
                </div>
            )}

            {!isLoading && !error && data && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <Card title={t("top_cost_groups_title")}>
                        <TopBarChart data={data.topCostGroups} color="#0054A6" costLabel={t("cost_axis")} nameLabel={t("cost_group_axis")} />
                    </Card>
                    <Card title={subsTitle}>
                        <TopBarChart data={data.topSubscriptions} color="#F2A900" costLabel={t("cost_axis")} nameLabel={t("subscription_axis")} />
                        {data.unattributedSubscriptionCost > 0 && (
                            <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 mt-2">
                                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                {t("unattributed_subscription_cost", { amount: fmtUsd(data.unattributedSubscriptionCost) })}
                            </p>
                        )}
                    </Card>
                    <Card title={t("top_resource_groups_title")}>
                        <TopBarChart data={data.topResourceGroups} color="#0EA5E9" costLabel={t("cost_axis")} nameLabel={t("resource_group_axis")} />
                    </Card>
                    <Card title={t("top_resources_title")}>
                        <TopBarChart data={data.topResources} color="#10B981" costLabel={t("cost_axis")} nameLabel={t("resource_axis")} />
                    </Card>
                </div>
            )}
        </div>
    );
}
