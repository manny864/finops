"use client";

import React, { useEffect, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Activity, AlertTriangle, BellRing, CheckCircle2, Clock3, RefreshCw, ServerCrash, ShieldAlert } from "lucide-react";
import { isSuperAdmin } from "@/lib/authGuard";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from '@/lib/apiErrors';

type OpsResponse = {
    success: boolean;
    status: {
        overall: string;
        uptime30d: number;
        lastSnapshotAt: string | null;
        dbLatencyMs: number | null;
        azureSyncRatio: number | null;
        unacknowledgedAlerts: number;
        tenants: { total: number; syncOk: number };
        components: Array<{ name: string; status: string; latency_ms?: number }>;
    };
    crons: Array<{
        name: string;
        state: "ok" | "warning" | "error" | "unknown";
        runAt: string | null;
        ageMinutes: number | null;
        expectedEveryMinutes: number;
        isLate: boolean;
        durationMs: number | null;
        summary: string | null;
    }>;
    notificationChannels: {
        superAdminTenants: number;
        tenantsWithChannels: number;
        enabledChannels: number;
    };
};

const STATE_STYLE: Record<string, string> = {
    ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    error: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
    unknown: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export default function SuperAdminOpsPage() {
    const t = useTranslations("SuperAdminOps");
    const { accounts, instance } = useMsal();
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [data, setData] = useState<OpsResponse | null>(null);

    const loadData = async () => {
        setLoading(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch("/api/superadmin/ops", {
                headers: { Authorization: `Bearer ${idToken}` },
            });
            const json = await res.json();
            if (!res.ok || !json.success) {
                throw new Error(json.error || t("loadError"));
            }
            setData(json);
        } catch (error) {
            toast.error(errorMessage(error) || t("loadError"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (accounts.length === 0) return;
        if (!isSuperAdmin(accounts[0].username)) {
            toast.error(t("noAccess"));
            router.replace("/");
            return;
        }
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accounts.length]);

    const handleDispatch = async () => {
        setSending(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch("/api/superadmin/ops", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${idToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    severity: "warning",
                    title: t("dispatchTitle"),
                    message: t("dispatchMessage"),
                }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) {
                throw new Error(json.error || t("dispatchError"));
            }
            toast.success(t("dispatchSuccess", { delivered: json.delivered, failed: json.failed }));
        } catch (error) {
            toast.error(errorMessage(error) || t("dispatchError"));
        } finally {
            setSending(false);
        }
    };

    if (loading) {
        return (
            <div className="flex min-h-[360px] items-center justify-center text-slate-500">
                <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                {t("loading")}
            </div>
        );
    }

    if (!data) {
        return (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
                {t("emptyError")}
            </div>
        );
    }

    const degradedOrDown = data.status.overall !== "operational";

    return (
        <div className="mx-auto max-w-[1400px] space-y-6 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                        <Activity className="h-6 w-6 text-brand-deep" />
                        {t("title")}
                    </h1>
                    <p className="mt-1 text-sm text-slate-500">{t("subtitle")}</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={loadData}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:border-brand hover:text-brand dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                        <RefreshCw className="h-4 w-4" />
                        {t("refresh")}
                    </button>
                    <button
                        onClick={handleDispatch}
                        disabled={sending}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand-deep px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-brand-bright disabled:opacity-60"
                    >
                        {sending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
                        {t("dispatch")}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("overall")}</p>
                    <p className="mt-2 text-lg font-extrabold text-slate-800 dark:text-slate-100">{data.status.overall}</p>
                    <p className="mt-1 text-xs text-slate-500">{t("uptime", { value: data.status.uptime30d })}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("alerts")}</p>
                    <p className="mt-2 text-lg font-extrabold text-slate-800 dark:text-slate-100">{data.status.unacknowledgedAlerts}</p>
                    <p className="mt-1 text-xs text-slate-500">{t("pendingAlerts")}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("tenantsSync")}</p>
                    <p className="mt-2 text-lg font-extrabold text-slate-800 dark:text-slate-100">
                        {data.status.tenants.syncOk}/{data.status.tenants.total}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                        {t("azureSyncRatio", { value: data.status.azureSyncRatio == null ? "-" : Number(data.status.azureSyncRatio).toFixed(3) })}
                    </p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("channels")}</p>
                    <p className="mt-2 text-lg font-extrabold text-slate-800 dark:text-slate-100">{data.notificationChannels.enabledChannels}</p>
                    <p className="mt-1 text-xs text-slate-500">
                        {t("channelsTenantCoverage", {
                            covered: data.notificationChannels.tenantsWithChannels,
                            total: data.notificationChannels.superAdminTenants,
                        })}
                    </p>
                </div>
            </div>

            {degradedOrDown && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <p className="text-sm">{t("degradedBanner")}</p>
                </div>
            )}

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="border-b border-gray-100 p-4 dark:border-slate-800">
                        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t("componentsTitle")}</h2>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-slate-800">
                        {(data.status.components || []).map((component) => (
                            <div key={component.name} className="flex items-center justify-between p-4 text-sm">
                                <div className="flex items-center gap-2">
                                    {component.status === "operational" ? (
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                    ) : component.status === "degraded" ? (
                                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                                    ) : (
                                        <ServerCrash className="h-4 w-4 text-rose-500" />
                                    )}
                                    <span className="font-semibold text-slate-700 dark:text-slate-200">{component.name}</span>
                                </div>
                                <div className="text-xs text-slate-500">
                                    {component.status}
                                    {typeof component.latency_ms === "number" ? ` · ${component.latency_ms}ms` : ""}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="border-b border-gray-100 p-4 dark:border-slate-800">
                        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t("cronTitle")}</h2>
                    </div>
                    <div className="max-h-[500px] overflow-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="sticky top-0 bg-gray-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/70">
                                <tr>
                                    <th className="px-4 py-3">{t("cronName")}</th>
                                    <th className="px-4 py-3">{t("cronState")}</th>
                                    <th className="px-4 py-3">{t("cronLastRun")}</th>
                                    <th className="px-4 py-3">{t("cronSummary")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                {data.crons.map((cron) => (
                                    <tr key={cron.name}>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-200">{cron.name}</td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${STATE_STYLE[cron.state]}`}>
                                                {cron.state}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-500">
                                            {cron.runAt ? new Date(cron.runAt).toLocaleString() : t("neverRun")}
                                            {typeof cron.ageMinutes === "number" && (
                                                <span className="ml-1 inline-flex items-center gap-1 text-slate-400">
                                                    <Clock3 className="h-3 w-3" />
                                                    {cron.ageMinutes}m
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-500">{cron.summary || "-"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
