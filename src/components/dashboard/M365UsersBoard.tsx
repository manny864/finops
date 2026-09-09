"use client";
import React, { useState, useMemo, useEffect } from "react";
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
    IconLicense,
    IconBuildingSkyscraper,
    IconSparkles,
    IconShieldQuestion,
    IconCheck,
    IconX,
    IconActivity,
    IconUserPause,
    IconDownload,
    IconEye,
    IconTrash,
    IconCpu,
    IconServer,
    IconDatabase,
    IconStack2,
    IconTerminal2,
    IconCopy,
} from "@tabler/icons-react";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import MockBanner from "@/components/MockBanner";
import { useCurrency } from "@/components/CurrencyProvider";
import { errorMessage } from '@/lib/apiErrors';

const BLUE = { deep: "#0078D4", cobalt: "#2563EB", cyan: "#0284C7", sky: "#38BDF8", ice: "#93C5FD", slate: "#94A3B8" };

function useAuthedSWR<T = any>(path: string) {
  const t = useTranslations("M365Users");
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const ready = selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id));
    const fetcher = async (url: string) => {
        const idToken = accounts.length ? await getFreshIdToken(instance, accounts[0], ["User.Read"]) : "";
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}`, "x-tenant-id": selectedTenant?.id ?? "" } });
        if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.details || j.error || t("genericError")); }
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
                <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} barSize={22} activeBar={false}>
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
            <h3 className="font-bold flex items-center gap-2"><IconAlertTriangle className="w-4 h-4 text-[#0078D4]" stroke={1.5} /> {missing ? t("graph_permissions_title") : t("genericError")}</h3>
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

// ═══ TAB 2: USER ACTIVITY (ENRICHED) ═══

/** Inactivity badge: green <30d, sky 30-90d, amber 90-180d, red >180d */
function InactivityBadge({ days }: { days: number | null }) {
    const t = useTranslations("M365Users");
    if (days === null) return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{t("never_signed_in")}</span>;
    if (days < 30) return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{days}d</span>;
    if (days < 90) return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">{days}d</span>;
    if (days < 180) return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{days}d</span>;
    return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400">{days}d</span>;
}

/** MFA badge */
function MfaBadge({ registered, methods }: { registered: boolean; methods: string[] }) {
    const t = useTranslations("M365Users");
    if (!registered) return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"><IconShieldQuestion className="w-3 h-3" stroke={2} />{t("mfa_none")}</span>;
    const hasApp = methods.some(m => m.includes("Authenticator") || m.includes("FIDO2") || m.includes("Windows Hello"));
    if (hasApp) return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"><IconShieldCheck className="w-3 h-3" stroke={2} />{t("mfa_app")}</span>;
    return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"><IconShieldCheck className="w-3 h-3" stroke={2} />{methods[0] || t("mfa_registered")}</span>;
}

/** User type badge */
function UserTypeBadge({ userType }: { userType: "Member" | "Guest" | "ServiceAccount" }) {
    const t = useTranslations("M365Users");
    if (userType === "Guest") return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">{t("user_type_guest")}</span>;
    if (userType === "ServiceAccount") return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">{t("user_type_service")}</span>;
    return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">{t("user_type_member")}</span>;
}

/** Avatar with initials */
function UserAvatar({ name }: { name: string }) {
    const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
    return (
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#0078D4] text-white text-[11px] font-bold shrink-0">
            {initials}
        </span>
    );
}

// ─── User Detail Drawer ────────────────────────────────────────────────────

function UserDetailDrawer({ user, onClose, tenantId }: { user: any; onClose: () => void; tenantId: string }) {
    const t = useTranslations("M365Users");
    const { format } = useCurrency();
    const [signIns, setSignIns] = useState<any[] | null>(null);
    const [loadingSignIns, setLoadingSignIns] = useState(false);

    useEffect(() => {
        if (!user?.id) return;
        let cancelled = false;
        (async () => {
            setLoadingSignIns(true);
            try {
                const res = await fetch(`/api/m365/user-activity/signin-history?tenantId=${tenantId}&userId=${user.id}`);
                const json = await res.json();
                if (!cancelled) setSignIns(json.entries || []);
            } catch { if (!cancelled) setSignIns([]); }
            if (!cancelled) setLoadingSignIns(false);
        })();
        return () => { cancelled = true; };
    }, [user?.id, tenantId]);

    return (
        <>
            {/* Backdrop z-50 */}
            <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
            {/* Drawer z-50 */}
            <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white dark:bg-slate-900 shadow-2xl z-50 overflow-y-auto border-l border-slate-200 dark:border-slate-700">
                {/* Header */}
                <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-5 py-4 flex items-center justify-between z-10">
                    <div className="flex items-center gap-3">
                        <UserAvatar name={user.displayName} />
                        <div>
                            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">{user.displayName}</h3>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">{user.userPrincipalName}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                        <IconX className="w-4 h-4" stroke={2} />
                    </button>
                </div>

                <div className="p-5 space-y-5">
                    {/* Quick stats */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-100 dark:border-slate-700">
                            <p className="text-[10px] uppercase text-slate-400">{t("drawer_account_status")}</p>
                            <p className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mt-0.5">
                                {user.accountEnabled
                                    ? <span className="text-emerald-600">{t("enabled")}</span>
                                    : <span className="text-red-600">{t("disabled")}</span>}
                            </p>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-100 dark:border-slate-700">
                            <p className="text-[10px] uppercase text-slate-400">{t("drawer_user_type")}</p>
                            <p className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mt-0.5"><UserTypeBadge userType={user.userType} /></p>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-100 dark:border-slate-700">
                            <p className="text-[10px] uppercase text-slate-400">{t("drawer_monthly_cost")}</p>
                            <p className="text-sm font-bold text-[#0078D4] mt-0.5">{format(user.monthlyCostUSD || 0)}</p>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-100 dark:border-slate-700">
                            <p className="text-[10px] uppercase text-slate-400">{t("drawer_mfa")}</p>
                            <p className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mt-0.5"><MfaBadge registered={user.mfaRegistered} methods={user.authMethods || []} /></p>
                        </div>
                    </div>

                    {/* Assigned licenses */}
                    <div>
                        <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-2 flex items-center gap-1.5">
                            <IconLicense className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
                            {t("drawer_licenses")}
                        </h4>
                        {(user.assignedSkus || []).length === 0 ? (
                            <p className="text-xs text-slate-400">{t("drawer_no_licenses")}</p>
                        ) : (
                            <div className="space-y-1.5">
                                {(user.assignedSkus || []).map((sku: any, i: number) => (
                                    <div key={i} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-100 dark:border-slate-700">
                                        <span className="text-xs text-[#1B2A41] dark:text-slate-200">{sku.displayName}</span>
                                        <span className="text-xs font-bold text-[#0078D4]">{sku.isPaid ? format(sku.priceUSD) : t("free")}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Sign-in history */}
                    <div>
                        <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-2 flex items-center gap-1.5">
                            <IconActivity className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
                            {t("drawer_signin_history")}
                        </h4>
                        {loadingSignIns ? (
                            <div className="flex items-center justify-center py-6">
                                <IconLoader2 className="w-4 h-4 animate-spin text-[#0078D4]" stroke={1.5} />
                            </div>
                        ) : !signIns || signIns.length === 0 ? (
                            <p className="text-xs text-slate-400">{t("drawer_no_signins")}</p>
                        ) : (
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                                {signIns.map((s: any, i: number) => (
                                    <div key={i} className="bg-slate-50 dark:bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-100 dark:border-slate-700 text-xs">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="font-semibold text-[#1B2A41] dark:text-slate-200">{s.appDisplayName}</span>
                                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${s.status?.errorCode === 0 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                                                {s.status?.errorCode === 0 ? t("signin_success") : t("signin_failed")}
                                            </span>
                                        </div>
                                        <div className="text-slate-500 dark:text-slate-400 space-y-0.5">
                                            <div className="flex items-center gap-2">
                                                <span>{new Date(s.createdDateTime).toLocaleString()}</span>
                                                <span>·</span>
                                                <span>IP: {s.ipAddress}</span>
                                            </div>
                                            {s.location?.city && (
                                                <div>{[s.location.city, s.location.state, s.location.countryOrRegion].filter(Boolean).join(", ")}</div>
                                            )}
                                            {s.status?.failureReason && (
                                                <div className="text-red-600 dark:text-red-400">{s.status.failureReason}</div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}

// ─── Main UserActivityTab ───────────────────────────────────────────────────

function UserActivityTab() {
    const t = useTranslations("M365Users");
    const { format } = useCurrency();
    const { data, error, isLoading } = useAuthedSWR<any>("/api/m365/user-activity");
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id || "";

    // Filters
    const [search, setSearch] = useState("");
    const [accountState, setAccountState] = useState("all");
    const [userTypeFilter, setUserTypeFilter] = useState("all");
    const [inactivityRange, setInactivityRange] = useState("all");
    const [licenseFilter, setLicenseFilter] = useState("all");

    // Sort
    const [sortKey, setSortKey] = useState<string>("displayName");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

    // Pagination
    const [pageSize, setPageSize] = useState(15);
    const [currentPage, setCurrentPage] = useState(1);

    // Detail drawer
    const [selectedUser, setSelectedUser] = useState<any | null>(null);

    // CSV export
    const exportCSV = () => {
        if (!filtered.length) return;
        const headers = [t("csvName"), "UPN", t("csvType"), t("colStatus"), t("colInactivityDays"), "MFA", t("csvLicenses"), t("csvMonthlyCost")];
        const csvRows = filtered.map((r: any) => [
            r.displayName, r.userPrincipalName, r.userType,
            r.accountEnabled ? t("enabled") : t("disabled"),
            r.daysInactive ?? "Nunca",
            r.mfaRegistered ? "Sí" : "No",
            (r.assignedSkus || []).map((s: any) => s.displayName).join("; "),
            r.monthlyCostUSD.toFixed(2),
        ]);
        const csv = [headers, ...csvRows].map(row => row.map((c: string) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `actividad_usuarios_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
        URL.revokeObjectURL(url);
    };

    // Filtering
    const filtered = useMemo(() => {
        let rows = data?.rows || [];
        if (search) {
            const q = search.toLowerCase();
            rows = rows.filter((r: any) =>
                (r.displayName || "").toLowerCase().includes(q) ||
                (r.userPrincipalName || "").toLowerCase().includes(q) ||
                (r.mail || "").toLowerCase().includes(q)
            );
        }
        if (accountState === "enabled") rows = rows.filter((r: any) => r.accountEnabled);
        if (accountState === "disabled") rows = rows.filter((r: any) => !r.accountEnabled);
        if (userTypeFilter === "member") rows = rows.filter((r: any) => r.userType === "Member");
        if (userTypeFilter === "guest") rows = rows.filter((r: any) => r.userType === "Guest");
        if (userTypeFilter === "service") rows = rows.filter((r: any) => r.userType === "ServiceAccount");
        if (inactivityRange === "active") rows = rows.filter((r: any) => r.daysInactive !== null && r.daysInactive < 30);
        if (inactivityRange === "inactive_30") rows = rows.filter((r: any) => r.daysInactive !== null && r.daysInactive >= 30 && r.daysInactive < 90);
        if (inactivityRange === "inactive_90") rows = rows.filter((r: any) => r.daysInactive !== null && r.daysInactive >= 90);
        if (inactivityRange === "zombie_365") rows = rows.filter((r: any) => r.isZombie);
        if (licenseFilter === "paid") rows = rows.filter((r: any) => (r.assignedSkus || []).some((s: any) => s.isPaid));
        if (licenseFilter === "free") rows = rows.filter((r: any) => (r.assignedSkus || []).length > 0 && !(r.assignedSkus || []).some((s: any) => s.isPaid));
        if (licenseFilter === "none") rows = rows.filter((r: any) => (r.assignedSkus || []).length === 0);

        // Sort
        rows = [...rows].sort((a: any, b: any) => {
            let va: any, vb: any;
            switch (sortKey) {
                case "displayName": va = a.displayName || ""; vb = b.displayName || ""; break;
                case "daysInactive": va = a.daysInactive ?? 99999; vb = b.daysInactive ?? 99999; break;
                case "monthlyCostUSD": va = a.monthlyCostUSD || 0; vb = b.monthlyCostUSD || 0; break;
                case "userType": va = a.userType || ""; vb = b.userType || ""; break;
                case "accountEnabled": va = a.accountEnabled ? 1 : 0; vb = b.accountEnabled ? 1 : 0; break;
                default: va = a.displayName || ""; vb = b.displayName || "";
            }
            if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
            return sortDir === "asc" ? va - vb : vb - va;
        });
        return rows;
    }, [data, search, accountState, userTypeFilter, inactivityRange, licenseFilter, sortKey, sortDir]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const paginated = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filtered.slice(start, start + pageSize);
    }, [filtered, currentPage, pageSize]);

    // Reset page on filter change
    useEffect(() => { setCurrentPage(1); }, [search, accountState, userTypeFilter, inactivityRange, licenseFilter]);

    if (isLoading) return <LoadingBlock />;
    if (error) return <ErrorBlock message={error.message} />;
    if (!data) return null;

    const isMock = data.mock || isMockTenant(tenantId);
    const na = t("na");
    const kpis = data.kpis || {};

    const handleSort = (key: string) => {
        if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
        else { setSortKey(key); setSortDir("asc"); }
    };

    const SortIcon = ({ col }: { col: string }) => {
        if (sortKey !== col) return <span className="text-slate-300 dark:text-slate-600 ml-0.5">↕</span>;
        return <span className="text-[#0078D4] ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>;
    };

    return (
        <div className="space-y-4">
            {isMock && <MockBanner />}

            {/* ── KPI Cards (5) ── */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <BigKpi
                    label={t("total_users")} value={kpis.totalUsers ?? na}
                    icon={<IconUsers className="w-5 h-5 text-[#0078D4]" stroke={1.5} />}
                    tooltip={t("tooltip_total_users")}
                />
                <BigKpi
                    label={t("enabled_users")} value={kpis.enabledUsers ?? na}
                    icon={<IconUserCheck className="w-5 h-5 text-[#0078D4]" stroke={1.5} />}
                    tooltip={t("tooltip_enabled_users")}
                />
                <BigKpi
                    label={t("disabled_users")} value={kpis.disabledUsers ?? na}
                    icon={<IconUserX className="w-5 h-5 text-[#0078D4]" stroke={1.5} />}
                    tooltip={t("tooltip_disabled_users")}
                />
                <BigKpi
                    label={t("active_users_30d")} value={kpis.activeUsers ?? na}
                    icon={<IconActivity className="w-5 h-5 text-[#0078D4]" stroke={1.5} />}
                    tooltip={t("tooltip_active_users_30d")}
                />
                <BigKpi
                    label={t("inactive_users_30d")} value={kpis.inactiveUsers ?? na}
                    icon={<IconUserPause className="w-5 h-5 text-[#0078D4]" stroke={1.5} />}
                    sub={kpis.licenseWasteCount > 0 ? t("license_waste_warning", { count: kpis.licenseWasteCount, cost: format(kpis.licenseWasteCostUSD || 0) }) : undefined}
                    tooltip={t("tooltip_inactive_users_30d")}
                />
            </div>

            {/* ── Capability warning ── */}
            {data.capabilities?.signInActivity === false && (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-lg px-3 py-2">
                    <IconShieldQuestion className="w-3.5 h-3.5 shrink-0 text-[#0078D4]" stroke={1.5} />
                    {t("requires_graph_perm")}
                </p>
            )}

            {/* ── Filter bar ── */}
            <div className="flex flex-wrap gap-2 items-center justify-between">
                <div className="flex flex-wrap gap-2 items-center">
                    {/* Search */}
                    <div className="relative">
                        <IconSearch className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" stroke={1.5} />
                        <input
                            value={search} onChange={e => setSearch(e.target.value)}
                            placeholder={t("search_placeholder")}
                            className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-[#1B2A41] dark:text-slate-200 w-52"
                        />
                    </div>
                    {/* Account state */}
                    <select value={accountState} onChange={e => setAccountState(e.target.value)}
                        className="px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-[#1B2A41] dark:text-slate-200">
                        <option value="all">{t("filter_account_state")}: {t("all")}</option>
                        <option value="enabled">{t("enabled")}</option>
                        <option value="disabled">{t("disabled")}</option>
                    </select>
                    {/* User type */}
                    <select value={userTypeFilter} onChange={e => setUserTypeFilter(e.target.value)}
                        className="px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-[#1B2A41] dark:text-slate-200">
                        <option value="all">{t("filter_user_type")}: {t("all")}</option>
                        <option value="member">{t("user_type_member")}</option>
                        <option value="guest">{t("user_type_guest")}</option>
                        <option value="service">{t("user_type_service")}</option>
                    </select>
                    {/* Inactivity */}
                    <select value={inactivityRange} onChange={e => setInactivityRange(e.target.value)}
                        className="px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-[#1B2A41] dark:text-slate-200">
                        <option value="all">{t("filter_inactivity")}: {t("all")}</option>
                        <option value="active">{t("inactivity_active")}</option>
                        <option value="inactive_30">{t("inactivity_30_90")}</option>
                        <option value="inactive_90">{t("inactivity_90_plus")}</option>
                        <option value="zombie_365">{t("inactivity_zombie")}</option>
                    </select>
                    {/* License */}
                    <select value={licenseFilter} onChange={e => setLicenseFilter(e.target.value)}
                        className="px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-[#1B2A41] dark:text-slate-200">
                        <option value="all">{t("filter_license")}: {t("all")}</option>
                        <option value="paid">{t("filter_license_paid")}</option>
                        <option value="free">{t("filter_license_free")}</option>
                        <option value="none">{t("filter_license_none")}</option>
                    </select>
                </div>
                {/* Export CSV button */}
                <button
                    onClick={exportCSV}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                >
                    <IconDownload className="w-3.5 h-3.5" stroke={1.5} />
                    {t("export_csv")}
                </button>
            </div>

            {/* ── Enriched table ── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-x-auto">
                <table className="w-full min-w-[1280px] border-collapse text-xs table-fixed">
                        <thead className="bg-slate-50/50 dark:bg-slate-800/50">
                            <tr>
                                {[
                                    { key: "displayName", label: t("col_display_name"), minWidth: 190 },
                                    { key: "userPrincipalName", label: t("col_upn"), minWidth: 260 },
                                    { key: "userType", label: t("col_user_type"), minWidth: 140 },
                                    { key: "accountEnabled", label: t("col_account_status"), minWidth: 130 },
                                    { key: "daysInactive", label: t("col_last_activity_days"), minWidth: 130 },
                                    { key: "mfaRegistered", label: t("col_mfa"), minWidth: 130 },
                                    { key: "assignedSkus", label: t("col_licenses"), minWidth: 200 },
                                    { key: "monthlyCostUSD", label: t("col_monthly_cost"), minWidth: 110 },
                                ].map(({ key, label, minWidth }) => (
                                    <ResizableTh key={key} minWidth={minWidth} className="p-3 text-left">
                                        <button
                                            onClick={() => handleSort(key)}
                                            className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold hover:text-[#0078D4] transition-colors inline-flex items-center gap-0.5"
                                        >
                                            {label}<SortIcon col={key} />
                                        </button>
                                    </ResizableTh>
                                ))}
                                <ResizableTh minWidth={100} className="p-3 text-left">
                                    <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold">{t("col_actions")}</span>
                                </ResizableTh>
                            </tr>
                        </thead>
                        <tbody>
                            {paginated.map((r: any, i: number) => (
                                <tr key={r.id || i} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 align-top">
                                    {/* Name + avatar */}
                                    <td className="p-3 whitespace-normal break-words">
                                        <div className="flex items-center gap-2">
                                            <UserAvatar name={r.displayName} />
                                            <div className="min-w-0">
                                                <span className="font-semibold text-[#1B2A41] dark:text-slate-200 block">{r.displayName}</span>
                                                {r.userType === "Guest" && (
                                                    <span className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 mt-0.5">
                                                        B2B
                                                    </span>
                                                )}
                                                {r.userType === "ServiceAccount" && (
                                                    <span className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 mt-0.5">
                                                        BOT
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    {/* UPN */}
                                    <td className="p-3 text-slate-500 dark:text-slate-400 whitespace-normal break-all font-mono text-[11px]">{r.userPrincipalName}</td>
                                    {/* User type */}
                                    <td className="p-3"><UserTypeBadge userType={r.userType} /></td>
                                    {/* Account state */}
                                    <td className="p-3">
                                        {r.accountEnabled
                                            ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"><IconCheck className="w-3 h-3" stroke={2} />{t("enabled")}</span>
                                            : <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"><IconX className="w-3 h-3" stroke={2} />{t("disabled")}</span>}
                                    </td>
                                    {/* Inactivity */}
                                    <td className="p-3"><InactivityBadge days={r.daysInactive} /></td>
                                    {/* MFA */}
                                    <td className="p-3"><MfaBadge registered={r.mfaRegistered} methods={r.authMethods || []} /></td>
                                    {/* Licenses */}
                                    <td className="p-3">
                                        <div className="flex flex-wrap gap-1 max-w-[280px]">
                                            {(r.assignedSkus || []).length === 0 ? (
                                                <span className="text-slate-400">—</span>
                                            ) : (
                                                (r.assignedSkus || []).map((sku: any, j: number) => (
                                                    <span key={j} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${sku.isPaid ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                                                        {sku.displayName}
                                                    </span>
                                                ))
                                            )}
                                        </div>
                                        {r.isLicenseWaste && (
                                            <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                                <IconAlertTriangle className="w-3 h-3" stroke={2} />{t("license_waste_badge")}
                                            </span>
                                        )}
                                    </td>
                                    {/* Monthly cost */}
                                    <td className="p-3 font-bold text-[#1B2A41] dark:text-slate-200 whitespace-nowrap">
                                        {format(r.monthlyCostUSD || 0)}
                                    </td>
                                    {/* Actions */}
                                    <td className="p-3">
                                        <div className="flex items-center gap-1.5">
                                            {/* View details */}
                                            <button
                                                onClick={() => setSelectedUser(r)}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                                                title={t("action_view_details")}
                                            >
                                                <IconEye className="w-3 h-3" stroke={1.5} />
                                                {t("action_view")}
                                            </button>
                                            {/* Revoke license (zombie with paid license) */}
                                            {r.isLicenseWaste && r.accountEnabled && (
                                                <button
                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                                                    title={t("action_revoke_license")}
                                                >
                                                    <IconSparkles className="w-3 h-3" stroke={1.5} />
                                                    {t("action_revoke")}
                                                </button>
                                            )}
                                            {/* Disable account (zombie > 1yr) */}
                                            {r.isZombie && !r.accountEnabled && (
                                                <button
                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-red-500 text-red-500 bg-white dark:bg-slate-900 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                                    title={t("action_disable_account")}
                                                >
                                                    <IconTrash className="w-3 h-3" stroke={1.5} />
                                                    {t("action_disable")}
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filtered.length === 0 && (
                                <tr><td colSpan={9} className="p-8 text-center text-slate-400">{t("no_users")}</td></tr>
                            )}
                        </tbody>
                    </table>

                {/* ── Pagination ── */}
                {filtered.length > 0 && (
                    <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>{t("per_page")}</span>
                            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                                className="border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 bg-white dark:bg-slate-800 text-xs">
                                {[15, 30, 45, 60].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <span>{t("pagination_showing", { from: (currentPage - 1) * pageSize + 1, to: Math.min(currentPage * pageSize, filtered.length), total: filtered.length })}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30">
                                <IconChevronLeft className="w-4 h-4" stroke={1.5} />
                            </button>
                            <span className="text-xs text-slate-500 px-2">{t("page", { current: currentPage, total: totalPages })}</span>
                            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30">
                                <IconChevronRight className="w-4 h-4" stroke={1.5} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── User Detail Drawer ── */}
            {selectedUser && (
                <UserDetailDrawer
                    user={selectedUser}
                    onClose={() => setSelectedUser(null)}
                    tenantId={tenantId}
                />
            )}
        </div>
    );
}

// ═══ TAB 3: LICENSE OPTIMIZATION (ENRICHED) ═══

/** Progress bar in blue tones */
function ProgressBar({ pct, color = "#0078D4" }: { pct: number; color?: string }) {
    const clamped = Math.min(100, Math.max(0, pct));
    return (
        <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-300" style={{ width: `${clamped}%`, backgroundColor: color }} />
        </div>
    );
}

/** AHUB Activation Modal (z-50) */
function AhubModal({ resource, onClose }: { resource: any; onClose: () => void }) {
    const t = useTranslations("M365Users");
    const [copied, setCopied] = useState(false);
    const cmd = resource?.remediationCommand;
    const copyCli = () => { if (cmd?.cli) { navigator.clipboard.writeText(cmd.cli); setCopied(true); setTimeout(() => setCopied(false), 2000); } };

    return (
        <>
            <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg max-h-[85vh] overflow-y-auto">
                    <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-5 py-4 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
                            <IconSparkles className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                            {t("ahub_modal_title")}
                        </h3>
                        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
                            <IconX className="w-4 h-4" stroke={2} />
                        </button>
                    </div>
                    <div className="p-5 space-y-4">
                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-100 dark:border-slate-700">
                            <p className="text-[10px] uppercase text-slate-400">{t("ahub_modal_resource")}</p>
                            <p className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">{resource?.name}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{resource?.resourceType} · {resource?.location} · {resource?.resourceGroup}</p>
                        </div>
                        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3 border border-emerald-200 dark:border-emerald-900/50">
                            <p className="text-[10px] uppercase text-emerald-600 dark:text-emerald-400">{t("ahub_modal_savings")}</p>
                            <p className="text-lg font-extrabold text-emerald-700 dark:text-emerald-300">${resource?.estimatedMonthlySavingsUSD?.toFixed(2)}/mo</p>
                        </div>
                        <div>
                            <p className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-2 flex items-center gap-1.5">
                                <IconTerminal2 className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
                                Azure CLI
                            </p>
                            <div className="relative">
                                <pre className="bg-slate-900 text-emerald-400 text-[11px] p-3 rounded-lg overflow-x-auto leading-relaxed">{cmd?.cli}</pre>
                                <button onClick={copyCli} className="absolute top-2 right-2 p-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-[10px] flex items-center gap-1">
                                    {copied ? <IconCheck className="w-3 h-3" stroke={2} /> : <IconCopy className="w-3 h-3" stroke={1.5} />}
                                    {copied ? t("copied") : t("copy")}
                                </button>
                            </div>
                        </div>
                        <div>
                            <p className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-2 flex items-center gap-1.5">
                                <IconTerminal2 className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
                                PowerShell
                            </p>
                            <pre className="bg-slate-900 text-blue-300 text-[11px] p-3 rounded-lg overflow-x-auto leading-relaxed">{cmd?.powershell}</pre>
                        </div>
                        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 border border-amber-200 dark:border-amber-900/50">
                            <p className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
                                <IconAlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#0078D4]" stroke={1.5} />
                                {t("ahub_modal_warning")}
                            </p>
                        </div>
                        <p className="text-xs text-slate-500">{cmd?.impactSummary}</p>
                    </div>
                </div>
            </div>
        </>
    );
}

/** SKU Users Drawer (z-50) */
function SkuUsersDrawer({ sku, onClose }: { sku: any; onClose: () => void }) {
    const t = useTranslations("M365Users");
    const users = sku?.inactiveUsers || [];

    return (
        <>
            <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
            <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white dark:bg-slate-900 shadow-2xl z-50 overflow-y-auto border-l border-slate-200 dark:border-slate-700">
                <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-5 py-4 flex items-center justify-between z-10">
                    <div>
                        <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">{t("sku_users_drawer_title")}</h3>
                        <p className="text-[11px] text-slate-500">{sku?.commercialDisplayName} [{sku?.skuPartNumber}]</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
                        <IconX className="w-4 h-4" stroke={2} />
                    </button>
                </div>
                <div className="p-5 space-y-3">
                    {users.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-8">{t("sku_users_none")}</p>
                    ) : (
                        users.map((u: any, i: number) => (
                            <div key={i} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 rounded-lg px-3 py-2.5 border border-slate-100 dark:border-slate-700">
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200 truncate">{u.displayName}</p>
                                    <p className="text-[10px] text-slate-400 truncate">{u.userPrincipalName}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${u.daysInactive > 180 ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400" : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"}`}>
                                        {u.daysInactive}d
                                    </span>
                                    <button className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors">
                                        <IconTrash className="w-3 h-3" stroke={1.5} />
                                        {t("sku_users_unassign")}
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </>
    );
}

// ─── Main LicenseOptimizationTab ────────────────────────────────────────────

function LicenseOptimizationTab() {
    const t = useTranslations("M365Users");
    const { format } = useCurrency();
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id || "";

    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<{ message: string; needsConsent?: boolean } | null>(null);
    const [graphError, setGraphError] = useState<{ message: string; needsConsent?: boolean } | null>(null);

    // AHUB filters
    const [ahubTypeFilter, setAhubTypeFilter] = useState("all");
    const [ahubSearch, setAhubSearch] = useState("");
    const [ahubPage, setAhubPage] = useState(1);
    const [ahubPageSize, setAhubPageSize] = useState(15);

    // SKU filters
    const [skuCategory, setSkuCategory] = useState("all");
    const [skuSearch, setSkuSearch] = useState("");
    const [skuPage, setSkuPage] = useState(1);
    const [skuPageSize, setSkuPageSize] = useState(15);

    // SKU sort
    const [skuSortKey, setSkuSortKey] = useState("wastedMonthlySpendUSD");
    const [skuSortDir, setSkuSortDir] = useState<"asc" | "desc">("desc");

    // Modals
    const [ahubModal, setAhubModal] = useState<any | null>(null);
    const [skuDrawer, setSkuDrawer] = useState<any | null>(null);

    // Fetch
    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === "default") return;
        let cancelled = false;
        (async () => {
            setLoading(true); setError(null); setGraphError(null);
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
            } catch (e) { if (!cancelled) setError({ message: errorMessage(e) || t("networkError") }); }
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [selectedTenant, accounts, instance]);

    const isMock = isMockTenant(tenantId);
    const summary = data?.summary || {};
    const ahubResources: any[] = data?.ahubResources || [];
    const skuOptimizations: any[] = data?.skuOptimizations || [];

    // AHUB filtering
    const ahubFiltered = useMemo(() => {
        let rows = ahubResources;
        if (ahubTypeFilter === "vm") rows = rows.filter((r: any) => r.resourceType === "Virtual Machine");
        if (ahubTypeFilter === "sql") rows = rows.filter((r: any) => r.resourceType === "SQL Database" || r.resourceType === "SQL Elastic Pool");
        if (ahubSearch) {
            const q = ahubSearch.toLowerCase();
            rows = rows.filter((r: any) => (r.name || "").toLowerCase().includes(q) || (r.resourceGroup || "").toLowerCase().includes(q));
        }
        return rows;
    }, [ahubResources, ahubTypeFilter, ahubSearch]);
    const ahubTotalPages = Math.max(1, Math.ceil(ahubFiltered.length / ahubPageSize));
    const ahubPaged = ahubFiltered.slice((ahubPage - 1) * ahubPageSize, ahubPage * ahubPageSize);

    // SKU filtering + sorting
    const skuFiltered = useMemo(() => {
        let rows = skuOptimizations.filter((s: any) => !s.isSystemSku);
        if (skuCategory !== "all") rows = rows.filter((s: any) => s.category === skuCategory);
        if (skuSearch) {
            const q = skuSearch.toLowerCase();
            rows = rows.filter((s: any) =>
                (s.commercialDisplayName || "").toLowerCase().includes(q) ||
                (s.skuPartNumber || "").toLowerCase().includes(q)
            );
        }
        rows = [...rows].sort((a: any, b: any) => {
            let va: any, vb: any;
            switch (skuSortKey) {
                case "commercialDisplayName": va = a.commercialDisplayName || ""; vb = b.commercialDisplayName || ""; break;
                case "totalPurchased": va = a.totalPurchased || 0; vb = b.totalPurchased || 0; break;
                case "totalConsumed": va = a.totalConsumed || 0; vb = b.totalConsumed || 0; break;
                case "unassignedCount": va = a.unassignedCount || 0; vb = b.unassignedCount || 0; break;
                case "inactiveAssignedCount": va = a.inactiveAssignedCount || 0; vb = b.inactiveAssignedCount || 0; break;
                case "wastedMonthlySpendUSD": va = a.wastedMonthlySpendUSD || 0; vb = b.wastedMonthlySpendUSD || 0; break;
                default: va = a.wastedMonthlySpendUSD || 0; vb = b.wastedMonthlySpendUSD || 0;
            }
            if (typeof va === "string") return skuSortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
            return skuSortDir === "asc" ? va - vb : vb - va;
        });
        return rows;
    }, [skuOptimizations, skuCategory, skuSearch, skuSortKey, skuSortDir]);
    const skuTotalPages = Math.max(1, Math.ceil(skuFiltered.length / skuPageSize));
    const skuPaged = skuFiltered.slice((skuPage - 1) * skuPageSize, skuPage * skuPageSize);

    // Early return colocado despues de todos los hooks: React exige el mismo
    // numero de hooks en cada render (rules-of-hooks).
    if (error) return <ErrorBlock message={error.message} />;

    const handleSkuSort = (key: string) => {
        if (skuSortKey === key) setSkuSortDir(d => d === "asc" ? "desc" : "asc");
        else { setSkuSortKey(key); setSkuSortDir("desc"); }
    };

    const SkuSortIcon = ({ col }: { col: string }) => {
        if (skuSortKey !== col) return <span className="text-slate-300 dark:text-slate-600 ml-0.5">↕</span>;
        return <span className="text-[#0078D4] ml-0.5">{skuSortDir === "asc" ? "↑" : "↓"}</span>;
    };

    const ResourceIcon = ({ type }: { type: string }) => {
        if (type === "Virtual Machine") return <IconServer className="w-4 h-4 text-[#0078D4]" stroke={1.5} />;
        if (type === "SQL Elastic Pool") return <IconStack2 className="w-4 h-4 text-[#0078D4]" stroke={1.5} />;
        return <IconDatabase className="w-4 h-4 text-[#0078D4]" stroke={1.5} />;
    };

    return (
        <div className="space-y-4">
            {isMock && <MockBanner />}

            {/* ── KPI Cards (5) ── */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <BigKpi
                    label={t("lic_total_paid")} value={loading ? "…" : (summary.totalPaidLicenses ?? 0).toLocaleString()}
                    icon={<IconKey className="w-5 h-5 text-[#0078D4]" stroke={1.5} />}
                    tooltip={t("tooltip_lic_total_paid")}
                />
                <BigKpi
                    label={t("lic_assigned")} value={loading ? "…" : (summary.totalAssigned ?? 0).toLocaleString()}
                    icon={<IconUsers className="w-5 h-5 text-[#0078D4]" stroke={1.5} />}
                    sub={summary.totalPaidLicenses > 0 ? `${Math.round((summary.totalAssigned / summary.totalPaidLicenses) * 100)}% ${t("in_use")}` : undefined}
                    tooltip={t("tooltip_lic_assigned")}
                />
                <BigKpi
                    label={t("lic_unassigned_pool")} value={loading ? "…" : (summary.totalUnassigned ?? 0).toLocaleString()}
                    icon={<IconPackage className="w-5 h-5 text-[#0078D4]" stroke={1.5} />}
                    sub={summary.totalUnassigned > 0 ? `${format(summary.totalM365WastedUSD || 0)}/mo` : undefined}
                    tooltip={t("tooltip_lic_unassigned")}
                />
                <BigKpi
                    label={t("lic_inactive_retained")} value={loading ? "…" : (summary.totalInactiveLicenses ?? 0).toLocaleString()}
                    icon={<IconUserPause className="w-5 h-5 text-[#0078D4]" stroke={1.5} />}
                    tooltip={t("tooltip_lic_inactive")}
                />
                <BigKpi
                    label={t("ahub_potential_savings")} value={loading ? "…" : format(summary.totalAhubSavingsUSD || 0)}
                    icon={<IconCpu className="w-5 h-5 text-[#0078D4]" stroke={1.5} />}
                    sub={summary.ahubResourceCount > 0 ? `${summary.ahubResourceCount} ${t("ahub_resources_detected")}` : undefined}
                    tooltip={t("tooltip_ahub_savings")}
                />
            </div>

            {/* ── TABLE 1: AHUB Resources ── */}
            <Card title={t("ahub_title")} tooltip={t("tooltip_ahub")}>
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">{t("ahub_desc")}</p>
                {/* AHUB filters */}
                <div className="flex flex-wrap gap-2 items-center mb-3">
                    <select value={ahubTypeFilter} onChange={e => { setAhubTypeFilter(e.target.value); setAhubPage(1); }}
                        className="px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-[#1B2A41] dark:text-slate-200">
                        <option value="all">{t("filter_resource_type")}: {t("all")}</option>
                        <option value="vm">{t("ahub_type_vm")}</option>
                        <option value="sql">{t("ahub_type_sql")}</option>
                    </select>
                    <div className="relative">
                        <IconSearch className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" stroke={1.5} />
                        <input value={ahubSearch} onChange={e => { setAhubSearch(e.target.value); setAhubPage(1); }}
                            placeholder={t("search_ahub")}
                            className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-[#1B2A41] dark:text-slate-200 w-48" />
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] border-collapse text-xs table-fixed">
                        <thead className="bg-slate-50/50 dark:bg-slate-800/50">
                            <tr>
                                {["resource", "type", "subscription", "resource_group", "location", "monthly_savings", "actions"].map(k => (
                                    <ResizableTh key={k}>
                                        <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold">{t(`col_${k}`)}</span>
                                    </ResizableTh>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading && <tr><td colSpan={7} className="p-8 text-center text-slate-400">{t("loading")}</td></tr>}
                            {!loading && ahubResources.length === 0 && (
                                <tr><td colSpan={7} className="p-8 text-center text-slate-400 text-xs">{t("ahub_none")}</td></tr>
                            )}
                            {!loading && ahubPaged.map((item: any, i: number) => (
                                <tr key={i} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 align-top">
                                    <td className="p-3">
                                        <div className="flex items-center gap-2">
                                            <ResourceIcon type={item.resourceType} />
                                            <span className="font-semibold text-[#1B2A41] dark:text-slate-200 break-words">{item.name}</span>
                                        </div>
                                    </td>
                                    <td className="p-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">{item.resourceType}</td>
                                    <td className="p-3 text-slate-600 dark:text-slate-300 break-words">{item.subscriptionName || item.subscriptionId}</td>
                                    <td className="p-3 text-slate-600 dark:text-slate-300 break-words">{item.resourceGroup}</td>
                                    <td className="p-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">{item.location}</td>
                                    <td className="p-3 font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">{format(item.estimatedMonthlySavingsUSD)}</td>
                                    <td className="p-3">
                                        <button
                                            onClick={() => setAhubModal(item)}
                                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                                        >
                                            <IconSparkles className="w-3 h-3" stroke={1.5} />
                                            {t("ahub_activate")}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {!loading && ahubFiltered.length > ahubPageSize && (
                    <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>{t("per_page")}</span>
                            <select value={ahubPageSize} onChange={e => { setAhubPageSize(Number(e.target.value)); setAhubPage(1); }}
                                className="border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 bg-white dark:bg-slate-800 text-xs">
                                {[15, 30, 45, 60].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <span>{t("pagination_showing", { from: (ahubPage - 1) * ahubPageSize + 1, to: Math.min(ahubPage * ahubPageSize, ahubFiltered.length), total: ahubFiltered.length })}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button onClick={() => setAhubPage(p => Math.max(1, p - 1))} disabled={ahubPage === 1}
                                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30">
                                <IconChevronLeft className="w-4 h-4" stroke={1.5} />
                            </button>
                            <span className="text-xs text-slate-500 px-2">{t("page", { current: ahubPage, total: ahubTotalPages })}</span>
                            <button onClick={() => setAhubPage(p => Math.min(ahubTotalPages, p + 1))} disabled={ahubPage === ahubTotalPages}
                                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30">
                                <IconChevronRight className="w-4 h-4" stroke={1.5} />
                            </button>
                        </div>
                    </div>
                )}
            </Card>

            {/* ── Graph permissions warning ── */}
            {graphError && (
                <div className="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 p-4 rounded-lg border border-amber-200 dark:border-amber-900/50">
                    <h3 className="font-bold flex items-center gap-2"><IconShieldQuestion className="w-4 h-4 text-[#0078D4]" stroke={1.5} />{t("graph_permissions_title")}</h3>
                    <p className="text-sm mt-1">{t("graph_permissions_desc")}</p>
                </div>
            )}

            {/* ── TABLE 2: SKU Optimization ── */}
            {!graphError && (
                <Card title={t("sku_optimization_title")} tooltip={t("tooltip_sku_optimization")}>
                    {/* SKU filters */}
                    <div className="flex flex-wrap gap-2 items-center mb-3">
                        <select value={skuCategory} onChange={e => { setSkuCategory(e.target.value); setSkuPage(1); }}
                            className="px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-[#1B2A41] dark:text-slate-200">
                            <option value="all">{t("filter_sku_category")}: {t("all")}</option>
                            <option value="M365">M365</option>
                            <option value="Productivity">{t("sku_cat_productivity")}</option>
                            <option value="Security">{t("sku_cat_security")}</option>
                            <option value="Analytics">{t("sku_cat_analytics")}</option>
                        </select>
                        <div className="relative">
                            <IconSearch className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" stroke={1.5} />
                            <input value={skuSearch} onChange={e => { setSkuSearch(e.target.value); setSkuPage(1); }}
                                placeholder={t("search_sku")}
                                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-[#1B2A41] dark:text-slate-200 w-48" />
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1000px] border-collapse text-xs table-fixed">
                            <thead className="bg-slate-50/50 dark:bg-slate-800/50">
                                <tr>
                                    {[
                                        { key: "commercialDisplayName", label: t("col_sku_product") },
                                        { key: "totalPurchased", label: t("col_total") },
                                        { key: "totalConsumed", label: t("col_in_use") },
                                        { key: "unassignedCount", label: t("col_available") },
                                        { key: "inactiveAssignedCount", label: t("col_underutil_risk") },
                                        { key: "wastedMonthlySpendUSD", label: t("col_wasted_spend") },
                                    ].map(({ key, label }) => (
                                        <ResizableTh key={key}>
                                            <button
                                                onClick={() => handleSkuSort(key)}
                                                className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold hover:text-[#0078D4] transition-colors inline-flex items-center gap-0.5"
                                            >
                                                {label}<SkuSortIcon col={key} />
                                            </button>
                                        </ResizableTh>
                                    ))}
                                    <ResizableTh>
                                        <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold">{t("col_actions")}</span>
                                    </ResizableTh>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && <tr><td colSpan={7} className="p-8 text-center text-slate-400">{t("loading")}</td></tr>}
                                {!loading && skuFiltered.length === 0 && (
                                    <tr><td colSpan={7} className="p-8 text-center text-slate-400 text-xs">{t("no_data")}</td></tr>
                                )}
                                {!loading && skuPaged.map((sku: any) => {
                                    const usagePct = sku.totalPurchased > 0 ? Math.round((sku.totalConsumed / sku.totalPurchased) * 100) : 0;
                                    return (
                                        <tr key={sku.skuId} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 align-top">
                                            <td className="p-3">
                                                <div>
                                                    <span className="font-semibold text-[#1B2A41] dark:text-slate-200">{sku.commercialDisplayName}</span>
                                                    <span className="ml-1.5 text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">{sku.skuPartNumber}</span>
                                                </div>
                                            </td>
                                            <td className="p-3 text-slate-600 dark:text-slate-300">{sku.totalPurchased.toLocaleString()}</td>
                                            <td className="p-3">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-slate-600 dark:text-slate-300 text-[11px]">{sku.totalConsumed.toLocaleString()}</span>
                                                    <div className="flex-1 min-w-[60px]">
                                                        <ProgressBar pct={usagePct} color={usagePct > 80 ? "#0078D4" : usagePct > 50 ? "#2563EB" : "#38BDF8"} />
                                                    </div>
                                                    <span className="text-[10px] text-slate-400">{usagePct}%</span>
                                                </div>
                                            </td>
                                            <td className="p-3 font-semibold text-emerald-600 dark:text-emerald-400">{sku.unassignedCount.toLocaleString()}</td>
                                            <td className="p-3">
                                                {sku.inactiveAssignedCount > 0 ? (
                                                    <span className="font-semibold text-amber-600 dark:text-amber-400">{sku.inactiveAssignedCount.toLocaleString()}</span>
                                                ) : (
                                                    <span className="text-slate-400">0</span>
                                                )}
                                            </td>
                                            <td className="p-3 font-bold text-red-600 dark:text-red-400 whitespace-nowrap">
                                                {sku.wastedMonthlySpendUSD > 0 ? format(sku.wastedMonthlySpendUSD) : <span className="text-slate-400">$0</span>}
                                            </td>
                                            <td className="p-3">
                                                {sku.inactiveAssignedCount > 0 && (
                                                    <button
                                                        onClick={() => setSkuDrawer(sku)}
                                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                                                    >
                                                        <IconSparkles className="w-3 h-3" stroke={1.5} />
                                                        {t("sku_audit_users")}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {!loading && skuFiltered.length > skuPageSize && (
                        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-700">
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                <span>{t("per_page")}</span>
                                <select value={skuPageSize} onChange={e => { setSkuPageSize(Number(e.target.value)); setSkuPage(1); }}
                                    className="border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 bg-white dark:bg-slate-800 text-xs">
                                    {[15, 30, 45, 60].map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <span>{t("pagination_showing", { from: (skuPage - 1) * skuPageSize + 1, to: Math.min(skuPage * skuPageSize, skuFiltered.length), total: skuFiltered.length })}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <button onClick={() => setSkuPage(p => Math.max(1, p - 1))} disabled={skuPage === 1}
                                    className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30">
                                    <IconChevronLeft className="w-4 h-4" stroke={1.5} />
                                </button>
                                <span className="text-xs text-slate-500 px-2">{t("page", { current: skuPage, total: skuTotalPages })}</span>
                                <button onClick={() => setSkuPage(p => Math.min(skuTotalPages, p + 1))} disabled={skuPage === skuTotalPages}
                                    className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30">
                                    <IconChevronRight className="w-4 h-4" stroke={1.5} />
                                </button>
                            </div>
                        </div>
                    )}
                </Card>
            )}

            {/* ── AHUB Modal ── */}
            {ahubModal && <AhubModal resource={ahubModal} onClose={() => setAhubModal(null)} />}

            {/* ── SKU Users Drawer ── */}
            {skuDrawer && <SkuUsersDrawer sku={skuDrawer} onClose={() => setSkuDrawer(null)} />}
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
