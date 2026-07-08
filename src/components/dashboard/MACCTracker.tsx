"use client";
import React from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { useCurrency } from "@/components/CurrencyProvider";
import { Loader2, AlertTriangle, CheckCircle, TrendingDown, TrendingUp, DollarSign, Calendar } from "lucide-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from '@/lib/mockData';

type CommitmentStatus = "onTrack" | "atRisk" | "overConsumption";

function statusConfig(status: CommitmentStatus) {
    if (status === "onTrack") return { color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40", border: "border-emerald-200 dark:border-emerald-800/50", icon: <CheckCircle className="w-4 h-4" /> };
    if (status === "atRisk") return { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/40", border: "border-amber-200 dark:border-amber-800/50", icon: <TrendingDown className="w-4 h-4" /> };
    return { color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/40", border: "border-red-200 dark:border-red-800/50", icon: <TrendingUp className="w-4 h-4" /> };
}

function KpiCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
    return (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 flex items-start gap-3">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 shrink-0">{icon}</div>
            <div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{label}</p>
                <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{value}</p>
                {sub && <p className="text-xs text-slate-400">{sub}</p>}
            </div>
        </div>
    );
}

function CommitmentCard({ commitment, t, format }: { commitment: any; t: any; format: (v: number, opts?: any) => string }) {
    const sc = statusConfig(commitment.status as CommitmentStatus);
    const expectedPct = commitment.daysRemaining > 0
        ? Math.min(100, ((commitment.commitmentAmount - commitment.remainingAmount * (1 - (commitment.daysRemaining / 365))) / commitment.commitmentAmount) * 100)
        : 100;

    return (
        <div className={`border rounded-xl p-5 space-y-4 ${sc.border} ${sc.bg}`}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Billing Account</p>
                    <p className="font-mono text-sm font-semibold text-slate-700 dark:text-slate-300">{commitment.billingAccountId}</p>
                </div>
                <span className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full ${sc.color} ${sc.bg} border ${sc.border}`}>
                    {sc.icon}
                    {t(commitment.status)}
                </span>
            </div>

            {/* Alert */}
            {commitment.status !== "onTrack" && (
                <div className={`flex items-start gap-2 text-xs p-3 rounded-lg border ${sc.border} ${sc.bg}`}>
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                        {commitment.status === "atRisk"
                            ? `Proyección de consumo (${format(commitment.projectedConsumption, { compact: true })}) está por debajo del 90% del compromiso. Riesgo de penalización por sub-consumo.`
                            : `Proyección de consumo (${format(commitment.projectedConsumption, { compact: true })}) supera el compromiso. Revisar urgente.`}
                    </span>
                </div>
            )}

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <KpiCard label={t("commitment")} value={format(commitment.commitmentAmount, { compact: true })} icon={<DollarSign className="w-4 h-4" />} />
                <KpiCard label={t("consumed")} value={format(commitment.consumedAmount,   { compact: true })} sub={`${commitment.progressPercent}% del total`} icon={<TrendingUp className="w-4 h-4" />} />
                <KpiCard label={t("remaining")} value={format(commitment.remainingAmount,  { compact: true })} icon={<DollarSign className="w-4 h-4" />} />
                <KpiCard label={t("daysRemaining")} value={String(commitment.daysRemaining)} sub={`${commitment.endDate}`} icon={<Calendar className="w-4 h-4" />} />
                <KpiCard label={t("burnRate")} value={format(commitment.burnRateMonthly, { compact: true }) + "/mo"} icon={<TrendingDown className="w-4 h-4" />} />
                <KpiCard label="Proyección Final" value={format(commitment.projectedConsumption, { compact: true })} icon={<TrendingUp className="w-4 h-4" />} />
            </div>

            {/* Progress bar */}
            <div>
                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                    <span>{t("progress")} — {commitment.progressPercent}%</span>
                    <span>{format(commitment.commitmentAmount)} {commitment.currency}</span>
                </div>
                <div className="relative h-4 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    {/* Actual consumed */}
                    <div
                        className={`absolute left-0 top-0 h-4 rounded-full transition-all ${commitment.status === "overConsumption" ? "bg-red-500" : commitment.status === "atRisk" ? "bg-amber-400" : "bg-emerald-500"}`}
                        style={{ width: `${commitment.progressPercent}%` }}
                    />
                    {/* Expected marker */}
                    <div
                        className="absolute top-0 h-4 w-0.5 bg-slate-600 dark:bg-slate-300 opacity-60"
                        style={{ left: `${Math.min(100, expectedPct)}%` }}
                        title={`Esperado: ${expectedPct.toFixed(0)}%`}
                    />
                </div>
                <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>{commitment.startDate}</span>
                    <span>{commitment.endDate}</span>
                </div>
            </div>
        </div>
    );
}

export default function MACCTracker() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();
    const t = useTranslations("MACC");
    const tMock = useTranslations("Mock");

    const fetcher = async (url: string) => {
        const token = await getFreshIdToken(instance, accounts[0]);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
            const j = await res.json();
            throw new Error(j.error || "Error al cargar MACC");
        }
        return res.json();
    };

    const apiUrl =
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/intelligence/macc?tenantId=${selectedTenant.id}`
            : null;

    const { data, error, isLoading } = useSWR(apiUrl, fetcher, { revalidateOnFocus: false });

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Cargando MACC...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Error</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    if (!data) return null;

    const { commitments, aggregates, mock } = data;

    if (!commitments || commitments.length === 0) {
        return <p className="text-slate-500 dark:text-slate-400 text-sm py-10 text-center">{t("noMacc")}</p>;
    }

    return (
        <div className="w-full space-y-6">
            {/* Mock banner */}
            {mock && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-300 rounded-xl px-4 py-3 flex items-center gap-3 text-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span><strong>{tMock("badge")}</strong> — {tMock("description")}</span>
                </div>
            )}

            {/* Aggregate KPIs */}
            {aggregates && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <KpiCard label={t("commitment")} value={format(aggregates.totalCommitment,  { compact: true })} icon={<DollarSign className="w-5 h-5" />} />
                    <KpiCard label={t("consumed")} value={format(aggregates.totalConsumed,    { compact: true })} sub={`${aggregates.overallProgress}% del total`} icon={<TrendingUp className="w-5 h-5" />} />
                    <KpiCard label={t("remaining")} value={format(aggregates.totalRemaining,   { compact: true })} icon={<DollarSign className="w-5 h-5" />} />
                    <div className={`border rounded-xl p-4 flex items-start gap-3 ${statusConfig(aggregates.overallStatus as CommitmentStatus).bg} ${statusConfig(aggregates.overallStatus as CommitmentStatus).border}`}>
                        <div className={`p-2 rounded-lg ${statusConfig(aggregates.overallStatus as CommitmentStatus).bg}`}>
                            {statusConfig(aggregates.overallStatus as CommitmentStatus).icon}
                        </div>
                        <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Estado Global</p>
                            <p className={`text-sm font-bold ${statusConfig(aggregates.overallStatus as CommitmentStatus).color}`}>{t(aggregates.overallStatus)}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Per-commitment cards */}
            {commitments.map((c: any) => (
                <CommitmentCard key={c.id} commitment={c} t={t} format={format} />
            ))}
        </div>
    );
}
