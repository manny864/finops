"use client";
import React from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { Loader2, AlertCircle, TrendingUp, TrendingDown, PiggyBank } from "lucide-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

const fmtUsd = (n: number | null | undefined) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

function Card({ title, className = "", children }: { title?: string; className?: string; children: React.ReactNode }) {
    return (
        <div className={`bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-4 flex flex-col ${className}`}>
            {title && <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">{title}</h3>}
            {children}
        </div>
    );
}

export default function CapturedSavingsBoard() {
    const t = useTranslations("OverviewCapturedSavings");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
        if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || t("errorLoading")); }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/intelligence/captured-savings?tenantId=${selectedTenant.id}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-24">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">{t("loadingHistory")}</p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t("featureName")} />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {t("error")}</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    const history = data?.history || [];
    const current = data?.current;
    const changePct = data?.changePct || 0;
    const potentialSavingsLabel = t("potentialSavings");
    const wastedDetectedLabel = t("wastedDetected");
    const chartData = history.map((h: any) => ({ date: h.date, [potentialSavingsLabel]: h.potentialSavings, [wastedDetectedLabel]: h.totalWasted }));

    return (
        <div className="w-full space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card>
                    <p className="text-[11px] text-slate-400 mb-1">{t("currentPotentialSavings")}</p>
                    <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                        <PiggyBank className="w-5 h-5" /> {fmtUsd(current?.potentialSavings)}
                    </p>
                    <span className={`inline-flex items-center gap-1 text-xs font-bold mt-2 w-max ${changePct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {changePct >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        {t("vsLastRecord", { pct: Math.abs(changePct) })}
                    </span>
                </Card>
                <Card>
                    <p className="text-[11px] text-slate-400 mb-1">{t("currentWastedDetected")}</p>
                    <p className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{fmtUsd(current?.totalWasted)}</p>
                    <p className="text-[11px] text-slate-400 mt-2">{t("lastScan", { date: current?.date || "—" })}</p>
                </Card>
                <Card>
                    <p className="text-[11px] text-slate-400 mb-1">{t("historicalRecords")}</p>
                    <p className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{history.length}</p>
                    <p className="text-[11px] text-slate-400 mt-2">{t("last12Months")}</p>
                </Card>
            </div>

            <Card title={t("chartTitle")}>
                {history.length === 0 ? (
                    <div className="py-16 flex items-center justify-center text-sm text-gray-400">
                        {t("noHistoryYet")}
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height={320}>
                        <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                            <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Line type="monotone" dataKey={potentialSavingsLabel} stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                            <Line type="monotone" dataKey={wastedDetectedLabel} stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </Card>
        </div>
    );
}
