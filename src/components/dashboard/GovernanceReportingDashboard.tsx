"use client";
import React, { useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { getFreshIdToken } from "@/lib/msalToken";
import Pagination, { usePagination } from "@/components/Pagination";
import { Loader2, AlertCircle, ShieldCheck, Boxes, Users, ChevronDown, ChevronUp } from "lucide-react";
import { isMockTenant } from '@/lib/mockData';
import { formatResourceType } from '@/lib/resourceTypeLabels';
import GovernanceScoreBoard from '@/components/dashboard/GovernanceScoreBoard';

function Bar({ label, fullName, count, max }: { label: string; fullName?: string; count: number; max: number }) {
    const pct = max > 0 ? Math.round((count / max) * 100) : 0;
    return (
        <div className="flex items-start gap-3 text-sm">
            <div className="w-56 shrink-0">
                <div className="text-gray-700 dark:text-gray-200 leading-tight">{label}</div>
                {fullName && fullName.toLowerCase() !== label.toLowerCase() && (
                    <div className="text-[10.5px] text-gray-400 dark:text-gray-500 break-all leading-tight">{fullName}</div>
                )}
            </div>
            <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden mt-1.5">
                <div className="h-full bg-brand-deep dark:bg-brand-sky" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-12 text-right font-medium text-gray-900 dark:text-white">{count}</span>
        </div>
    );
}

type DetailSection = "resources" | "policies" | "assignments";

function DetailBox({ items, render }: { items: any[]; render: (item: any, i: number) => React.ReactNode }) {
    const { paged, ...pag } = usePagination(items, 10);
    return (
        <div className="mt-3 rounded-lg border border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/30 p-3 text-left">
            <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {paged.map(render)}
            </div>
            {items.length > 10 && <Pagination {...pag} pageSizes={[10]} />}
        </div>
    );
}

export default function GovernanceReportingDashboard() {
    const t = useTranslations("GovernanceReporting");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [openDetail, setOpenDetail] = useState<DetailSection | null>(null);

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}`, "x-tenant-id": selectedTenant?.id ?? "" } });
        if (!res.ok) { const j = await res.json(); throw new Error(j.details || j.error || "Error"); }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
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
    const detail = pc.detail || null;
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

    const toggleDetail = (section: DetailSection) => setOpenDetail(openDetail === section ? null : section);

    const detailToggle = (section: DetailSection, count: number) => (
        detail ? (
            <button onClick={() => toggleDetail(section)} className="mt-1 text-[11px] font-semibold text-brand-deep hover:underline inline-flex items-center gap-0.5">
                {openDetail === section ? t("hideDetail") : t("showDetail")}
                {openDetail === section ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
        ) : count > 0 ? <div className="mt-1 text-[11px] text-gray-400">{t("detailUnavailable")}</div> : null
    );

    return (
        <div className="space-y-6">
            {/* Estado de Gobernanza (ex /governance/score, fusionada acá) */}
            <GovernanceScoreBoard />

            {/* Policy compliance */}
            <Card icon={<ShieldCheck className="w-4 h-4" />} title={t("policyTitle")}>
                {pc.available ? (
                    <>
                        <div className="grid grid-cols-3 gap-4 text-center">
                            <div>
                                <div className="text-3xl font-bold text-red-600 dark:text-red-400">{pc.nonCompliantResources}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">{t("nonCompliantResources")}</div>
                                {detailToggle("resources", pc.nonCompliantResources)}
                            </div>
                            <div>
                                <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">{pc.nonCompliantPolicies}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">{t("nonCompliantPolicies")}</div>
                                {detailToggle("policies", pc.nonCompliantPolicies)}
                            </div>
                            <div>
                                <div className="text-3xl font-bold text-gray-900 dark:text-white">{pc.policyAssignments}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">{t("policyAssignments")}</div>
                                {detailToggle("assignments", pc.policyAssignments)}
                            </div>
                        </div>

                        {detail && openDetail === "resources" && (
                            <DetailBox
                                items={detail.nonCompliantResources || []}
                                render={(r, i) => (
                                    <div key={`${r.resourceId}-${i}`} className="py-2 text-sm">
                                        <div className="font-medium text-gray-800 dark:text-gray-100 break-all">{r.name}</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400">
                                            {formatResourceType(r.type)} · <span className="break-all">{r.type}</span>
                                        </div>
                                        <div className="text-xs text-gray-400 dark:text-gray-500">
                                            {t("violatesPolicy")}: <b className="text-gray-600 dark:text-gray-300">{r.policyName}</b> · {t("viaAssignment")}: {r.assignmentName}
                                        </div>
                                    </div>
                                )}
                            />
                        )}
                        {detail && openDetail === "policies" && (
                            <DetailBox
                                items={detail.nonCompliantPolicies || []}
                                render={(p, i) => (
                                    <div key={`${p.name}-${i}`} className="py-2 flex items-center justify-between gap-3 text-sm">
                                        <span className="text-gray-800 dark:text-gray-100">{p.name}</span>
                                        <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                            {p.count} {t("resourcesShort")}
                                        </span>
                                    </div>
                                )}
                            />
                        )}
                        {detail && openDetail === "assignments" && (
                            <DetailBox
                                items={detail.assignments || []}
                                render={(a, i) => (
                                    <div key={`${a.name}-${i}`} className="py-2 flex items-center justify-between gap-3 text-sm">
                                        <div className="min-w-0">
                                            <div className="text-gray-800 dark:text-gray-100">{a.name}</div>
                                            <div className="text-xs text-gray-400 break-all">{a.scope}</div>
                                        </div>
                                        <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-bold ${a.nonCompliantCount > 0 ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"}`}>
                                            {a.nonCompliantCount > 0 ? `${a.nonCompliantCount} ${t("nonCompliantShort")}` : t("compliantShort")}
                                        </span>
                                    </div>
                                )}
                            />
                        )}
                    </>
                ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t("policyUnavailable")}</p>
                )}
            </Card>

            {/* Resource inventory */}
            <Card icon={<Boxes className="w-4 h-4" />} title={`${t("inventoryTitle")} (${inv.total})`}>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <div className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t("byType")}</div>
                        {inv.byType.slice(0, 8).map((r: any) => (
                            <Bar key={r.type} label={formatResourceType(r.type)} fullName={r.type} count={r.count} max={maxType} />
                        ))}
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
