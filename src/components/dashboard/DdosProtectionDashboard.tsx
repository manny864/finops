"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import MockBanner from "@/components/MockBanner";
import {
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Tooltip as RechartsTooltip,
} from "recharts";
import {
    IconShieldCheck,
    IconShieldExclamation,
    IconAlertTriangle,
    IconRefresh,
    IconSearch,
    IconChevronLeft,
    IconChevronRight,
    IconArrowsSort,
    IconFlame,
    IconServer,
    IconChartBar,
    IconClock,
    IconCheck,
    IconX,
    IconMapPin,
    IconChevronDown,
    IconTrendingDown,
    IconActivity,
} from "@tabler/icons-react";

// Inline types matching the DDoS API response
interface DdosPlan {
    planId: string;
    planName: string;
    region: string;
    resourceGroup: string;
    costPerMonth: number;
    protectedVnets: number;
    protectedPublicIps: number;
    protectedApplications: number;
    status: "Active" | "Inactive";
    createdDate: string;
}

interface DdosAttack {
    id: string;
    type: "Volumetric" | "TCP SYN Flood" | "UDP Flood" | "Reflection Amplification" | "Other";
    startTime: string;
    duration: number;
    peakTrafficGbps: number;
    packetsPerSecond: number;
    sourceCountries: string[];
    targetResourceId: string;
    mitigationStatus: "Mitigated" | "In Progress" | "Failed";
    bytesDropped: number;
}

interface DdosApiResponse {
    success: boolean;
    mock: boolean;
    totalMonthlyCost: number;
    activePlans: number;
    protectedVnets: number;
    protectedPublicIps: number;
    protectedApplications: number;
    coveragePercentage: number;
    unprotectedResources: number;
    costPerProtectedResource: number;
    totalAttacksDetected: number;
    attacksMitigated: number;
    lastAttackTime: string | null;
    dayssinceLastAttack: number;
    riskLevel: "Low" | "Medium" | "High" | "Critical";
    plans: DdosPlan[];
    recentAttacks: DdosAttack[];
    recommendations: string[];
}

const RISK_COLORS: Record<string, string> = {
    Low: "#10B981",
    Medium: "#F59E0B",
    High: "#EF4444",
    Critical: "#7F1D1D",
};

const ATTACK_TYPE_COLORS: Record<string, string> = {
    "UDP Flood": "#0054A6",
    "TCP SYN Flood": "#00AEEF",
    "Reflection Amplification": "#F59E0B",
    Volumetric: "#EF4444",
    Other: "#8B5CF6",
};

const getRiskBgClass = (risk: string) => {
    if (risk === "Critical") return "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800";
    if (risk === "High") return "bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800";
    if (risk === "Medium") return "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800";
    return "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800";
};

const getAttackTypeBgClass = (type: string) => {
    if (type === "Reflection Amplification") return "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800";
    if (type === "TCP SYN Flood") return "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800";
    if (type === "UDP Flood") return "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800";
    return "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700";
};

export default function DdosProtectionDashboard() {
    const t = useTranslations("DdosProtection");
    const { selectedTenant } = useTenant();
    const { format } = useCurrency();
    const { instance, accounts: msalAccounts } = useMsal();
    const tenantId = selectedTenant?.id || "demo-tenant-id";

    const [sortField, setSortField] = useState<"planName" | "region" | "costPerMonth" | "protectedVnets">("costPerMonth");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [expandedAttack, setExpandedAttack] = useState<string | null>(null);

    const fetcher = async (url: string) => {
        let token: string | null = null;
        if (msalAccounts[0] && !isMockTenant(tenantId)) {
            token = await getFreshIdToken(instance, msalAccounts[0], ["User.Read"]).catch(() => null);
        }
        const res = await fetch(url, {
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                "x-tenant-id": tenantId,
            },
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json() as Promise<DdosApiResponse>;
    };

    const apiUrl = tenantId && tenantId !== "default"
        ? `/api/intelligence/ddos-protection?tenantId=${encodeURIComponent(tenantId)}`
        : `/api/intelligence/ddos-protection?tenantId=demo-tenant-id`;

    const { data, error, isLoading, mutate } = useSWR<DdosApiResponse>(apiUrl, fetcher, {
        revalidateOnFocus: false,
        dedupingInterval: 30000,
    });

    const isMock = data?.mock ?? (isMockTenant(tenantId) || tenantId.startsWith("demo-") || tenantId.startsWith("mock-"));

    const plans = data?.plans || [];
    const attacks = data?.recentAttacks || [];
    const recommendations = data?.recommendations || [];

    const filteredPlans = useMemo(() => {
        return plans
            .filter((p) => {
                if (!searchQuery.trim()) return true;
                const q = searchQuery.toLowerCase();
                return (
                    p.planName.toLowerCase().includes(q) ||
                    p.region.toLowerCase().includes(q) ||
                    p.resourceGroup.toLowerCase().includes(q)
                );
            })
            .sort((a, b) => {
                let cmp = 0;
                if (sortField === "planName") cmp = a.planName.localeCompare(b.planName);
                else if (sortField === "region") cmp = a.region.localeCompare(b.region);
                else if (sortField === "costPerMonth") cmp = a.costPerMonth - b.costPerMonth;
                else if (sortField === "protectedVnets") cmp = a.protectedVnets - b.protectedVnets;
                return sortOrder === "asc" ? cmp : -cmp;
            });
    }, [plans, searchQuery, sortField, sortOrder]);

    const totalPages = Math.max(1, Math.ceil(filteredPlans.length / pageSize));
    const paginatedPlans = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredPlans.slice(start, start + pageSize);
    }, [filteredPlans, currentPage, pageSize]);

    const attackChartData = useMemo(() => {
        const byType = new Map<string, number>();
        for (const a of attacks) {
            byType.set(a.type, (byType.get(a.type) || 0) + 1);
        }
        return Array.from(byType.entries()).map(([type, count]) => ({ name: type, value: count }));
    }, [attacks]);

    const formatDate = (val: string | null) => {
        if (!val) return "-";
        const d = new Date(val);
        return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString();
    };

    const formatGbps = (val: number) => `${val.toFixed(1)} Gbps`;
    const formatPps = (val: number) => {
        if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M pps`;
        if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K pps`;
        return `${val} pps`;
    };

    if (isLoading) {
        return (
            <div className="p-6 space-y-6 animate-pulse">
                <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded-md w-1/3" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-28 bg-slate-100 dark:bg-slate-800 rounded-xl" />
                    ))}
                </div>
                <div className="h-64 bg-slate-100 dark:bg-slate-800 rounded-xl" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6 text-center">
                <IconShieldExclamation className="w-12 h-12 text-red-500 mx-auto mb-3" stroke={1.5} />
                <p className="text-red-600 dark:text-red-400 font-semibold">{t("errorLoading")}</p>
                <p className="text-sm text-slate-500 mt-1">{String(error)}</p>
                <button
                    onClick={() => mutate()}
                    className="mt-4 px-4 py-2 bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] rounded-lg hover:bg-blue-50 transition-colors"
                >
                    <IconRefresh className="w-4 h-4 inline mr-1" stroke={1.5} />
                    {t("retry")}
                </button>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            {isMock && <MockBanner />}

            {/* Risk Level Banner */}
            <div className={`rounded-lg border p-4 ${getRiskBgClass(data?.riskLevel || "Medium")}`}>
                <div className="flex items-start gap-3">
                    <IconShieldCheck className="w-5 h-5 mt-0.5 shrink-0 text-[#0054A6]" stroke={1.5} />
                    <div>
                        <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100">{t("ddosPosture")}</h2>
                        <p className="text-xs mt-1 text-slate-600 dark:text-slate-400">
                            {t("riskLevel")}: <span className="font-bold" style={{ color: RISK_COLORS[data?.riskLevel || "Medium"] }}>{data?.riskLevel || "Medium"}</span>
                            {" · "}{t("coverage")}: <span className="font-bold">{data?.coveragePercentage || 0}%</span>
                        </p>
                    </div>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-1">
                        <IconShieldCheck className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("kpiMonthlyCost")}
                        <InfoTooltip content={t("kpiMonthlyCostTooltip")} />
                    </div>
                    <div className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100">
                        {format(data?.totalMonthlyCost || 0)}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                        {data?.activePlans || 0} {t("activePlans")}
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-1">
                        <IconServer className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("kpiProtectedVnets")}
                        <InfoTooltip content={t("kpiProtectedVnetsTooltip")} />
                    </div>
                    <div className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100">
                        {data?.protectedVnets || 0}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                        {data?.unprotectedResources || 0} {t("unprotected")}
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-1">
                        <IconActivity className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("kpiAttacksMitigated")}
                        <InfoTooltip content={t("kpiAttacksMitigatedTooltip")} />
                    </div>
                    <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                        {data?.attacksMitigated || 0}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                        {t("of")} {data?.totalAttacksDetected || 0} {t("detected")}
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-1">
                        <IconClock className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("kpiLastAttack")}
                        <InfoTooltip content={t("kpiLastAttackTooltip")} />
                    </div>
                    <div className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100">
                        {data?.dayssinceLastAttack != null ? `${data.dayssinceLastAttack}d` : "-"}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                        {data?.lastAttackTime ? formatDate(data.lastAttackTime) : t("noRecentAttacks")}
                    </div>
                </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Attack Type Distribution */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-slate-100 mb-4 flex items-center gap-2">
                        <IconChartBar className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("attackTypeDistribution")}
                        <InfoTooltip content={t("attackTypeDistributionTooltip")} />
                    </h3>
                    {attackChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                            <PieChart>
                                <Pie
                                    data={attackChartData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={55}
                                    outerRadius={100}
                                    paddingAngle={3}
                                    dataKey="value"
                                >
                                    {attackChartData.map((entry, idx) => (
                                        <Cell
                                            key={idx}
                                            fill={ATTACK_TYPE_COLORS[entry.name] || "#0054A6"}
                                            stroke="none"
                                        />
                                    ))}
                                </Pie>
                                <RechartsTooltip
                                    contentStyle={{
                                        backgroundColor: "#1B2A41",
                                        border: "1px solid #475569",
                                        borderRadius: "8px",
                                        color: "#FFFFFF",
                                        fontSize: "11px",
                                    }}
                                    formatter={(_value: any, _name: any) => [`${_value ?? 0} ${t("attacks")}`, String(_name ?? "")]}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="h-[250px] flex items-center justify-center text-slate-400 text-sm">
                            {t("noAttackData")}
                        </div>
                    )}
                    <div className="flex flex-wrap gap-3 mt-3 justify-center">
                        {attackChartData.map((entry) => (
                            <div key={entry.name} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                                <span
                                    className="w-3 h-3 rounded-sm"
                                    style={{ backgroundColor: ATTACK_TYPE_COLORS[entry.name] || "#0054A6" }}
                                />
                                {entry.name} ({entry.value})
                            </div>
                        ))}
                    </div>
                </div>

                {/* Recent Attacks */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-slate-100 mb-4 flex items-center gap-2">
                        <IconFlame className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("recentAttacks")}
                        <InfoTooltip content={t("recentAttacksTooltip")} />
                    </h3>
                    {attacks.length > 0 ? (
                        <div className="space-y-3 max-h-[350px] overflow-y-auto">
                            {attacks.map((attack) => (
                                <div
                                    key={attack.id}
                                    className={`rounded-lg border p-3 cursor-pointer hover:shadow-md transition-shadow ${getAttackTypeBgClass(attack.type)}`}
                                    onClick={() => setExpandedAttack(expandedAttack === attack.id ? null : attack.id)}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <h4 className="font-bold text-[#1B2A41] dark:text-slate-100 text-xs flex items-center gap-1.5">
                                                <IconAlertTriangle className="w-3.5 h-3.5 text-[#0054A6]" stroke={1.5} />
                                                {attack.type}
                                            </h4>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                                {formatDate(attack.startTime)} · {attack.duration} min
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${
                                                attack.mitigationStatus === "Mitigated"
                                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                                    : attack.mitigationStatus === "In Progress"
                                                    ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                                    : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                            }`}>
                                                {attack.mitigationStatus === "Mitigated" && <IconCheck className="w-3 h-3 inline mr-0.5" stroke={2} />}
                                                {attack.mitigationStatus}
                                            </span>
                                            <IconChevronDown
                                                className={`w-4 h-4 text-slate-400 transition-transform ${expandedAttack === attack.id ? "rotate-180" : ""}`}
                                                stroke={1.5}
                                            />
                                        </div>
                                    </div>

                                    {expandedAttack === attack.id && (
                                        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-600 grid grid-cols-2 gap-3">
                                            <div>
                                                <span className="text-[11px] text-slate-500">{t("peakTraffic")}</span>
                                                <p className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">{formatGbps(attack.peakTrafficGbps)}</p>
                                            </div>
                                            <div>
                                                <span className="text-[11px] text-slate-500">{t("packetsPerSec")}</span>
                                                <p className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">{formatPps(attack.packetsPerSecond)}</p>
                                            </div>
                                            <div>
                                                <span className="text-[11px] text-slate-500">{t("bytesDropped")}</span>
                                                <p className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">{(attack.bytesDropped / 1e9).toFixed(2)} GB</p>
                                            </div>
                                            <div>
                                                <span className="text-[11px] text-slate-500 flex items-center gap-1">
                                                    <IconMapPin className="w-3 h-3" stroke={1.5} />
                                                    {t("origin")}
                                                </span>
                                                <p className="text-xs font-bold text-[#1B2A41] dark:text-slate-100">{attack.sourceCountries.join(", ")}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="h-[200px] flex items-center justify-center text-slate-400 text-sm">
                            {t("noRecentAttacks")}
                        </div>
                    )}
                </div>
            </div>

            {/* DDoS Plans Table */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl">
                <div className="p-5 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                        <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
                            <IconShieldCheck className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                            {t("activeDdosPlans")}
                            <InfoTooltip content={t("activeDdosPlansTooltip")} />
                        </h3>
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <IconSearch className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" stroke={1.5} />
                                <input
                                    type="text"
                                    placeholder={t("searchPlaceholder")}
                                    value={searchQuery}
                                    onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                                    className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-200 w-48"
                                />
                            </div>
                            <button
                                onClick={() => mutate()}
                                className="p-1.5 bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] rounded-lg hover:bg-blue-50 transition-colors"
                                title={t("refresh")}
                            >
                                <IconRefresh className="w-3.5 h-3.5" stroke={1.5} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
                                <ResizableTh onClick={() => { setSortField("planName"); setSortOrder(sortField === "planName" && sortOrder === "asc" ? "desc" : "asc"); }}>
                                    <div className="flex items-center gap-1">
                                        {t("colPlanName")}
                                        <IconArrowsSort className="w-3 h-3 text-slate-400" stroke={1.5} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh onClick={() => { setSortField("region"); setSortOrder(sortField === "region" && sortOrder === "asc" ? "desc" : "asc"); }}>
                                    <div className="flex items-center gap-1">
                                        {t("colRegion")}
                                        <IconArrowsSort className="w-3 h-3 text-slate-400" stroke={1.5} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh>{t("colResourceGroup")}</ResizableTh>
                                <ResizableTh onClick={() => { setSortField("protectedVnets"); setSortOrder(sortField === "protectedVnets" && sortOrder === "asc" ? "desc" : "asc"); }}>
                                    <div className="flex items-center gap-1">
                                        {t("colProtectedVnets")}
                                        <IconArrowsSort className="w-3 h-3 text-slate-400" stroke={1.5} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh>{t("colProtectedIps")}</ResizableTh>
                                <ResizableTh onClick={() => { setSortField("costPerMonth"); setSortOrder(sortField === "costPerMonth" && sortOrder === "asc" ? "desc" : "asc"); }}>
                                    <div className="flex items-center gap-1">
                                        {t("colMonthlyCost")}
                                        <IconArrowsSort className="w-3 h-3 text-slate-400" stroke={1.5} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh>{t("colStatus")}</ResizableTh>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedPlans.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="py-8 text-center text-slate-400">
                                        {t("noPlans")}
                                    </td>
                                </tr>
                            ) : (
                                paginatedPlans.map((plan) => (
                                    <tr key={plan.planId} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                        <td className="py-2.5 px-4 font-medium text-[#1B2A41] dark:text-slate-200">
                                            {plan.planName}
                                        </td>
                                        <td className="py-2.5 px-4 text-slate-500">{plan.region}</td>
                                        <td className="py-2.5 px-4 text-slate-500">{plan.resourceGroup}</td>
                                        <td className="py-2.5 px-4 text-[#1B2A41] dark:text-slate-200 font-mono">
                                            {plan.protectedVnets}
                                        </td>
                                        <td className="py-2.5 px-4 text-[#1B2A41] dark:text-slate-200 font-mono">
                                            {plan.protectedPublicIps}
                                        </td>
                                        <td className="py-2.5 px-4 font-mono font-semibold text-[#1B2A41] dark:text-slate-200">
                                            {format(plan.costPerMonth)}
                                        </td>
                                        <td className="py-2.5 px-4">
                                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                                                plan.status === "Active"
                                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                                            }`}>
                                                {plan.status === "Active" && <IconCheck className="w-3 h-3" stroke={2} />}
                                                {plan.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {filteredPlans.length > 0 && (
                    <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>{t("perPage")}</span>
                            <select
                                value={pageSize}
                                onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                                className="border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 bg-white dark:bg-slate-800 text-xs"
                            >
                                {[15, 30, 45, 60].map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                            <span>
                                {t("paginationShowing", {
                                    from: (currentPage - 1) * pageSize + 1,
                                    to: Math.min(currentPage * pageSize, filteredPlans.length),
                                    total: filteredPlans.length,
                                })}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                            >
                                <IconChevronLeft className="w-4 h-4" stroke={1.5} />
                            </button>
                            <span className="text-xs text-slate-500 px-2">
                                {t("page", { current: currentPage, total: totalPages })}
                            </span>
                            <button
                                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                            >
                                <IconChevronRight className="w-4 h-4" stroke={1.5} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Recommendations */}
            {recommendations.length > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-2">
                        <IconTrendingDown className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("recommendations")}
                        <InfoTooltip content={t("recommendationsTooltip")} />
                    </h3>
                    <div className="space-y-2">
                        {recommendations.map((rec, idx) => (
                            <div
                                key={idx}
                                className="flex items-start gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-[#1B2A41] dark:text-slate-300"
                            >
                                <IconShieldCheck className="w-4 h-4 text-[#0054A6] mt-0.5 shrink-0" stroke={1.5} />
                                {rec}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
