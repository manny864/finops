"use client";
import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useMsal } from "@azure/msal-react";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import MockBanner from "@/components/MockBanner";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import {
    IconLeaf,
    IconWind,
    IconPlant,
    IconCar,
    IconTrees,
    IconDeviceMobile,
    IconMapPin,
    IconRefresh,
    IconSearch,
    IconArrowRight,
    IconSparkles,
    IconCopy,
    IconCheck,
    IconX,
    IconAlertCircle,
    IconLoader2,
    IconArrowsSort,
    IconSortAscending,
    IconSortDescending,
    IconCode,
} from "@tabler/icons-react";
import type {
    SustainabilityApiResponse,
    SustainabilitySummary,
    RegionEmissionsItem,
    GreenMigrationRecommendation,
} from "@/types/sustainability.types";

export default function SustainabilityBoard() {
    const t = useProviderTranslations("Sustainability");
    const { selectedTenant } = useTenant();
    const { selectedSubscription } = useSubscription();
    const { instance, accounts } = useMsal();
    const account = accounts[0];

    // Table state
    const [searchTerm, setSearchTerm] = useState("");
    const [sortField, setSortField] = useState<keyof RegionEmissionsItem>("monthlyEmissionsKgCO2e");
    const [sortAsc, setSortAsc] = useState(false);
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);

    // Modal state for simulation drawer
    const [selectedRecommendation, setSelectedRecommendation] = useState<GreenMigrationRecommendation | null>(null);
    const [copiedScript, setCopiedScript] = useState(false);

    const isMock = selectedTenant?.id ? isMockTenant(selectedTenant.id) : false;
    const shouldFetch =
        selectedTenant &&
        selectedTenant.id !== "default" &&
        (accounts.length > 0 || isMock);

    const fetcher = async (url: string): Promise<SustainabilityApiResponse> => {
        const headers: Record<string, string> = {
            "x-tenant-id": selectedTenant?.id ?? "",
        };

        if (!isMock && account) {
            try {
                const token = await getFreshIdToken(instance, account, ["User.Read"]);
                headers["Authorization"] = `Bearer ${token}`;
            } catch (err) {
                console.warn("[Sustainability] Failed to get MSAL token:", err);
            }
        }

        const res = await fetch(url, { headers });
        if (!res.ok) {
            const j = await res.json();
            throw new Error(j.error || t("emissions_error"));
        }
        return res.json();
    };

    const subQuery = selectedSubscription && selectedSubscription !== "default" ? selectedSubscription : "All";
    const { data: response, error, isLoading, mutate } = useSWR<SustainabilityApiResponse>(
        shouldFetch
            ? `/api/intelligence/sustainability?tenantId=${selectedTenant?.id}&subscriptionId=${subQuery}`
            : null,
        fetcher,
        { revalidateOnFocus: false, revalidateOnReconnect: false }
    );

    const summary: SustainabilitySummary | null = useMemo(() => {
        if (!response) return null;
        if (response.data) return response.data;
        // Fallback mapping for legacy structure
        return {
            totalCarbonKgCO2e: response.footprint ?? 0,
            avoidedEmissionsKgCO2e: response.avoided ?? 0,
            potentialReductionKgCO2e:
                response.recommendations?.reduce((acc, r) => acc + (r.projectedReductionKgCO2 || 0), 0) ?? 0,
            carKilometersEquivalent: response.equivalencies?.carKm ?? 0,
            treesEquivalent: response.equivalencies?.treesYear ?? 0,
            smartphoneChargesEquivalent: response.equivalencies?.phoneCharges ?? 0,
            vmCount: response.vmCount ?? 0,
            storageCount: response.storageCount ?? 0,
            zombieCount: response.zombieCount ?? 0,
            regions: (response.byRegion || []).map((r) => ({
                region: r.region,
                resourcesCount: r.resources,
                gridIntensityGramsPerKwh: r.intensity,
                monthlyEmissionsKgCO2e: r.kgCO2e,
            })),
            recommendations: (response.recommendations || []).map((r) => ({
                fromRegion: r.fromRegion,
                fromIntensity: r.currentIntensity,
                toRegion: r.toRegion,
                toIntensity: r.targetIntensity,
                emissionsReductionPercentage: r.reductionPct,
                co2AvoidedKg: r.projectedReductionKgCO2,
                resourcesCount: r.impactedResources,
            })),
        };
    }, [response]);

    // Filter & Sort Regions
    const filteredRegions = useMemo(() => {
        if (!summary?.regions) return [];
        let list = [...summary.regions];

        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            list = list.filter((r) => r.region.toLowerCase().includes(q));
        }

        list.sort((a, b) => {
            const valA = a[sortField];
            const valB = b[sortField];
            if (typeof valA === "string" && typeof valB === "string") {
                return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            return sortAsc ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
        });

        return list;
    }, [summary?.regions, searchTerm, sortField, sortAsc]);

    // Pagination
    const totalPages = Math.max(1, Math.ceil(filteredRegions.length / pageSize));
    const paginatedRegions = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredRegions.slice(start, start + pageSize);
    }, [filteredRegions, currentPage, pageSize]);

    const handleSort = (field: keyof RegionEmissionsItem) => {
        if (sortField === field) {
            setSortAsc(!sortAsc);
        } else {
            setSortField(field);
            setSortAsc(false);
        }
    };

    const copyMigrationScript = (rec: GreenMigrationRecommendation) => {
        const script = `# ==========================================================
# Azure FinOps Green Migration Template
# Source Region: ${rec.fromRegion} (${rec.fromIntensity} gCO2e/kWh)
# Target Green Region: ${rec.toRegion} (${rec.toIntensity} gCO2e/kWh)
# Emissions Reduction: -${rec.emissionsReductionPercentage}%
# Projected Monthly Savings: ${rec.co2AvoidedKg} kg CO2e/month
# ==========================================================

# 1. Target Resource Group in Green Region (${rec.toRegion})
az group create \\
  --name "rg-green-${rec.toRegion}" \\
  --location "${rec.toRegion}" \\
  --tags CostCenter="FINOPS" Environment="Production" CarbonOptimized="True"

# 2. Azure Resource Mover / Replication validation
az resource move \\
  --destination-group "rg-green-${rec.toRegion}" \\
  --ids <YOUR_RESOURCE_IDS_IN_${rec.fromRegion.toUpperCase()}>

# 3. Confirm carbon reduction and monitor impact
echo "Migration template deployed to ${rec.toRegion}. Expected annual reduction: ~${(rec.co2AvoidedKg * 12).toFixed(2)} kg CO2e"
`;
        navigator.clipboard.writeText(script);
        setCopiedScript(true);
        setTimeout(() => setCopiedScript(false), 2500);
    };

    if (!selectedTenant || selectedTenant.id === "default") return null;

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                        <IconLeaf className="w-7 h-7" stroke={1.5} />
                    </span>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-white font-heading">
                                {t("greenFinops")}
                            </h1>
                            <InfoTooltip content={t("sustainabilityDesc")} />
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {t("subtitle")}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => mutate()}
                        disabled={isLoading}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-white dark:bg-slate-900 text-[#0054A6] border border-[#0054A6] rounded-xl hover:bg-blue-50/50 dark:hover:bg-slate-800 shadow-sm transition-all disabled:opacity-50"
                    >
                        <IconRefresh
                            className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
                            stroke={1.5}
                        />
                        <span>{t("refresh")}</span>
                    </button>
                </div>
            </div>

            <MockBanner />

            {/* Loading */}
            {isLoading && (
                <div className="flex items-center gap-2.5 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm text-slate-600 dark:text-slate-400 text-xs">
                    <IconLoader2 className="w-4 h-4 animate-spin text-[#0078D4]" stroke={1.5} />
                    <span>{t("calculating")}</span>
                </div>
            )}

            {/* Error */}
            {error &&
                (parseTierRequiredError(error.message) ? (
                    <TierLockedNotice
                        requiredTier={parseTierRequiredError(error.message)!}
                        currentTier={(selectedTenant as any)?.tier}
                        featureName="Green FinOps"
                    />
                ) : (
                    <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-5 rounded-2xl border border-red-200 dark:border-red-900/50">
                        <div className="flex items-center gap-2 font-bold mb-1">
                            <IconAlertCircle className="w-5 h-5" stroke={1.5} />
                            <span>{t("error")}</span>
                        </div>
                        <p className="text-sm">{error.message}</p>
                    </div>
                ))}

            {/* Primary KPI Cards (3 Cards) */}
            {summary && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {/* Card 1: Total Carbon Footprint */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-5 flex flex-col justify-between hover:shadow-md transition-all">
                        <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                    <span className="text-slate-500 dark:text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                                        {t("totalCarbonFootprint")}
                                    </span>
                                    <InfoTooltip content={t("footprintTooltip")} />
                                </div>
                                <h3 className="text-2xl font-bold font-heading text-[#1B2A41] dark:text-white">
                                    {summary.totalCarbonKgCO2e.toFixed(2)}{" "}
                                    <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                                        {t("kgCo2ePerMonth")}
                                    </span>
                                </h3>
                            </div>
                            <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                                <IconLeaf className="w-6 h-6" stroke={1.5} />
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                            {summary.vmCount} VMs · {summary.storageCount} Storage Accounts
                        </p>
                    </div>

                    {/* Card 2: Avoided Emissions */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-5 flex flex-col justify-between hover:shadow-md transition-all">
                        <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                    <span className="text-slate-500 dark:text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                                        {t("avoidedEmissions")}
                                    </span>
                                    <InfoTooltip content={t("carbon_saved_tooltip")} />
                                </div>
                                <h3 className="text-2xl font-bold font-heading text-[#0054A6] dark:text-blue-400">
                                    {summary.avoidedEmissionsKgCO2e.toFixed(2)}{" "}
                                    <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                                        {t("kgCo2e")}
                                    </span>
                                </h3>
                            </div>
                            <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                                <IconWind className="w-6 h-6" stroke={1.5} />
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                            {t("avoidedSubtitle", { count: summary.zombieCount })}
                        </p>
                    </div>

                    {/* Card 3: Potential Reduction */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-5 flex flex-col justify-between hover:shadow-md transition-all">
                        <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                    <span className="text-slate-500 dark:text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                                        {t("potentialReduction")}
                                    </span>
                                    <InfoTooltip content={t("reductionTooltip")} />
                                </div>
                                <h3 className="text-2xl font-bold font-heading text-[#0078D4] dark:text-blue-400">
                                    {summary.potentialReductionKgCO2e.toFixed(2)}{" "}
                                    <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                                        {t("kgCo2e")}
                                    </span>
                                </h3>
                            </div>
                            <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                                <IconPlant className="w-6 h-6" stroke={1.5} />
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                            {t("potentialReductionSubtitle")}
                        </p>
                    </div>
                </div>
            )}

            {/* Tangible Equivalencies (3 Sub-Cards) */}
            {summary && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-5 flex items-center gap-4 hover:shadow-md transition-all">
                        <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                            <IconCar className="w-8 h-8" stroke={1.5} />
                        </span>
                        <div>
                            <p className="text-xl font-bold font-heading text-[#1B2A41] dark:text-white">
                                {summary.carKilometersEquivalent.toLocaleString()}{" "}
                                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">km</span>
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                {t("carKilometers")}
                            </p>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-5 flex items-center gap-4 hover:shadow-md transition-all">
                        <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                            <IconTrees className="w-8 h-8" stroke={1.5} />
                        </span>
                        <div>
                            <p className="text-xl font-bold font-heading text-[#1B2A41] dark:text-white">
                                {summary.treesEquivalent}{" "}
                                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{t("trees")}</span>
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                {t("treesYear")}
                            </p>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-5 flex items-center gap-4 hover:shadow-md transition-all">
                        <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                            <IconDeviceMobile className="w-8 h-8" stroke={1.5} />
                        </span>
                        <div>
                            <p className="text-xl font-bold font-heading text-[#1B2A41] dark:text-white">
                                {summary.smartphoneChargesEquivalent.toLocaleString()}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                {t("phoneCharges")}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Standard CMP Table: Regional Emissions */}
            {summary && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                                <IconMapPin className="w-5 h-5" stroke={1.5} />
                            </span>
                            <h3 className="text-base font-bold text-[#1B2A41] dark:text-white font-heading">
                                {t("regionalEmissionsTitle")}
                            </h3>
                            <InfoTooltip content={t("regionalEmissionsDesc")} />
                        </div>

                        {/* Search filter */}
                        <div className="relative min-w-[240px]">
                            <IconSearch
                                className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                                stroke={1.5}
                            />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setCurrentPage(1);
                                }}
                                placeholder={t("searchPlaceholder")}
                                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-[#1B2A41] dark:text-white focus:outline-none focus:border-[#0054A6]"
                            />
                        </div>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto w-full border border-slate-200 dark:border-slate-800 rounded-xl">
                        <table className="w-full text-left border-collapse table-fixed">
                            <thead>
                                <tr className="bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider">
                                    <ResizableTh
                                        minWidth={180}
                                        onClick={() => handleSort("region")}
                                        className="py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <span>{t("colRegion")}</span>
                                            {sortField === "region" ? (
                                                sortAsc ? <IconSortAscending className="w-3.5 h-3.5 text-[#0054A6]" /> : <IconSortDescending className="w-3.5 h-3.5 text-[#0054A6]" />
                                            ) : (
                                                <IconArrowsSort className="w-3.5 h-3.5 text-slate-400" />
                                            )}
                                        </div>
                                    </ResizableTh>
                                    <ResizableTh
                                        minWidth={140}
                                        onClick={() => handleSort("resourcesCount")}
                                        className="py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <span>{t("colResources")}</span>
                                            {sortField === "resourcesCount" ? (
                                                sortAsc ? <IconSortAscending className="w-3.5 h-3.5 text-[#0054A6]" /> : <IconSortDescending className="w-3.5 h-3.5 text-[#0054A6]" />
                                            ) : (
                                                <IconArrowsSort className="w-3.5 h-3.5 text-slate-400" />
                                            )}
                                        </div>
                                    </ResizableTh>
                                    <ResizableTh
                                        minWidth={180}
                                        onClick={() => handleSort("gridIntensityGramsPerKwh")}
                                        className="py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <span>{t("colGridIntensity")}</span>
                                            {sortField === "gridIntensityGramsPerKwh" ? (
                                                sortAsc ? <IconSortAscending className="w-3.5 h-3.5 text-[#0054A6]" /> : <IconSortDescending className="w-3.5 h-3.5 text-[#0054A6]" />
                                            ) : (
                                                <IconArrowsSort className="w-3.5 h-3.5 text-slate-400" />
                                            )}
                                        </div>
                                    </ResizableTh>
                                    <ResizableTh
                                        minWidth={180}
                                        onClick={() => handleSort("monthlyEmissionsKgCO2e")}
                                        className="py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <span>{t("colMonthlyEmissions")}</span>
                                            {sortField === "monthlyEmissionsKgCO2e" ? (
                                                sortAsc ? <IconSortAscending className="w-3.5 h-3.5 text-[#0054A6]" /> : <IconSortDescending className="w-3.5 h-3.5 text-[#0054A6]" />
                                            ) : (
                                                <IconArrowsSort className="w-3.5 h-3.5 text-slate-400" />
                                            )}
                                        </div>
                                    </ResizableTh>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                {paginatedRegions.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="py-8 text-center text-slate-400 dark:text-slate-500">
                                            {t("emptyRegions")}
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedRegions.map((r) => (
                                        <tr
                                            key={r.region}
                                            className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                                        >
                                            <td className="py-3 px-4 font-semibold text-[#1B2A41] dark:text-slate-200">
                                                {r.region}
                                            </td>
                                            <td className="py-3 px-4 text-slate-600 dark:text-slate-300 font-mono">
                                                {r.resourcesCount}
                                            </td>
                                            <td className="py-3 px-4">
                                                <span
                                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                                        r.gridIntensityGramsPerKwh <= 130
                                                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                                            : r.gridIntensityGramsPerKwh <= 250
                                                            ? "bg-blue-50 text-[#0054A6] dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                                                            : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                                                    }`}
                                                >
                                                    {r.gridIntensityGramsPerKwh} g/kWh
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 font-mono font-bold text-[#0054A6] dark:text-blue-400">
                                                {r.monthlyEmissionsKgCO2e.toFixed(2)} kg
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span>Mostrar</span>
                            <select
                                value={pageSize}
                                onChange={(e) => {
                                    setPageSize(Number(e.target.value));
                                    setCurrentPage(1);
                                }}
                                className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs text-[#1B2A41] dark:text-white"
                            >
                                <option value={15}>15</option>
                                <option value={30}>30</option>
                                <option value={45}>45</option>
                                <option value={60}>60</option>
                            </select>
                            <span>de {filteredRegions.length} regiones</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                disabled={currentPage <= 1}
                                onClick={() => setCurrentPage((p) => p - 1)}
                                className="px-3 py-1 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50"
                            >
                                Anterior
                            </button>
                            <span className="text-xs text-slate-500 px-2">
                                {currentPage} / {totalPages}
                            </span>
                            <button
                                type="button"
                                disabled={currentPage >= totalPages}
                                onClick={() => setCurrentPage((p) => p + 1)}
                                className="px-3 py-1 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50"
                            >
                                Siguiente
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Green Region Migration Recommendations Panel */}
            {summary && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-6 space-y-4">
                    <div className="flex items-center gap-2">
                        <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                            <IconPlant className="w-5 h-5" stroke={1.5} />
                        </span>
                        <h3 className="text-base font-bold text-[#1B2A41] dark:text-white font-heading">
                            {t("greenMigrationTitle")}
                        </h3>
                        <InfoTooltip content={t("greenMigrationDesc")} />
                    </div>

                    {summary.recommendations.length === 0 ? (
                        <div className="p-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 text-xs">
                            {t("emptyRecommendations")}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {summary.recommendations.map((rec, idx) => (
                                <div
                                    key={idx}
                                    className="bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 flex flex-col justify-between gap-4 hover:border-[#0054A6]/50 transition-all"
                                >
                                    <div>
                                        <div className="flex items-center justify-between gap-2 mb-3">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-[#0054A6] dark:bg-blue-900/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                                -{rec.emissionsReductionPercentage}% Huella
                                            </span>
                                            <span className="text-xs font-mono font-bold text-[#0054A6] dark:text-blue-400">
                                                ~{rec.co2AvoidedKg.toFixed(2)} kg CO2e/mes
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-2 text-xs font-semibold text-[#1B2A41] dark:text-white">
                                            <span>{rec.fromRegion}</span>
                                            <span className="text-slate-400 text-[11px]">({rec.fromIntensity} g/kWh)</span>
                                            <IconArrowRight className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
                                            <span className="text-[#0054A6] dark:text-blue-400">{rec.toRegion}</span>
                                            <span className="text-slate-400 text-[11px]">({rec.toIntensity} g/kWh)</span>
                                        </div>

                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                                            {t("affectsResources", { count: rec.resourcesCount })}
                                        </p>
                                    </div>

                                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-end">
                                        <button
                                            type="button"
                                            onClick={() => setSelectedRecommendation(rec)}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white dark:bg-slate-900 text-[#0054A6] border border-[#0054A6] rounded-xl hover:bg-blue-50/50 shadow-sm transition-all"
                                        >
                                            <IconSparkles className="w-3.5 h-3.5 text-[#0054A6]" stroke={1.5} />
                                            <span>{t("simulateMigration")}</span>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Modal Drawer for Migration Simulation (z-[100] Layering) */}
            {selectedRecommendation && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
                        onClick={() => setSelectedRecommendation(null)}
                    />

                    {/* Modal Content */}
                    <div className="relative z-[100] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-2xl w-full p-6 space-y-5 animate-in fade-in zoom-in-95">
                        {/* Header */}
                        <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                            <div className="flex items-center gap-3">
                                <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                                    <IconSparkles className="w-6 h-6" stroke={1.5} />
                                </span>
                                <div>
                                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-white font-heading">
                                        {t("simulationModalTitle")}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {t("simulationModalSubtitle")}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedRecommendation(null)}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                            >
                                <IconX className="w-5 h-5" stroke={1.5} />
                            </button>
                        </div>

                        {/* Migration ROI Metrics */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                    {t("emissionsReduction")}
                                </p>
                                <p className="text-lg font-bold text-[#0054A6] dark:text-blue-400">
                                    -{selectedRecommendation.emissionsReductionPercentage}%
                                </p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                    {t("co2Saved")}
                                </p>
                                <p className="text-lg font-bold text-[#1B2A41] dark:text-white font-mono">
                                    {selectedRecommendation.co2AvoidedKg.toFixed(2)} kg/mes
                                </p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700 col-span-2 sm:col-span-1">
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                    {t("annualCarbonSavings")}
                                </p>
                                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                                    {t("kgPerYear", { amount: (selectedRecommendation.co2AvoidedKg * 12).toFixed(2) })}
                                </p>
                            </div>
                        </div>

                        {/* Migration Path Comparison */}
                        <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/50 rounded-xl flex items-center justify-between gap-4 text-xs">
                            <div>
                                <span className="text-slate-500 dark:text-slate-400 block text-[10px] uppercase font-bold">
                                    {t("sourceRegion")}
                                </span>
                                <span className="font-bold text-[#1B2A41] dark:text-white">
                                    {selectedRecommendation.fromRegion}
                                </span>{" "}
                                <span className="text-slate-500">
                                    ({selectedRecommendation.fromIntensity} g/kWh)
                                </span>
                            </div>
                            <IconArrowRight className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />
                            <div className="text-right">
                                <span className="text-slate-500 dark:text-slate-400 block text-[10px] uppercase font-bold">
                                    {t("targetRegion")}
                                </span>
                                <span className="font-bold text-[#0054A6] dark:text-blue-400">
                                    {selectedRecommendation.toRegion}
                                </span>{" "}
                                <span className="text-slate-500">
                                    ({selectedRecommendation.toIntensity} g/kWh)
                                </span>
                            </div>
                        </div>

                        {/* CLI / IaC Script Template */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1B2A41] dark:text-slate-200">
                                    <IconCode className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                                    <span>{t("migrationTemplate")} (Azure CLI)</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => copyMigrationScript(selectedRecommendation)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#0054A6] hover:bg-blue-50 rounded-lg transition-all"
                                >
                                    {copiedScript ? (
                                        <>
                                            <IconCheck className="w-3.5 h-3.5 text-emerald-600" />
                                            <span className="text-emerald-600 font-bold">{t("scriptCopied")}</span>
                                        </>
                                    ) : (
                                        <>
                                            <IconCopy className="w-3.5 h-3.5" stroke={1.5} />
                                            <span>{t("copyScript")}</span>
                                        </>
                                    )}
                                </button>
                            </div>
                            <pre className="bg-[#1B2A41] text-slate-100 p-4 rounded-xl text-[11px] font-mono overflow-x-auto max-h-48 border border-slate-700 leading-relaxed">
{`# 1. Crear Resource Group en la región verde (${selectedRecommendation.toRegion})
az group create \\
  --name "rg-green-${selectedRecommendation.toRegion}" \\
  --location "${selectedRecommendation.toRegion}" \\
  --tags CarbonOptimized="True" GreenFinOps="Verified"

# 2. Migración mediante Azure Resource Mover
az resource move \\
  --destination-group "rg-green-${selectedRecommendation.toRegion}" \\
  --ids <YOUR_RESOURCE_IDS>`}
                            </pre>
                        </div>

                        {/* Footer */}
                        <div className="flex justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <button
                                type="button"
                                onClick={() => setSelectedRecommendation(null)}
                                className="px-4 py-2 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 transition-all"
                            >
                                {t("close")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
