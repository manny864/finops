"use client";
import React from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { getFreshIdToken } from "@/lib/msalToken";
import { Loader2, AlertCircle, ShieldCheck, Boxes, Users } from "lucide-react";

function Bar({ label, count, max }: { label: string; count: number; max: number }) {
    const pct = max > 0 ? Math.round((count / max) * 100) : 0;
    return (
        <div className="flex items-center gap-3 text-sm">
            <span className="w-48 truncate text-gray-600 dark:text-gray-300" title={label}>{label}</span>
            <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
                <div className="h-full bg-brand-deep dark:bg-brand-sky" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-12 text-right font-medium text-gray-900 dark:text-white">{count}</span>
        </div>
    );
}

export default function GovernanceReportingDashboard() {
    const t = useTranslations("GovernanceReporting");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const fetcher = async (url: string) => {
        const account = accounts[0];
        if (!account) throw new Error("No hay cuenta autenticada");
        const idToken = await getFreshIdToken(instance, account, ["User.Read"]);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}`, "x-tenant-id": selectedTenant?.id ?? "" } });
        if (!res.ok) { const j = await res.json(); throw new Error(j.details || j.error || "Error"); }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant && selectedTenant.id !== "default" && accounts.length > 0
            ? `/api/governance/reporting?tenantId=${selectedTenant.id}`
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
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Error</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }
    if (!data || data.success === false) return <p className="text-sm text-gray-500">{data?.error || t("empty")}</p>;

    const pc = data.policyCompliance || {};
    const inv = data.resourceInventory || { byType: [], byLocation: [], total: 0 };
    const ids = data.identities || { byPrincipalType: [], totalAssignments: 0 };
    const maxType = Math.max(1, ...inv.byType.map((r: any) => r.count));
    const maxLoc = Math.max(1, ...inv.byLocation.map((r: any) => r.count));
    const maxP = Math.max(1, ...ids.byPrincipalType.map((r: any) => r.count));

    const Card = ({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) => (
        <div className="p-5 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white mb-4">{icon} {title}</div>
            {children}
        </div>
    );

    return (
        <div className="space-y-6">
            {/* Policy compliance */}
            <Card icon={<ShieldCheck className="w-4 h-4" />} title={t("policyTitle")}>
                {pc.available ? (
                    <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                            <div className="text-3xl font-bold text-red-600 dark:text-red-400">{pc.nonCompliantResources}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{t("nonCompliantResources")}</div>
                        </div>
                        <div>
                            <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">{pc.nonCompliantPolicies}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{t("nonCompliantPolicies")}</div>
                        </div>
                        <div>
                            <div className="text-3xl font-bold text-gray-900 dark:text-white">{pc.policyAssignments}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{t("policyAssignments")}</div>
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t("policyUnavailable")}</p>
                )}
            </Card>

            {/* Resource inventory */}
            <Card icon={<Boxes className="w-4 h-4" />} title={`${t("inventoryTitle")} (${inv.total})`}>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <div className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t("byType")}</div>
                        {inv.byType.slice(0, 8).map((r: any) => <Bar key={r.type} label={r.type} count={r.count} max={maxType} />)}
                    </div>
                    <div className="space-y-2">
                        <div className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t("byLocation")}</div>
                        {inv.byLocation.slice(0, 8).map((r: any) => <Bar key={r.location} label={r.location} count={r.count} max={maxLoc} />)}
                    </div>
                </div>
            </Card>

            {/* Identities / roles */}
            <Card icon={<Users className="w-4 h-4" />} title={`${t("identitiesTitle")} (${ids.totalAssignments})`}>
                <div className="space-y-2 max-w-md">
                    {ids.byPrincipalType.map((r: any) => <Bar key={r.principalType} label={r.principalType} count={r.count} max={maxP} />)}
                </div>
            </Card>

            <p className="text-xs text-gray-400 dark:text-gray-500">{t("source", { subs: data.subscriptionsEvaluated })}</p>
        </div>
    );
}
