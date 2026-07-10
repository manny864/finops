"use client";
import React from "react";
import Link from "next/link";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
    LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Loader2, AlertCircle, Info, TrendingUp, TrendingDown, MapPin, ShieldAlert, Lightbulb, ChevronRight } from "lucide-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { formatResourceType } from "@/lib/resourceTypeLabels";

const COLORS = {
    high: "#dc2626",
    medium: "#f59e0b",
    low: "#22c55e",
    blue: "#0054A6",
    cyan: "#00AEEF",
    violet: "#8b5cf6",
};

const fmtUsd = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

function Card({ title, className = "", children }: { title?: string; className?: string; children: React.ReactNode }) {
    return (
        <div className={`bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-4 flex flex-col ${className}`}>
            {title && <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">{title}</h3>}
            {children}
        </div>
    );
}

export default function ExecutiveSummaryBoard() {
    const t = useTranslations("WhiteBoard");
    const locale = useLocale();
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
        if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            throw new Error(json.error || "Error al cargar datos");
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/intelligence/whiteboard?tenantId=${selectedTenant.id}&locale=${locale}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-24">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Cargando White Board...</p>
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

    if (!data) return null;

    const { costs, security, vulnerabilities, governance, top3ThreatCategories, top5Locations, top5Inventory, recommendations, costAnomalyTrend, top5CostGroups } = data;
    const untagged = governance?.untagged || {};
    const complianceWins: Array<{ name: string; pct: number }> = governance?.top3ComplianceWins || [];
    const vulnData = [
        { name: t("high"), value: vulnerabilities?.high || 0, color: COLORS.high },
        { name: t("medium"), value: vulnerabilities?.medium || 0, color: COLORS.medium },
        { name: t("low"), value: vulnerabilities?.low || 0, color: COLORS.low },
    ];
    const top3Services = (costs?.top3Services || []) as Array<{ name: string; cost: number }>;
    const servicesBarData = [
        ...top3Services.map((s) => ({ name: s.name, cost: s.cost })),
        { name: t("total"), cost: top3Services.reduce((sum, s) => sum + s.cost, 0) },
    ];
    const costUp = (costs?.costChangePct || 0) >= 0;
    const top5InventoryData = ((top5Inventory || []) as Array<{ name: string; count: number }>).map((r) => ({
        label: formatResourceType(r.name),
        fullName: r.name,
        count: r.count,
    }));

    return (
        <div className="w-full space-y-6">
            {data.mock && (
                <div className="bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-3 rounded-xl border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300">
                    <Info className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="text-sm">{t("mock_data_notice")}</div>
                </div>
            )}

            {/* Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title={t("costs")}>
                    <p className="text-[11px] text-slate-400 mb-1">{t("current_fy_cost")}</p>
                    <p className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{fmtUsd(costs?.currentFYCost)}</p>

                    <p className="text-[11px] text-slate-400 mt-4 mb-1">{t("cost_projected")}</p>
                    <div className="flex items-center gap-2">
                        <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{fmtUsd(costs?.costProjected)}</p>
                        <span className={`inline-flex items-center gap-1 text-xs font-bold ${costUp ? "text-red-600" : "text-emerald-600"}`}>
                            {costUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                            {Math.abs(costs?.costChangePct || 0)}%
                        </span>
                    </div>

                    <div className="mt-4 pt-3 border-t border-gray-100 dark:border-slate-800">
                        <p className="text-[11px] text-slate-400 mb-1">{t("previous_fy")}</p>
                        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{fmtUsd(costs?.previousFYCost)}</p>
                    </div>
                </Card>

                <Card title={t("last_3_months_trend")}>
                    <ResponsiveContainer width="100%" height={160}>
                        <LineChart data={costs?.last3MonthsTrend || []}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} width={45} />
                            <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                            <Line type="monotone" dataKey="cost" stroke={COLORS.blue} strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                    </ResponsiveContainer>
                </Card>

                <Card title={t("top3_services")}>
                    <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={servicesBarData} layout="vertical" margin={{ left: 8, right: 16 }}>
                            <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                            <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                            <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                                {servicesBarData.map((entry, i) => (
                                    <Cell key={i} fill={i === servicesBarData.length - 1 ? COLORS.cyan : COLORS.blue} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </Card>
            </div>

            {/* Row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card title={t("security_vulnerabilities")}>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-[11px] text-slate-400 mb-1">{t("security")}</p>
                            <p className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{security?.pct}%</p>
                            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-800">
                                <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{security?.withMfa} {t("of")} {security?.total}</p>
                            </div>
                        </div>
                        <div>
                            <p className="text-[11px] text-slate-400 mb-1">{t("vulnerabilities")}</p>
                            <ResponsiveContainer width="100%" height={130}>
                                <PieChart>
                                    <Pie data={vulnData} dataKey="value" nameKey="name" innerRadius={28} outerRadius={50}>
                                        {vulnData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                                    </Pie>
                                    <Tooltip />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="flex justify-center gap-3 text-[10px] mt-1">
                                {vulnData.map((v) => (
                                    <span key={v.name} className="flex items-center gap-1">
                                        <span className="w-2 h-2 rounded-full inline-block" style={{ background: v.color }} />
                                        {v.name} {v.value}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                </Card>

                <Card title={t("governance")}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <p className="text-[11px] text-slate-400 mb-2">{t("untagged_resources_trend")}</p>
                            <ResponsiveContainer width="100%" height={100}>
                                <LineChart data={untagged.trend || []}>
                                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                                    <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                                    <Line type="monotone" dataKey="cost" stroke={COLORS.violet} strokeWidth={2} dot={{ r: 2 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="grid grid-rows-2 gap-3">
                            <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3">
                                <p className="text-[10px] text-slate-400 mb-1">{t("untagged_resources_count")}</p>
                                <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100">{untagged.count}</p>
                                <p className="text-[11px] text-slate-500">{untagged.countPct}%</p>
                            </div>
                            <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3">
                                <p className="text-[10px] text-slate-400 mb-1">{t("untagged_resources_cost")}</p>
                                <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100">{fmtUsd(untagged.cost)}</p>
                                <p className="text-[11px] text-slate-500">{untagged.costPct}% {t("monthly_cost_pct")}</p>
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-gray-100 dark:border-slate-800">
                        <p className="text-[11px] text-slate-400 mb-2">{t("top3_compliance_wins")}</p>
                        <ResponsiveContainer width="100%" height={110}>
                            <BarChart data={complianceWins}>
                                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                                <YAxis hide domain={[0, 100]} />
                                <Tooltip formatter={(v: any) => `${v}%`} />
                                <Bar dataKey="pct" fill={COLORS.blue} radius={[4, 4, 0, 0]} label={{ position: "top", fontSize: 11, formatter: (v: any) => `${v}%` }} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </Card>
            </div>

            {/* Row 3 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title={t("top3_threat_categories")}>
                    <div className="flex flex-col gap-3">
                        {(top3ThreatCategories || []).map((cat: any, i: number) => (
                            <div key={i}>
                                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate mb-1" title={cat.name}>{cat.name}</p>
                                <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 dark:bg-slate-800">
                                    {cat.high > 0 && <div style={{ width: `${(cat.high / cat.total) * 100}%`, background: COLORS.high }} title={`High: ${cat.high}`} />}
                                    {cat.medium > 0 && <div style={{ width: `${(cat.medium / cat.total) * 100}%`, background: COLORS.medium }} title={`Medium: ${cat.medium}`} />}
                                    {cat.low > 0 && <div style={{ width: `${(cat.low / cat.total) * 100}%`, background: COLORS.low }} title={`Low: ${cat.low}`} />}
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1">{cat.total} total</p>
                            </div>
                        ))}
                        {(!top3ThreatCategories || top3ThreatCategories.length === 0) && (
                            <p className="text-sm text-slate-400 flex items-center gap-2"><ShieldAlert className="w-4 h-4" /> {t("no_findings")}</p>
                        )}
                    </div>
                </Card>

                <Card title={t("top5_locations")}>
                    <div className="flex flex-col gap-2">
                        {(top5Locations || []).map((loc: any, i: number) => {
                            const max = Math.max(...(top5Locations || []).map((l: any) => l.count), 1);
                            return (
                                <div key={i} className="flex items-center gap-2">
                                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                    <span className="text-xs text-slate-600 dark:text-slate-300 w-24 truncate">{loc.name}</span>
                                    <div className="flex-1 bg-gray-100 dark:bg-slate-800 rounded-full h-2.5">
                                        <div className="h-2.5 rounded-full bg-cyan-500" style={{ width: `${(loc.count / max) * 100}%` }} />
                                    </div>
                                    <span className="text-xs font-semibold text-slate-500 w-10 text-right">{loc.count}</span>
                                </div>
                            );
                        })}
                    </div>
                </Card>

                <Card title={t("top5_inventory")}>
                    <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={top5InventoryData} layout="vertical" margin={{ left: 8, right: 16 }}>
                            <XAxis type="number" tick={{ fontSize: 10 }} />
                            <YAxis type="category" dataKey="label" tick={{ fontSize: 9 }} width={130} />
                            <Tooltip labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.fullName || ""} />
                            <Bar dataKey="count" fill={COLORS.blue} radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </Card>
            </div>

            {/* Row 4 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card>
                    <Link
                        href={`/${locale}/advisor`}
                        className="grid grid-cols-2 gap-3 h-full group -m-1 p-1 rounded-lg transition-colors hover:bg-gray-50 dark:hover:bg-slate-800/40"
                    >
                        <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3 flex flex-col justify-center">
                            <p className="text-[10px] text-slate-400 mb-1 flex items-center gap-1">
                                {t("open_recommendations")}
                                <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </p>
                            <p className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <Lightbulb className="w-5 h-5 text-amber-500" />{recommendations?.open}
                            </p>
                        </div>
                        <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3 flex flex-col justify-center">
                            <p className="text-[10px] text-slate-400 mb-1">{t("potential_cost_savings")}</p>
                            <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">{fmtUsd(recommendations?.potentialCostSavings)}</p>
                        </div>
                    </Link>
                </Card>

                <Card>
                    <p className="text-[11px] text-slate-400 mb-1">{t("recommendation_trend")}</p>
                    <ResponsiveContainer width="100%" height={90}>
                        <LineChart data={recommendations?.trend || []}>
                            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Line type="monotone" dataKey="count" stroke={COLORS.blue} strokeWidth={2} dot={{ r: 2 }} />
                        </LineChart>
                    </ResponsiveContainer>
                    <p className="text-[11px] text-slate-400 mt-3 mb-1">{t("cost_anomaly_trend")}</p>
                    <ResponsiveContainer width="100%" height={90}>
                        <LineChart data={costAnomalyTrend || []}>
                            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Line type="monotone" dataKey="count" stroke={COLORS.high} strokeWidth={2} dot={{ r: 2 }} />
                        </LineChart>
                    </ResponsiveContainer>
                </Card>

                <Card title={t("top5_cost_groups")}>
                    <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100 mb-2">{fmtUsd(top5CostGroups?.totalCost)}</p>
                    <ResponsiveContainer width="100%" height={140}>
                        <BarChart data={top5CostGroups?.groups || []}>
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} width={40} />
                            <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                            <Bar dataKey="cost" fill={COLORS.cyan} radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </Card>
            </div>
        </div>
    );
}
