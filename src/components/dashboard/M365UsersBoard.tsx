"use client";
import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import {
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    LabelList,
    Tooltip as RechartsTooltip,
} from "recharts";
import {
    IconUsers,
    IconKey,
    IconShieldCheck,
    IconCirclesRelation,
    IconUserX,
    IconPackage,
    IconLoader2,
    IconAlertTriangle,
    IconSearch,
    IconChevronLeft,
    IconChevronRight,
    IconUserCheck,
    IconUserOff,
    IconClock,
    IconLicense,
    IconBuildingSkyscraper,
    IconSparkles,
    IconShieldQuestion,
    IconCheck,
    IconX,
} from "@tabler/icons-react";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import MockBanner from "@/components/MockBanner";
import { useCurrency } from "@/components/CurrencyProvider";

const BLUE = { deep: "#0078D4", cobalt: "#2563EB", cyan: "#0284C7", sky: "#38BDF8", ice: "#93C5FD", slate: "#94A3B8" };

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

function BigKpi({ label, value, icon, sub, tooltip }: { label: string; value: React.ReactNode; icon: React.ReactNode; sub?: string; tooltip?: string }) {
    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex items-center gap-3">
            <div className="shrink-0">{icon}</div>
            <div className="min-w-0">
                <div className="flex items-center gap-1">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
                    {tooltip && <InfoTooltip content={tooltip} />}
                </div>
                <p className="text-xl font-extrabold text-[#1B2A41] dark:text-slate-100 leading-tight">{value}</p>
                {sub && <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{sub}</p>}
            </div>
        </div>
    );
}

function Card({ title, tooltip, children, className = "" }: { title: string; tooltip?: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 ${className}`}>
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-4 flex items-center gap-1.5">{title}{tooltip && <InfoTooltip content={tooltip} />}</h3>
            {children}
        </div>
    );
}

function Donut({ active, inactive, centerValue, centerLabel, activeLabel, inactiveLabel, activeColor = BLUE.deep, inactiveColor = BLUE.slate }: { active: number; inactive: number; centerValue: React.ReactNode; centerLabel: string; activeLabel: string; inactiveLabel: string; activeColor?: string; inactiveColor?: string }) {
    const total = active + inactive;
    const data = [{ name: activeLabel, value: active }, { name: inactiveLabel, value: inactive }];
    return (
        <div className="flex items-center gap-4">
            <div className="relative w-[130px] h-[130px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie data={data} dataKey="value" innerRadius={44} outerRadius={62} startAngle={90} endAngle={-270} paddingAngle={1}>
                            <Cell fill={activeColor} /><Cell fill={inactiveColor} />
                        </Pie>
                    </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-lg font-extrabold text-[#1B2A41] dark:text-slate-100">{centerValue}</span>
                    <span className="text-[9px] uppercase text-slate-400 tracking-wide text-center px-2">{centerLabel}</span>
                </div>
            </div>
            <div className="text-xs space-y-1.5">
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: activeColor }} /><span className="text-slate-600 dark:text-slate-400">{activeLabel}</span><span className="font-bold text-[#1B2A41] dark:text-slate-100">{active} {total > 0 && `(${Math.round(active / total * 100)}%)`}</span></div>
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: inactiveColor }} /><span className="text-slate-600 dark:text-slate-400">{inactiveLabel}</span><span className="font-bold text-[#1B2A41] dark:text-slate-100">{inactive} {total > 0 && `(${Math.round(inactive / total * 100)}%)`}</span></div>
            </div>
        </div>
    );
}

function HBar({ data, color = BLUE.deep, valueFmt }: { data: Array<{ name: string; value: number; label?: string }>; color?: string; valueFmt: (v: number, row: any) => string }) {
    if (!data || data.length === 0) return <div className="h-32 flex items-center justify-center text-sm text-slate-400">—</div>;
    return (
        <ResponsiveContainer width="100%" height={Math.max(120, data.length * 46)}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
                <XAxis type="number" hide domain={[0, "auto"]} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: "#64748B" }} />
                <RechartsTooltip contentStyle={{ backgroundColor: "#1B2A41", border: "1px solid #475569", borderRadius: "8px", color: "#FFFFFF", fontSize: "11px" }} formatter={(v: any, _n: any, p: any) => valueFmt(Number(v), p?.payload)} />
                <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} barSize={22}>
                    <LabelList dataKey="value" position="right" formatter={(v: any) => valueFmt(Number(v), null)} style={{ fontSize: 11, fontWeight: 700, fill: "currentColor" }} className="fill-slate-600 dark:fill-slate-300" />
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
}

function LoadingBlock() {
    const t = useTranslations("M365Users");
    return <div className="flex flex-col items-center justify-center py-20"><IconLoader2 className="w-8 h-8 animate-spin text-[#0054A6] mb-4" stroke={1.5} /><p className="text-slate-500 dark:text-slate-400">{t("loading")}</p></div>;
}

function ErrorBlock({ message }: { message: string }) {
    const t = useTranslations("M365Users");
    const missing = /MISSING_GRAPH_PERMISSIONS|graph|403/i.test(message);
    return (
        <div className="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 p-4 rounded-lg border border-amber-200 dark:border-amber-900/50">
            <h3 className="font-bold flex items-center gap-2"><IconAlertTriangle className="w-4 h-4 text-[#0054A6]" stroke={1.5} /> {missing ? t("graph_permissions_title") : "Error"}</h3>
            <p className="text-sm mt-1">{missing ? t("graph_permissions_desc") : message}</p>
        </div>
    );
}

// ═══ TAB 1: DASHBOARD ═══
function DashboardTab() {
    const t = useTranslations("M365Users");
    const { format } = useCurrency();
    const { data, error, isLoading } = useAuthedSWR<any>("/api/m365/overview");
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id || "";
    if (isLoading) return <LoadingBlock />;
    if (error) return <ErrorBlock message={error.message} />;
    if (!data) return null;
    const isMock = data.mock || isMockTenant(tenantId);
    const na = t("na");
    const signIn = data.capabilities?.signInActivity;
    const mfaPct = data.kpis?.mfaEnforcedUsers != null && data.kpis?.totalUsers > 0 ? `${Math.round((data.kpis.mfaEnforcedUsers / data.kpis.totalUsers) * 100)}%` : na;

    return (
        <div className="space-y-4">
            {isMock && <MockBanner />}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <BigKpi label={t("total_users")} value={data.kpis?.totalUsers ?? na} icon={<IconUsers className="w-5 h-5 text-[#0078D4]" stroke={1.5} />} sub={t("members_guests", { members: (data.kpis?.totalUsers || 0) - 2, guests: 2 })} tooltip={t("tooltip_total_users")} />
                <BigKpi label={t("licensed_users")} value={data.kpis?.licensedUsers ?? na} icon={<IconKey className="w-5 h-5 text-[#0078D4]" stroke={1.5} />} tooltip={t("tooltip_licensed_users")} />
                <BigKpi label={t("mfa_enforced_users")} value={data.kpis?.mfaEnforcedUsers != null ? `${data.kpis.mfaEnforcedUsers} (${mfaPct})` : na} icon={<IconShieldCheck className="w-5 h-5 text-[#0078D4]" stroke={1.5} />} sub={data.kpis?.mfaEnforcedUsers == null ? t("requires_graph_perm") : undefined} tooltip={t("tooltip_mfa")} />
                <BigKpi label={t("total_groups")} value={data.kpis?.totalGroups ?? na} icon={<IconCirclesRelation className="w-5 h-5 text-[#0078D4]" stroke={1.5} />} sub={data.groupsActivity?.noOwner > 0 ? t("orphan_groups_warning", { count: data.groupsActivity.noOwner }) : undefined} tooltip={t("tooltip_total_groups")} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title={t("user_activity")} tooltip={t("tooltip_user_activity")}><Donut active={data.userActivity?.active || 0} inactive={data.userActivity?.inactive || 0} centerValue={data.userActivity?.blocked ?? 0} centerLabel={t("blocked_users")} activeLabel={t("active")} inactiveLabel={t("inactive")} activeColor={BLUE.deep} inactiveColor={BLUE.slate} /></Card>
                <Card title={t("top_inactive_users")} tooltip={t("tooltip_top_inactive_users")}>{signIn ? <HBar data={(data.topInactiveUsers || []).map((u: any) => ({ name: u.name, value: u.days ?? 1000, label: u.days == null ? t("no_activity") : `${u.days} ${t("days")}` }))} color={BLUE.sky} valueFmt={(v, row) => row?.label ?? (v >= 1000 ? t("no_activity") : `${v} ${t("days")}`)} /> : <p className="text-sm text-slate-400 py-8 text-center">{t("requires_p1")}</p>}</Card>
                <Card title={t("groups_activity")} tooltip={t("tooltip_groups_activity")}><Donut active={data.groupsActivity?.active || 0} inactive={data.groupsActivity?.inactive || 0} centerValue={data.groupsActivity?.noOwner ?? 0} centerLabel={t("no_owner_groups")} activeLabel={t("active")} inactiveLabel={t("inactive")} activeColor={BLUE.cobalt} inactiveColor={BLUE.slate} /></Card>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title={t("product_license")} tooltip={t("tooltip_product_license")}>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700"><p className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">{data.productLicense?.productCount ?? 0}</p><p className="text-[10px] uppercase text-slate-400">{t("products")}</p></div>
                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700"><p className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">{data.productLicense?.unusedPct ?? 0}%</p><p className="text-[10px] uppercase text-slate-400">{t("total_unused_licenses")}</p></div>
                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 col-span-2"><p className="text-xl font-extrabold text-[#1B2A41] dark:text-slate-100">{data.productLicense?.totalLicenses ?? 0}</p><p className="text-[10px] uppercase text-slate-400">{t("total_licenses")}</p></div>
                    </div>
                </Card>
                <Card title={t("top_unused_licenses")} tooltip={t("tooltip_top_unused_licenses")}><HBar data={(data.topUnusedLicenses || []).map((l: any) => ({ name: l.name, value: l.unused }))} color={BLUE.cyan} valueFmt={(v) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v)} /></Card>
                <Card title={t("top_inactive_groups")} tooltip={t("tooltip_top_inactive_groups")}><HBar data={(data.topInactiveGroups || []).map((g: any) => ({ name: g.name, value: g.days ?? 1000, label: g.days == null ? t("no_activity") : `${g.days} ${t("days")}` }))} color={BLUE.sky} valueFmt={(v, row) => row?.label ?? (v >= 1000 ? t("no_activity") : `${v} ${t("days")}`)} /></Card>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title={t("license_spend")} tooltip={t("tooltip_license_spend")}>
                    <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-center"><p className="text-3xl font-extrabold text-[#0078D4]">{format(data.productLicense?.totalSpend || 0)}</p><p className="text-[11px] uppercase text-slate-500 dark:text-slate-400 mt-1">{t("monthly_est")}</p></div>
                    <p className="text-[10px] text-slate-400 mt-2 flex items-start gap-1"><IconAlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-[#0078D4]" stroke={1.5} />{t("spend_estimate_note")}</p>
                </Card>
                <Card title={t("top_license_spend")} tooltip={t("tooltip_top_license_spend")}><HBar data={(data.topLicenseSpend || []).map((l: any) => ({ name: l.name, value: l.spend }))} color={BLUE.deep} valueFmt={(v) => format(v)} /></Card>
                <Card title={t("auth_methods")} tooltip={t("tooltip_auth_methods")}>{data.capabilities?.mfa === false ? <p className="text-sm text-amber-600 dark:text-amber-400 py-6 text-center flex flex-col items-center gap-2"><IconShieldQuestion className="w-6 h-6 text-[#0078D4]" stroke={1.5} />{t("requires_graph_perm")}</p> : <HBar data={(data.authMethods || []).map((a: any) => ({ name: a.method, value: a.count }))} color={BLUE.deep} valueFmt={(v) => new Intl.NumberFormat("en-US").format(v)} />}</Card>
            </div>
        </div>
    );
}

// ═══ TAB 2: USER ACTIVITY ═══
function UserActivityTab() {
    const t = useTranslations("M365Users");
    const { data, error, isLoading } = useAuthedSWR<any>("/api/m365/user-activity");
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id || "";
    const [status, setStatus] = useState("all");
    const [hasLicense, setHasLicense] = useState("all");
    const [product, setProduct] = useState("all");
    const [search, setSearch] = useState("");
    const [pageSize, setPageSize] = useState(15);
    const [currentPage, setCurrentPage] = useState(1);
    const products = useMemo(() => { const set = new Set<string>(); (data?.rows || []).forEach((r: any) => (r.products || []).forEach((p: string) => set.add(p))); return Array.from(set).sort(); }, [data]);
    const filtered = useMemo(() => { let rows = data?.rows || []; if (status === "enabled") rows = rows.filter((r: any) => r.accountEnabled); if (status === "disabled") rows = rows.filter((r: any) => !r.accountEnabled); if (hasLicense === "yes") rows = rows.filter((r: any) => r.licenseCount > 0); if (hasLicense === "no") rows = rows.filter((r: any) => r.licenseCount === 0); if (product !== "all") rows = rows.filter((r: any) => (r.products || []).includes(product)); if (search) rows = rows.filter((r: any) => r.displayName.toLowerCase().includes(search.toLowerCase()) || (r.userPrincipalName || "").toLowerCase().includes(search.toLowerCase())); return rows; }, [data, status, hasLicense, product, search]);
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const paginated = useMemo(() => { const start = (currentPage - 1) * pageSize; return filtered.slice(start, start + pageSize); }, [filtered, currentPage, pageSize]);
    if (isLoading) return <LoadingBlock />;
    if (error) return <ErrorBlock message={error.message} />;
    if (!data) return null;
    const isMock = data.mock || isMockTenant(tenantId);
    const na = t("na");
    return (
        <div className="space-y-4">
            {isMock && <MockBanner />}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <BigKpi label={t("total_users")} value={data.kpis?.total ?? na} icon={<IconUsers className="w-5 h-5 text-[#0078D4]" stroke={1.5} />} />
                <BigKpi label={t("enabled_users")} value={data.kpis?.enabled ?? na} icon={<IconUserCheck className="w-5 h-5 text-[#0078D4]" stroke={1.5} />} />
                <BigKpi label={t("blocked_users")} value={data.kpis?.blocked ?? na} icon={<IconUserOff className="w-5 h-5 text-[#0078D4]" stroke={1.5} />} />
                <BigKpi label={t("active_users")} value={data.kpis?.active ?? na} icon={<IconUserCheck className="w-5 h-5 text-[#0078D4]" stroke={1.5} />} />
                <BigKpi label={t("inactive_users")} value={data.kpis?.inactive != null ? data.kpis.inactive : na} icon={<IconClock className="w-5 h-5 text-[#0078D4]" stroke={1.5} />} />
            </div>
            {data.capabilities?.signInActivity === false && <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-lg px-3 py-2"><IconShieldQuestion className="w-3.5 h-3.5 shrink-0 text-[#0078D4]" stroke={1.5} />{t("requires_graph_perm")}</p>}
            <div className="flex flex-wrap gap-2 items-center">
                <div className="relative"><IconSearch className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" stroke={1.5} /><input value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} placeholder={t("search")} className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-[#1B2A41] dark:text-slate-200 w-48" /></div>
                <select value={status} onChange={e => { setStatus(e.target.value); setCurrentPage(1); }} className="px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-[#1B2A41] dark:text-slate-200"><option value="all">{t("account_status")}: {t("all")}</option><option value="enabled">{t("enabled")}</option><option value="disabled">{t("disabled")}</option></select>
                <select value={hasLicense} onChange={e => { setHasLicense(e.target.value); setCurrentPage(1); }} className="px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-[#1B2A41] dark:text-slate-200"><option value="all">{t("has_license")}: {t("all")}</option><option value="yes">{t("yes")}</option><option value="no">{t("no")}</option></select>
                <select value={product} onChange={e => { setProduct(e.target.value); setCurrentPage(1); }} className="px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-[#1B2A41] dark:text-slate-200 max-w-[220px]"><option value="all">{t("product")}: {t("all")}</option>{products.map(p => <option key={p} value={p}>{p}</option>)}</select>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                        <thead className="bg-slate-50/50 dark:bg-slate-800/50"><tr>{["display_name","account_status","last_activity_days","product","num_licenses","upn"].map(k => <ResizableTh key={k}><span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold">{t(`col_${k}`)}</span></ResizableTh>)}</tr></thead>
                        <tbody>
                            {paginated.map((r: any, i: number) => (
                                <tr key={i} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 align-top">
                                    <td className="p-3 font-semibold text-[#1B2A41] dark:text-slate-200 whitespace-nowrap">{r.displayName}</td>
                                    <td className="p-3">{r.accountEnabled ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"><IconCheck className="w-3 h-3" stroke={2} />{t("enabled")}</span> : <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"><IconX className="w-3 h-3" stroke={2} />{t("disabled")}</span>}</td>
                                    <td className="p-3 text-slate-600 dark:text-slate-300">{r.lastActivityDays === -1 ? <span className="text-amber-600 dark:text-amber-400 text-[11px]">{t("no_graph_data")}</span> : r.lastActivityDays != null ? r.lastActivityDays : na}</td>
                                    <td className="p-3 text-slate-600 dark:text-slate-300 max-w-[380px]">{(r.products || []).join(", ") || "—"}</td>
                                    <td className="p-3 text-slate-600 dark:text-slate-300">{r.licenseCount}</td>
                                    <td className="p-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">{r.userPrincipalName}</td>
                                </tr>
                            ))}
                            {filtered.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400">{t("no_users")}</td></tr>}
                        </tbody>
                    </table>
                </div>
                {filtered.length > 0 && (
                    <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-2 text-xs text-slate-500"><span>{t("per_page")}</span><select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }} className="border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 bg-white dark:bg-slate-800 text-xs">{[15,30,45,60].map(s => <option key={s} value={s}>{s}</option>)}</select><span>{t("pagination_showing", { from: (currentPage-1)*pageSize+1, to: Math.min(currentPage*pageSize, filtered.length), total: filtered.length })}</span></div>
                        <div className="flex items-center gap-1"><button onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage===1} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"><IconChevronLeft className="w-4 h-4" stroke={1.5} /></button><span className="text-xs text-slate-500 px-2">{t("page", { current: currentPage, total: totalPages })}</span><button onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage===totalPages} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"><IconChevronRight className="w-4 h-4" stroke={1.5} /></button></div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ═══ TAB 3: LICENSE OPTIMIZATION ═══
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
            setLoading(true); setError(null); setGraphError(null);
            try {
                const idToken = accounts.length ? await getFreshIdToken(instance, accounts[0], ["User.Read"]) : null;
                const res = await fetch("/api/intelligence/licenses", { headers: { "x-tenant-id": selectedTenant.id, ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) } });
                const json = await res.json();
                if (cancelled) return;
                if (json.success) { setData(json.data); if (json.data.graphError) setGraphError({ message: json.data.graphError, needsConsent: json.data.needsConsent }); }
                else setError({ message: json.error || "Error desconocido", needsConsent: json.needsConsent });
            } catch (e: any) { if (!cancelled) setError({ message: e.message || "Error de red" }); }
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [selectedTenant, accounts, instance]);
    return { data, loading, error, graphError };
}

function LicenseOptimizationTab() {
    const t = useTranslations("M365Users");
    const { format } = useCurrency();
    const { data, loading, error, graphError } = useLicensesData();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id || "";
    const licenses = data?.licenses || [];
    const missingAhub = data?.missingAhub || [];
    const [ahubPage, setAhubPage] = useState(1); const [ahubPageSize, setAhubPageSize] = useState(15);
    const [skuPage, setSkuPage] = useState(1); const [skuPageSize, setSkuPageSize] = useState(15);
    const isMock = isMockTenant(tenantId);
    if (error) return <ErrorBlock message={error.message} />;
    const total = licenses.reduce((s: number, l: any) => s + l.total, 0);
    const consumed = licenses.reduce((s: number, l: any) => s + l.consumed, 0);
    const available = licenses.reduce((s: number, l: any) => s + l.available, 0);
    const underutilized = licenses.reduce((s: number, l: any) => s + l.underutilized, 0);
    const ahubSavings = missingAhub.reduce((s: number, i: any) => s + i.potentialLicenseSavings, 0);
    const ahubTotalPages = Math.max(1, Math.ceil(missingAhub.length / ahubPageSize));
    const ahubPaged = missingAhub.slice((ahubPage-1)*ahubPageSize, ahubPage*ahubPageSize);
    const skuTotalPages = Math.max(1, Math.ceil(licenses.length / skuPageSize));
    const skuPaged = licenses.slice((skuPage-1)*skuPageSize, skuPage*skuPageSize);
    return (
        <div className="space-y-4">
            {isMock && <MockBanner />}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <BigKpi label={t("lic_total")} value={loading ? "…" : total} icon={<IconLicense className="w-5 h-5 text-[#0078D4]" stroke={1.5} />} />
                <BigKpi label={t("lic_assigned")} value={loading ? "…" : consumed} icon={<IconUsers className="w-5 h-5 text-[#0078D4]" stroke={1.5} />} />
                <BigKpi label={t("lic_available")} value={loading ? "…" : available} icon={<IconPackage className="w-5 h-5 text-[#0078D4]" stroke={1.5} />} />
                <BigKpi label={t("lic_underutilized")} value={loading ? "…" : underutilized} icon={<IconUserX className="w-5 h-5 text-[#0078D4]" stroke={1.5} />} />
                <BigKpi label={t("ahub_potential_savings")} value={loading ? "…" : format(ahubSavings)} icon={<IconSparkles className="w-5 h-5 text-[#0078D4]" stroke={1.5} />} />
            </div>
            <Card title={t("ahub_title")} tooltip={t("tooltip_ahub")}><p className="text-xs text-slate-400 dark:text-slate-500 mb-3">{t("ahub_desc")}</p>
                <div className="overflow-x-auto"><table className="w-full border-collapse text-xs table-fixed min-w-[760px]"><thead className="bg-slate-50/50 dark:bg-slate-800/50"><tr>{["resource","type","subscription","resource_group","location","monthly_savings"].map(k => <ResizableTh key={k}><span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold">{t(`col_${k}`)}</span></ResizableTh>)}</tr></thead>
                    <tbody>{loading && <tr><td colSpan={6} className="p-8 text-center text-slate-400">{t("loading")}</td></tr>}{!loading && missingAhub.length===0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400 text-xs">{t("ahub_none")}</td></tr>}{!loading && ahubPaged.map((item: any, i: number) => { const isSqlPool = item.scope==="elasticPool"; return (<tr key={i} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 align-top"><td className="p-3 font-semibold text-[#1B2A41] dark:text-slate-200 whitespace-normal break-words">{item.name}{isSqlPool && <div className="text-[10px] font-normal text-slate-400 mt-0.5">{t("ahub_pool_note")}</div>}</td><td className="p-3 text-slate-600 dark:text-slate-300 whitespace-normal">{item.type==="microsoft.compute/virtualmachines"?"Virtual Machine":isSqlPool?"SQL Elastic Pool":"SQL Database"}</td><td className="p-3 text-slate-600 dark:text-slate-300 whitespace-normal break-words">{item.subscriptionId}</td><td className="p-3 text-slate-600 dark:text-slate-300 whitespace-normal break-words">{item.resourceGroup}</td><td className="p-3 text-slate-600 dark:text-slate-300 whitespace-normal">{item.location}</td><td className="p-3 font-bold text-emerald-600 whitespace-normal">{format(item.potentialLicenseSavings)}</td></tr>); })}</tbody></table></div>
                {!loading && missingAhub.length > ahubPageSize && (<div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 mt-3"><div className="flex items-center gap-2 text-xs text-slate-500"><span>{t("per_page")}</span><select value={ahubPageSize} onChange={e => { setAhubPageSize(Number(e.target.value)); setAhubPage(1); }} className="border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 bg-white dark:bg-slate-800 text-xs">{[15,25,50].map(s => <option key={s} value={s}>{s}</option>)}</select></div><div className="flex items-center gap-1"><button onClick={() => setAhubPage(p => Math.max(1,p-1))} disabled={ahubPage===1} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"><IconChevronLeft className="w-4 h-4" stroke={1.5} /></button><span className="text-xs text-slate-500 px-2">{t("page",{current:ahubPage,total:ahubTotalPages})}</span><button onClick={() => setAhubPage(p => Math.min(ahubTotalPages,p+1))} disabled={ahubPage===ahubTotalPages} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"><IconChevronRight className="w-4 h-4" stroke={1.5} /></button></div></div>)}
            </Card>
            {graphError && (<div className="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 p-4 rounded-lg border border-amber-200 dark:border-amber-900/50"><h3 className="font-bold flex items-center gap-2"><IconShieldQuestion className="w-4 h-4 text-[#0078D4]" stroke={1.5} />{t("graph_permissions_title")}</h3><p className="text-sm mt-1">{t("graph_permissions_desc")}</p></div>)}
            {!graphError && (<Card title={t("sku_metrics_title")} tooltip={t("tooltip_sku_metrics")}><div className="overflow-x-auto"><table className="w-full border-collapse text-xs table-fixed min-w-[680px]"><thead className="bg-slate-50/50 dark:bg-slate-800/50"><tr>{["sku","total","in_use","available","underutil_risk","wasted_spend"].map(k => <ResizableTh key={k}><span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold">{t(`col_${k}`)}</span></ResizableTh>)}</tr></thead><tbody>{loading && <tr><td colSpan={6} className="p-8 text-center text-slate-400">{t("loading")}</td></tr>}{!loading && licenses.length===0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400 text-xs">{t("no_data")}</td></tr>}{!loading && skuPaged.map((l: any) => (<tr key={l.id} className={`border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 align-top ${l.isSystemSku?"opacity-60":""}`}><td className="p-3 font-semibold text-[#1B2A41] dark:text-slate-200 whitespace-normal break-words"><div className="flex items-center gap-1.5 flex-wrap">{l.skuPartNumber}{l.isSystemSku && <span className="text-[10px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 px-1.5 py-0.5 rounded">{t("sku_system")}</span>}</div></td><td className="p-3 text-slate-600 dark:text-slate-300">{l.total}</td><td className="p-3 text-slate-600 dark:text-slate-300">{l.consumed}</td><td className="p-3 text-emerald-600 font-semibold">{l.available}</td><td className={`p-3 font-semibold ${l.isSystemSku?"text-slate-400":"text-red-600"}`}>{l.underutilized}</td><td className={`p-3 font-bold ${l.isSystemSku?"text-slate-400":"text-red-600"}`}>{format(l.wastedCost)}</td></tr>))}</tbody></table></div>{!loading && licenses.length > skuPageSize && (<div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 mt-3"><div className="flex items-center gap-2 text-xs text-slate-500"><span>{t("per_page")}</span><select value={skuPageSize} onChange={e => { setSkuPageSize(Number(e.target.value)); setSkuPage(1); }} className="border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 bg-white dark:bg-slate-800 text-xs">{[15,25,50].map(s => <option key={s} value={s}>{s}</option>)}</select></div><div className="flex items-center gap-1"><button onClick={() => setSkuPage(p => Math.max(1,p-1))} disabled={skuPage===1} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"><IconChevronLeft className="w-4 h-4" stroke={1.5} /></button><span className="text-xs text-slate-500 px-2">{t("page",{current:skuPage,total:skuTotalPages})}</span><button onClick={() => setSkuPage(p => Math.min(skuTotalPages,p+1))} disabled={skuPage===skuTotalPages} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"><IconChevronRight className="w-4 h-4" stroke={1.5} /></button></div></div>)}</Card>)}
        </div>
    );
}

// ═══ MAIN EXPORT ═══
export default function M365UsersBoard() {
    const t = useTranslations("M365Users");
    const { selectedTenant } = useTenant();
    const [tab, setTab] = useState<"dashboard" | "activity" | "licenseopt">("dashboard");
    if (!selectedTenant || selectedTenant.id === "default") return null;
    return (
        <div className="space-y-6">
            <div><h2 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2"><IconUsers className="w-5 h-5 text-[#0078D4]" stroke={1.5} />{t("title")}</h2><p className="text-sm text-slate-500 dark:text-slate-400">{t("subtitle")}</p></div>
            <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
                <button onClick={() => setTab("dashboard")} className={`relative flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold border-b-2 transition-colors ${tab==="dashboard"?"border-[#0054A6] text-[#0054A6] dark:text-[#00AEEF] bg-blue-50/70 dark:bg-blue-950/20":"border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`} aria-pressed={tab==="dashboard"}><IconBuildingSkyscraper className="w-4 h-4" stroke={1.5} />{t("tab_dashboard")}</button>
                <button onClick={() => setTab("activity")} className={`relative flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold border-b-2 transition-colors ${tab==="activity"?"border-[#0054A6] text-[#0054A6] dark:text-[#00AEEF] bg-blue-50/70 dark:bg-blue-950/20":"border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`} aria-pressed={tab==="activity"}><IconUsers className="w-4 h-4" stroke={1.5} />{t("tab_user_activity")}</button>
                <button onClick={() => setTab("licenseopt")} className={`relative flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold border-b-2 transition-colors ${tab==="licenseopt"?"border-[#0054A6] text-[#0054A6] dark:text-[#00AEEF] bg-blue-50/70 dark:bg-blue-950/20":"border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`} aria-pressed={tab==="licenseopt"}><IconSparkles className="w-4 h-4" stroke={1.5} />{t("tab_license_optimization")}</button>
            </div>
            {tab === "dashboard" ? <DashboardTab /> : tab === "activity" ? <UserActivityTab /> : <LicenseOptimizationTab />}
        </div>
    );
}
