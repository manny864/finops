"use client";
/**
 * Aprobaciones móvil: el caso de uso móvil real — te llega la notificación y
 * aprobás/rechazás la remediación desde donde estés. Tarjetas grandes con
 * botones de pulgar; reusa /api/remediation/workflow (RBAC server-side).
 */
import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { Loader2, CheckCircle, XCircle, Trash2, Clock } from "lucide-react";
import { toast } from "sonner";

interface RemediationRequest {
    id: number | string;
    resource_name: string;
    action_type: string;
    estimated_savings: number;
    status: "Pending" | "Approved" | "Rejected";
    requested_by: string;
    requested_at: string;
}

const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function MobileApprovalsPage() {
    const t = useTranslations("Mobile");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [requests, setRequests] = useState<RemediationRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState<number | string | null>(null);

    const isMock = isMockTenant(selectedTenant?.id || "");

    const load = useCallback(async () => {
        if (!selectedTenant?.id || selectedTenant.id === "default") {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            if (isMock) {
                const mock = getMockDataForRoute("approvals", (selectedTenant as { tier?: string }).tier || selectedTenant.id);
                setRequests(mock.data || []);
                return;
            }
            if (accounts.length === 0) return;
            const token = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch(`/api/remediation/workflow?tenantId=${selectedTenant.id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            setRequests(json.data || []);
        } catch {
            toast.error(t("errorLoading"));
        } finally {
            setLoading(false);
        }
    }, [selectedTenant, isMock, accounts, instance, t]);

    useEffect(() => {
        load();
    }, [load]);

    const resolve = async (req: RemediationRequest, status: "Approved" | "Rejected") => {
        if (acting) return;
        if (isMock) {
            setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status } : r));
            toast.success(status === "Approved" ? t("approved") : t("rejected"));
            return;
        }
        setActing(req.id);
        try {
            const token = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch("/api/remediation/workflow", {
                method: "PATCH",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ id: req.id, status, tenantId: selectedTenant.id }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            toast.success(status === "Approved" ? t("approved") : t("rejected"));
            await load();
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : t("errorGeneric"));
        } finally {
            setActing(null);
        }
    };

    const pending = requests.filter(r => r.status === "Pending");
    const resolved = requests.filter(r => r.status !== "Pending").slice(0, 10);

    return (
        <div className="max-w-lg mx-auto">
            <h1 className="text-2xl font-extrabold text-ink dark:text-white font-heading mb-4">{t("approvalsTitle")}</h1>

            {loading ? (
                <div className="flex items-center gap-2 text-ink-soft py-10 justify-center">
                    <Loader2 className="w-5 h-5 animate-spin" /> <span className="text-base">{t("loading")}</span>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {pending.length === 0 && (
                        <div className="rounded-2xl border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 p-6 text-center">
                            <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                            <p className="text-base font-semibold text-ink dark:text-white">{t("noPending")}</p>
                        </div>
                    )}

                    {pending.map((req) => (
                        <div key={req.id} className="rounded-2xl border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 p-4 shadow-sm">
                            <div className="flex items-start gap-3">
                                <Trash2 className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
                                <div className="min-w-0 flex-1">
                                    <div className="text-base font-bold text-ink dark:text-white leading-snug break-all">{req.resource_name}</div>
                                    <div className="text-sm text-ink-soft dark:text-gray-400 mt-0.5">
                                        {req.action_type} · <b className="text-emerald-600">{fmt(Number(req.estimated_savings || 0))}/mes</b>
                                    </div>
                                    <div className="text-xs text-ink-soft dark:text-gray-500 mt-1">
                                        {t("requestedBy", { user: req.requested_by })} · {new Date(req.requested_at).toLocaleDateString()}
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2.5 mt-3">
                                <button
                                    onClick={() => resolve(req, "Rejected")}
                                    disabled={acting === req.id}
                                    className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-red-200 dark:border-red-900/50 text-red-600 text-base font-bold active:bg-red-50 disabled:opacity-50"
                                >
                                    <XCircle className="w-5 h-5" /> {t("reject")}
                                </button>
                                <button
                                    onClick={() => resolve(req, "Approved")}
                                    disabled={acting === req.id}
                                    className="flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 text-white text-base font-bold active:brightness-90 disabled:opacity-50"
                                >
                                    {acting === req.id ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />} {t("approve")}
                                </button>
                            </div>
                        </div>
                    ))}

                    {resolved.length > 0 && (
                        <>
                            <div className="text-sm font-bold uppercase tracking-wide text-ink-soft dark:text-gray-500 mt-2 flex items-center gap-1.5">
                                <Clock className="w-4 h-4" /> {t("recentlyResolved")}
                            </div>
                            {resolved.map((req) => (
                                <div key={req.id} className="rounded-2xl border border-line dark:border-slate-800 bg-surface-2/50 dark:bg-slate-900/50 p-3.5 flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-sm font-semibold text-ink dark:text-gray-200 truncate">{req.resource_name}</div>
                                        <div className="text-xs text-ink-soft dark:text-gray-500">{fmt(Number(req.estimated_savings || 0))}/mes</div>
                                    </div>
                                    <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${req.status === "Approved"
                                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                                        {req.status === "Approved" ? t("statusApproved") : t("statusRejected")}
                                    </span>
                                </div>
                            ))}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
