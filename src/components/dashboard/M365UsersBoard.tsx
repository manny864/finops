"use client";
import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations, useLocale } from "next-intl";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, LabelList, Tooltip } from "recharts";
import { Loader2, AlertCircle, Users, KeyRound, ShieldCheck, Boxes, UserX, Package, DollarSign, Cpu, ShieldQuestion } from "lucide-react";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";

const fmtUsd = (n: number | null | undefined) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const fmtNum = (n: number | null | undefined) =>
    new Intl.NumberFormat("en-US").format(n || 0);
const fmtCompact = (n: number | null | undefined) =>
    new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n || 0);

function useAuthedSWR<T = any>(path: string) {
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const ready = selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id));
    const fetcher = async (url: string) => {
        const idToken = accounts.length ? await getFreshIdToken(instance, accounts[0], ["User.Read"]) : "";
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}`, "x-tenant-id": selectedTenant?.id ?? "" } });
        if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.details || j.error || "Error"); }
        return res.json();
    };
    return useSWR<T>(ready ? `${path}?tenantId=${selectedTenant!.id}` : null, fetcher, { revalidateOnFocus: false });
}

function BigKpi({ label, value, icon }: { label: string; value: React.ReactNode; icon: React.ReactNode }) {
    return (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-brand-soft/60 dark:bg-slate-800 flex items-center justify-center shrink-0 text-brand-deep dark:text-brand-bright">{icon}</div>
            <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</p>
                <p className="text-2xl font-extrabold text-brand-deep dark:text-brand-bright leading-tight">{value}</p>
            </div>
        </div>
    );
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={`bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-5 ${className}`}>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">{title}</h3>
            {children}
        </div>
    );
}

function Donut({ active, inactive, centerValue, centerLabel, activeLabel, inactiveLabel }: { active: number; inactive: number; centerValue: React.ReactNode; centerLabel: string; activeLabel: string; inactiveLabel: string }) {
    const total = active + inactive;
    const data = [{ name: activeLabel, value: active }, { name: inactiveLabel, value: inactive }];
    return (
        <div className="flex items-center gap-4">
            <div className="relative w-[130px] h-[130px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie data={data} dataKey="value" innerRadius={44} outerRadius={62} startAngle={90} endAngle={-270} paddingAngle={1}>
                            <Cell fill="#2f6fb3" /><Cell fill="#8ec5f0" />
                        </Pie>
                    </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-lg font-extrabold text-gray-900 dark:text-white">{centerValue}</span>
                    <span className="text-[9px] uppercase text-gray-400 tracking-wide text-center px-2">{centerLabel}</span>
                </div>
            </div>
            <div className="text-xs space-y-1.5">
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm bg-[#2f6fb3]" /><span className="text-gray-700 dark:text-gray-300">{activeLabel}</span><span className="font-bold text-gray-900 dark:text-white">{fmtNum(active)} {total > 0 && `(${Math.round(active / total * 100)}%)`}</span></div>
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm bg-[#8ec5f0]" /><span className="text-gray-700 dark:text-gray-300">{inactiveLabel}</span><span className="font-bold text-gray-900 dark:text-white">{fmtNum(inactive)} {total > 0 && `(${Math.round(inactive / total * 100)}%)`}</span></div>
            </div>
        </div>
    );
}

function HBar({ data, color, valueFmt }: { data: Array<{ name: string; value: number; label?: string }>; color: string; valueFmt: (v: number, row: any) => string }) {
    if (!data || data.length === 0) return <div className="h-32 flex items-center justify-center text-sm text-gray-400">—</div>;
    return (
        <ResponsiveContainer width="100%" height={Math.max(120, data.length * 46)}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
                <XAxis type="number" hide domain={[0, "auto"]} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any, _n: any, p: any) => valueFmt(Number(v), p?.payload)} />
                <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} barSize={22}>
                    <LabelList dataKey="value" position="right" formatter={(v: any) => valueFmt(Number(v), null)} style={{ fontSize: 11, fontWeight: 700, fill: "currentColor" }} className="fill-gray-700 dark:fill-gray-200" />
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
}

function LoadingBlock() {
    const t = useTranslations("M365Users");
    return <div className="flex flex-col items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" /><p className="text-gray-500 dark:text-gray-400">{t("loading")}</p></div>;
}
function ErrorBlock({ message }: { message: string }) {
    const t = useTranslations("M365Users");
    const missing = /MISSING_GRAPH_PERMISSIONS|graph|403/i.test(message);
    return (
        <div className="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 p-4 rounded-lg border border-amber-100 dark:border-amber-900/50">
            <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {missing ? t("graph_permissions_title") : "Error"}</h3>
            <p className="text-sm mt-1">{missing ? t("graph_permissions_desc") : message}</p>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
function DashboardTab() {
    const t = useTranslations("M365Users");
    const { data, error, isLoading } = useAuthedSWR<any>("/api/m365/overview");
    if (isLoading) return <LoadingBlock />;
    if (error) return <ErrorBlock message={error.message} />;
    if (!data) return null;
    const na = t("na");
    const signIn = data.capabilities?.signInActivity;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <BigKpi label={t("total_users")} value={fmtNum(data.kpis?.totalUsers)} icon={<Users className="w-5 h-5" />} />
                <BigKpi label={t("licensed_users")} value={fmtNum(data.kpis?.licensedUsers)} icon={<KeyRound className="w-5 h-5" />} />
                <BigKpi label={t("mfa_enforced_users")} value={data.kpis?.mfaEnforcedUsers != null ? fmtNum(data.kpis.mfaEnforcedUsers) : na} icon={<ShieldCheck className="w-5 h-5" />} />
                <BigKpi label={t("total_groups")} value={fmtNum(data.kpis?.totalGroups)} icon={<Boxes className="w-5 h-5" />} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title={t("user_activity")}>
                    <Donut active={data.userActivity?.active || 0} inactive={data.userActivity?.inactive || 0}
                        centerValue={fmtNum(data.userActivity?.blocked)} centerLabel={t("blocked_users")}
                        activeLabel={t("active")} inactiveLabel={t("inactive")} />
                </Card>
                <Card title={t("top_inactive_users")}>
                    {signIn ? <HBar data={(data.topInactiveUsers || []).map((u: any) => ({ name: u.name, value: u.days ?? 1000, label: u.days == null ? t("no_activity") : `${u.days} ${t("days")}` }))} color="#8ec5f0" valueFmt={(v, row) => row?.label ?? (v >= 1000 ? t("no_activity") : `${v} ${t("days")}`)} /> : <p className="text-sm text-gray-400 py-8 text-center">{t("requires_p1")}</p>}
                </Card>
                <Card title={t("groups_activity")}>
                    <Donut active={data.groupsActivity?.active || 0} inactive={data.groupsActivity?.inactive || 0}
                        centerValue={fmtNum(data.groupsActivity?.noOwner)} centerLabel={t("no_owner_groups")}
                        activeLabel={t("active")} inactiveLabel={t("inactive")} />
                </Card>

                <Card title={t("product_license")}>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 rounded-lg bg-gray-50 dark:bg-slate-800/50">
                            <p className="text-2xl font-extrabold text-gray-900 dark:text-white">{fmtNum(data.productLicense?.productCount)}</p>
                            <p className="text-[10px] uppercase text-gray-400">{t("products")}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-gray-50 dark:bg-slate-800/50">
                            <p className="text-2xl font-extrabold text-gray-900 dark:text-white">{data.productLicense?.unusedPct}%</p>
                            <p className="text-[10px] uppercase text-gray-400">{t("total_unused_licenses")}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-gray-50 dark:bg-slate-800/50 col-span-2">
                            <p className="text-xl font-extrabold text-gray-900 dark:text-white">{fmtNum(data.productLicense?.totalLicenses)}</p>
                            <p className="text-[10px] uppercase text-gray-400">{t("total_licenses")}</p>
                        </div>
                    </div>
                </Card>
                <Card title={t("top_unused_licenses")}>
                    <HBar data={(data.topUnusedLicenses || []).map((l: any) => ({ name: l.name, value: l.unused }))} color="#8ec5f0" valueFmt={(v) => fmtCompact(v)} />
                </Card>
                <Card title={t("top_inactive_groups")}>
                    <HBar data={(data.topInactiveGroups || []).map((g: any) => ({ name: g.name, value: g.days ?? 1000, label: g.days == null ? t("no_activity") : `${g.days} ${t("days")}` }))} color="#8ec5f0" valueFmt={(v, row) => row?.label ?? (v >= 1000 ? t("no_activity") : `${v} ${t("days")}`)} />
                </Card>

                <Card title={t("license_spend")} className="lg:col-span-1">
                    <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-center">
                        <p className="text-3xl font-extrabold text-emerald-600">{fmtUsd(data.productLicense?.totalSpend)}</p>
                        <p className="text-[11px] uppercase text-emerald-700/70 dark:text-emerald-400/70 mt-1">{t("monthly_est")}</p>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-2 flex items-start gap-1"><AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />{t("spend_estimate_note")}</p>
                </Card>
                <Card title={t("top_license_spend")}>
                    <HBar data={(data.topLicenseSpend || []).map((l: any) => ({ name: l.name, value: l.spend }))} color="#2f6fb3" valueFmt={(v) => fmtUsd(v)} />
                </Card>
                <Card title={t("auth_methods")}>
                    <HBar data={(data.authMethods || []).map((a: any) => ({ name: a.method, value: a.count }))} color="#2f6fb3" valueFmt={(v) => fmtNum(v)} />
                </Card>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
function UserActivityTab() {
    const t = useTranslations("M365Users");
    const { data, error, isLoading } = useAuthedSWR<any>("/api/m365/user-activity");
    const [status, setStatus] = useState("all");
    const [hasLicense, setHasLicense] = useState("all");
    const [product, setProduct] = useState("all");
    const [search, setSearch] = useState("");

    const products = useMemo(() => {
        const set = new Set<string>();
        (data?.rows || []).forEach((r: any) => (r.products || []).forEach((p: string) => set.add(p)));
        return Array.from(set).sort();
    }, [data]);

    const filtered = useMemo(() => {
        let rows = data?.rows || [];
        if (status === "enabled") rows = rows.filter((r: any) => r.accountEnabled);
        if (status === "disabled") rows = rows.filter((r: any) => !r.accountEnabled);
        if (hasLicense === "yes") rows = rows.filter((r: any) => r.licenseCount > 0);
        if (hasLicense === "no") rows = rows.filter((r: any) => r.licenseCount === 0);
        if (product !== "all") rows = rows.filter((r: any) => (r.products || []).includes(product));
        if (search) rows = rows.filter((r: any) => r.displayName.toLowerCase().includes(search.toLowerCase()) || (r.userPrincipalName || "").toLowerCase().includes(search.toLowerCase()));
        return rows;
    }, [data, status, hasLicense, product, search]);

    if (isLoading) return <LoadingBlock />;
    if (error) return <ErrorBlock message={error.message} />;
    if (!data) return null;
    const na = t("na");

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <BigKpi label={t("total_users")} value={fmtNum(data.kpis?.total)} icon={<Users className="w-5 h-5" />} />
                <BigKpi label={t("enabled_users")} value={fmtNum(data.kpis?.enabled)} icon={<Users className="w-5 h-5" />} />
                <BigKpi label={t("blocked_users")} value={fmtNum(data.kpis?.blocked)} icon={<UserX className="w-5 h-5" />} />
                <BigKpi label={t("active_users")} value={fmtNum(data.kpis?.active)} icon={<Users className="w-5 h-5" />} />
                <BigKpi label={t("inactive_users")} value={data.kpis?.inactive != null ? fmtNum(data.kpis.inactive) : na} icon={<UserX className="w-5 h-5" />} />
            </div>

            <div className="flex flex-wrap gap-2 items-center">
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("search")} className="px-3 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 dark:text-white" />
                <select value={status} onChange={e => setStatus(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 dark:text-white">
                    <option value="all">{t("account_status")}: {t("all")}</option>
                    <option value="enabled">{t("enabled")}</option>
                    <option value="disabled">{t("disabled")}</option>
                </select>
                <select value={hasLicense} onChange={e => setHasLicense(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 dark:text-white">
                    <option value="all">{t("has_license")}: {t("all")}</option>
                    <option value="yes">{t("yes")}</option>
                    <option value="no">{t("no")}</option>
                </select>
                <select value={product} onChange={e => setProduct(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 dark:text-white max-w-[220px]">
                    <option value="all">{t("product")}: {t("all")}</option>
                    {products.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                        <thead className="bg-gray-50 dark:bg-slate-800/60">
                            <tr>
                                {["display_name", "account_status", "last_activity_days", "product", "num_licenses", "upn"].map(k => (
                                    <th key={k} className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-bold p-3 whitespace-nowrap">{t(`col_${k}`)}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((r: any, i: number) => (
                                <tr key={i} className="border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/40 align-top">
                                    <td className="p-3 font-semibold text-gray-900 dark:text-white whitespace-nowrap">{r.displayName}</td>
                                    <td className="p-3">
                                        {r.accountEnabled
                                            ? <span className="text-emerald-600 dark:text-emerald-400 text-xs font-semibold">{t("enabled")}</span>
                                            : <span className="text-xs font-semibold px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300">{t("disabled")}</span>}
                                    </td>
                                    <td className="p-3 text-gray-600 dark:text-gray-300">{r.lastActivityDays != null ? r.lastActivityDays : na}</td>
                                    <td className="p-3 text-gray-600 dark:text-gray-300 max-w-[380px]">{(r.products || []).join(", ") || "—"}</td>
                                    <td className="p-3 text-gray-600 dark:text-gray-300">{r.licenseCount}</td>
                                    <td className="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.userPrincipalName}</td>
                                </tr>
                            ))}
                            {filtered.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400">{t("no_users")}</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: License Optimization (fusionado desde la antigua página "Licencias")
// AHUB missing-benefit (Resource Graph) + métricas por SKU (Graph subscribedSkus).
// ─────────────────────────────────────────────────────────────────────────────
function useLicensesData() {
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<{ message: string; needsConsent?: boolean } | null>(null);
    const [graphError, setGraphError] = useState<{ message: string; needsConsent?: boolean } | null>(null);

    React.useEffect(() => {
        if (!selectedTenant || selectedTenant.id === "default") return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError(null);
            setGraphError(null);
            try {
                const idToken = accounts.length ? await getFreshIdToken(instance, accounts[0], ["User.Read"]) : null;
                const res = await fetch("/api/intelligence/licenses", {
                    headers: { "x-tenant-id": selectedTenant.id, ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
                });
                const json = await res.json();
                if (cancelled) return;
                if (json.success) {
                    setData(json.data);
                    if (json.data.graphError) setGraphError({ message: json.data.graphError, needsConsent: json.data.needsConsent });
                } else {
                    setError({ message: json.error || "Error desconocido", needsConsent: json.needsConsent });
                }
            } catch (e: any) {
                if (!cancelled) setError({ message: e.message || "Error de red" });
            }
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [selectedTenant, accounts, instance]);

    return { data, loading, error, graphError };
}

function LicenseOptimizationTab() {
    const t = useTranslations("M365Users");
    const { data, loading, error, graphError } = useLicensesData();
    const licenses = data?.licenses || [];
    const missingAhub = data?.missingAhub || [];
    const ahub = usePagination<any>(missingAhub, 15);
    const skus = usePagination<any>(licenses, 15);

    if (error) return <ErrorBlock message={error.message} />;

    const total = licenses.reduce((s: number, l: any) => s + l.total, 0);
    const consumed = licenses.reduce((s: number, l: any) => s + l.consumed, 0);
    const available = licenses.reduce((s: number, l: any) => s + l.available, 0);
    const underutilized = licenses.reduce((s: number, l: any) => s + l.underutilized, 0);
    const ahubSavings = missingAhub.reduce((s: number, i: any) => s + i.potentialLicenseSavings, 0);

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <BigKpi label={t("lic_total")} value={loading ? "…" : fmtNum(total)} icon={<KeyRound className="w-5 h-5" />} />
                <BigKpi label={t("lic_assigned")} value={loading ? "…" : fmtNum(consumed)} icon={<Users className="w-5 h-5" />} />
                <BigKpi label={t("lic_available")} value={loading ? "…" : fmtNum(available)} icon={<Package className="w-5 h-5" />} />
                <BigKpi label={t("lic_underutilized")} value={loading ? "…" : fmtNum(underutilized)} icon={<UserX className="w-5 h-5" />} />
                <BigKpi label={t("ahub_potential_savings")} value={loading ? "…" : fmtUsd(ahubSavings)} icon={<Cpu className="w-5 h-5" />} />
            </div>

            <Card title={t("ahub_title")}>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{t("ahub_desc")}</p>
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm table-fixed min-w-[760px]">
                        <thead className="bg-gray-50 dark:bg-slate-800/60">
                            <tr>
                                {["resource", "type", "subscription", "resource_group", "location", "monthly_savings"].map(k => (
                                    <ResizableTh key={k} className="bg-gray-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-bold p-3">{t(`col_${k}`)}</ResizableTh>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading && <tr><td colSpan={6} className="p-8 text-center text-gray-400">{t("loading")}</td></tr>}
                            {!loading && missingAhub.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400 text-sm">{t("ahub_none")}</td></tr>}
                            {!loading && ahub.paged.map((item: any, i: number) => {
                                const isSqlPool = item.scope === "elasticPool";
                                return (
                                    <tr key={i} className="border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/40 align-top">
                                        <td className="p-3 font-semibold text-gray-900 dark:text-white whitespace-normal break-words">
                                            {item.name}
                                            {isSqlPool && <div className="text-[10px] font-normal text-gray-400 mt-0.5">{t("ahub_pool_note")}</div>}
                                        </td>
                                        <td className="p-3 text-gray-600 dark:text-gray-300 whitespace-normal">{item.type === "microsoft.compute/virtualmachines" ? "Virtual Machine" : (isSqlPool ? "SQL Elastic Pool" : "SQL Database")}</td>
                                        <td className="p-3 text-gray-600 dark:text-gray-300 whitespace-normal break-words">{item.subscriptionId}</td>
                                        <td className="p-3 text-gray-600 dark:text-gray-300 whitespace-normal break-words">{item.resourceGroup}</td>
                                        <td className="p-3 text-gray-600 dark:text-gray-300 whitespace-normal">{item.location}</td>
                                        <td className="p-3 font-bold text-emerald-600 whitespace-normal">{fmtUsd(item.potentialLicenseSavings)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {!loading && missingAhub.length > 15 && (
                    <div className="pt-3"><Pagination page={ahub.page} setPage={ahub.setPage} pageSize={ahub.pageSize} setPageSize={ahub.setPageSize} total={ahub.total} totalPages={ahub.totalPages} pageSizes={[15, 25, 50]} /></div>
                )}
            </Card>

            {graphError && (
                <div className="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 p-4 rounded-lg border border-amber-100 dark:border-amber-900/50">
                    <h3 className="font-bold flex items-center gap-2"><ShieldQuestion className="w-4 h-4" /> {t("graph_permissions_title")}</h3>
                    <p className="text-sm mt-1">{t("graph_permissions_desc")}</p>
                </div>
            )}

            {!graphError && (
                <Card title={t("sku_metrics_title")}>
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm table-fixed min-w-[680px]">
                            <thead className="bg-gray-50 dark:bg-slate-800/60">
                                <tr>
                                    {["sku", "total", "in_use", "available", "underutil_risk", "wasted_spend"].map(k => (
                                        <ResizableTh key={k} className="bg-gray-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-bold p-3">{t(`col_${k}`)}</ResizableTh>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {loading && <tr><td colSpan={6} className="p-8 text-center text-gray-400">{t("loading")}</td></tr>}
                                {!loading && licenses.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400 text-sm">{t("no_data")}</td></tr>}
                                {!loading && skus.paged.map((l: any) => (
                                    <tr key={l.id} className={`border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/40 align-top ${l.isSystemSku ? "opacity-60" : ""}`}>
                                        <td className="p-3 font-semibold text-gray-900 dark:text-white whitespace-normal break-words">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                {l.skuPartNumber}
                                                {l.isSystemSku && <span className="text-[10px] font-semibold bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-300 px-1.5 py-0.5 rounded">{t("sku_system")}</span>}
                                            </div>
                                        </td>
                                        <td className="p-3 text-gray-600 dark:text-gray-300">{l.total}</td>
                                        <td className="p-3 text-gray-600 dark:text-gray-300">{l.consumed}</td>
                                        <td className="p-3 text-emerald-600 font-semibold">{l.available}</td>
                                        <td className={`p-3 font-semibold ${l.isSystemSku ? "text-gray-400" : "text-rose-600"}`}>{l.underutilized}</td>
                                        <td className={`p-3 font-bold ${l.isSystemSku ? "text-gray-400" : "text-rose-600"}`}>{fmtUsd(l.wastedCost)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {!loading && licenses.length > 15 && (
                        <div className="pt-3"><Pagination page={skus.page} setPage={skus.setPage} pageSize={skus.pageSize} setPageSize={skus.setPageSize} total={skus.total} totalPages={skus.totalPages} pageSizes={[15, 25, 50]} /></div>
                    )}
                </Card>
            )}
        </div>
    );
}

export default function M365UsersBoard() {
    const t = useTranslations("M365Users");
    const { selectedTenant } = useTenant();
    const [tab, setTab] = useState<"dashboard" | "activity" | "licenseopt">("dashboard");
    if (!selectedTenant || selectedTenant.id === "default") return null;

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><Users className="w-5 h-5 text-brand-deep" />{t("title")}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t("subtitle")}</p>
            </div>
            <div className="flex gap-1 border-b border-gray-200 dark:border-slate-800">
                <button onClick={() => setTab("dashboard")} className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold border-b-2 transition-colors ${tab === "dashboard" ? "border-brand-deep text-brand-deep dark:text-brand-bright" : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}><Package className="w-4 h-4" /> {t("tab_dashboard")}</button>
                <button onClick={() => setTab("activity")} className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold border-b-2 transition-colors ${tab === "activity" ? "border-brand-deep text-brand-deep dark:text-brand-bright" : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}><Users className="w-4 h-4" /> {t("tab_user_activity")}</button>
                <button onClick={() => setTab("licenseopt")} className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold border-b-2 transition-colors ${tab === "licenseopt" ? "border-brand-deep text-brand-deep dark:text-brand-bright" : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}><Cpu className="w-4 h-4" /> {t("tab_license_optimization")}</button>
            </div>
            {tab === "dashboard" ? <DashboardTab /> : tab === "activity" ? <UserActivityTab /> : <LicenseOptimizationTab />}
        </div>
    );
}
