"use client";
import React, { useState, useEffect } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useMsal } from "@azure/msal-react";
import { useLocale } from "next-intl";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import { getFreshIdToken } from "@/lib/msalToken";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import { isMockTenant } from "@/lib/mockData";
import {
    Loader2, AlertCircle, Search, Boxes, Users, Tags,
    DollarSign, Key, Package, Grid3x3, UserCircle2, ChevronRight, ChevronDown, X,
} from "lucide-react";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

const fmtUsd = (n: number | null | undefined) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

function fmtDate(iso: string | null | undefined, locale: string) {
    if (!iso) return "—";
    try { return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso)); } catch { return "—"; }
}

function Kpi({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: React.ReactNode; color: string }) {
    return (
        <div className="p-4 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>{icon}</div>
            <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 truncate">{label}</p>
                <p className="text-lg font-extrabold text-gray-900 dark:text-white">{value}</p>
            </div>
        </div>
    );
}

function useAuthedSWR<T = any>(key: string | null) {
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}`, "x-tenant-id": selectedTenant?.id ?? "" } });
        if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.details || j.error || "Error"); }
        return res.json();
    };
    return useSWR<T>(key, fetcher, { revalidateOnFocus: false });
}

function useReadyKey(path: string) {
    const { selectedTenant } = useTenant();
    const { accounts } = useMsal();
    if (!selectedTenant || selectedTenant.id === "default") return null;
    if (!(accounts.length > 0 || isMockTenant(selectedTenant.id))) return null;
    return `${path}?tenantId=${selectedTenant.id}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Search Resources
// ─────────────────────────────────────────────────────────────────────────────
function SearchResourcesTab() {
    const t = useProviderTranslations("Resources");
    const locale = useLocale();
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(15);
    const { subscriptions } = useSubscription();

    // Los cuatro filtros ya los aceptaba /api/resources/search (search,
    // subscriptionId, resourceGroup, tagKey) y los incluye en su cacheKey; la
    // UI simplemente nunca los mandaba. Acá sólo se cablean.
    const [search, setSearch] = useState("");
    const [subscriptionId, setSubscriptionId] = useState("");
    const [resourceGroup, setResourceGroup] = useState("");
    const [tagKey, setTagKey] = useState("");

    // Debounce del texto: sin esto cada tecla dispara un request (y el endpoint
    // consulta Resource Graph). Los selects no lo necesitan.
    const [debounced, setDebounced] = useState({ search: "", resourceGroup: "", tagKey: "" });
    useEffect(() => {
        const id = setTimeout(() => setDebounced({ search, resourceGroup, tagKey }), 400);
        return () => clearTimeout(id);
    }, [search, resourceGroup, tagKey]);

    // Cualquier cambio de filtro vuelve a la página 1: quedarse en la 4 con un
    // resultado de 2 páginas muestra una tabla vacía que parece "sin datos".
    useEffect(() => {
        setPage(1);
    }, [debounced.search, debounced.resourceGroup, debounced.tagKey, subscriptionId]);

    const base = useReadyKey("/api/resources/search");
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (debounced.search) qs.set("search", debounced.search);
    if (subscriptionId) qs.set("subscriptionId", subscriptionId);
    if (debounced.resourceGroup) qs.set("resourceGroup", debounced.resourceGroup);
    if (debounced.tagKey) qs.set("tagKey", debounced.tagKey);
    const { data, error, isLoading } = useAuthedSWR<any>(base ? `${base}&${qs.toString()}` : null);

    const hasFilters = Boolean(search || subscriptionId || resourceGroup || tagKey);
    const clearFilters = () => { setSearch(""); setSubscriptionId(""); setResourceGroup(""); setTagKey(""); };

    const filterBar = (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-3 flex flex-wrap items-end gap-3">
            <label className="flex-1 min-w-[200px] flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("filter_search")}</span>
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t("filter_search_placeholder")}
                        className="w-full pl-8 pr-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                    />
                </div>
            </label>

            <label className="min-w-[180px] flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("filter_subscription")}</span>
                <select
                    value={subscriptionId}
                    onChange={(e) => setSubscriptionId(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                >
                    <option value="">{t("filter_all")}</option>
                    {(subscriptions || []).map((sub) => (
                        <option key={sub.id} value={sub.id}>
                            {sub.name || sub.id}
                        </option>
                    ))}
                </select>
            </label>

            <label className="min-w-[160px] flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("filter_resource_group")}</span>
                <input
                    type="text"
                    value={resourceGroup}
                    onChange={(e) => setResourceGroup(e.target.value)}
                    placeholder={t("filter_all")}
                    className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                />
            </label>

            <label className="min-w-[150px] flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("filter_tag_key")}</span>
                <input
                    type="text"
                    value={tagKey}
                    onChange={(e) => setTagKey(e.target.value)}
                    placeholder={t("filter_tag_key_placeholder")}
                    className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                />
            </label>

            {hasFilters && (
                <button
                    type="button"
                    onClick={clearFilters}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                >
                    <X className="w-3.5 h-3.5" />{t("filter_clear")}
                </button>
            )}
        </div>
    );

    if (isLoading) return <div className="space-y-4">{filterBar}<LoadingBlock /></div>;
    if (error) return <div className="space-y-4">{filterBar}<ErrorBlock message={error.message} /></div>;
    if (!data) return <div className="space-y-4">{filterBar}</div>;

    const totalPages = Math.max(1, Math.ceil((data.total || 0) / pageSize));

    return (
        <div className="space-y-4">
            {filterBar}
            {/* sortedByCost === false (chequeo estricto, no falsy): el backend
                degrada al orden alfabético cuando el conjunto filtrado supera
                SORT_BY_COST_MAX_RESOURCES, para no costear todo el tenant contra
                Cost Management de una sola vez. Se avisa en vez de mostrar un
                orden distinto al esperado en silencio — usar los filtros acota el
                resultado y reactiva el orden por costo. */}
            {data.sortedByCost === false && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-xs font-medium">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {t("cost_sort_unavailable")}
                </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi icon={<DollarSign className="w-4.5 h-4.5 text-emerald-600" />} color="bg-emerald-50 dark:bg-emerald-950/40" label={t("kpi_cost_groups")} value={data.kpis?.costGroups ?? 0} />
                <Kpi icon={<Key className="w-4.5 h-4.5 text-amber-600" />} color="bg-amber-50 dark:bg-amber-950/40" label={t("kpi_subscriptions")} value={data.kpis?.subscriptions ?? 0} />
                <Kpi icon={<Boxes className="w-4.5 h-4.5 text-brand-deep" />} color="bg-brand-soft/60 dark:bg-slate-800" label={t("kpi_resource_groups")} value={data.kpis?.resourceGroups ?? 0} />
                <Kpi icon={<Grid3x3 className="w-4.5 h-4.5 text-sky-600" />} color="bg-sky-50 dark:bg-sky-950/40" label={t("kpi_resources")} value={data.kpis?.resources ?? 0} />
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm table-fixed min-w-[820px]">
                        <thead className="bg-gray-50 dark:bg-slate-800/60">
                            <tr>
                                {["resource", "resource_group", "subscription", "owner", "cost_group", "created", "period_cost"].map(k => (
                                    <ResizableTh key={k} className="bg-gray-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-bold p-3">{t(`col_${k}`)}</ResizableTh>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {(data.rows || []).map((r: any, i: number) => (
                                <tr key={i} className="border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/40 align-top">
                                    <td className="p-3 font-semibold text-gray-900 dark:text-white whitespace-normal break-words">{r.name}</td>
                                    <td className="p-3 text-gray-600 dark:text-gray-300 whitespace-normal break-words">{r.resourceGroup}</td>
                                    <td className="p-3 text-gray-600 dark:text-gray-300 whitespace-normal break-words">{r.subscriptionName || r.subscriptionId}</td>
                                    <td className="p-3 text-gray-600 dark:text-gray-300 whitespace-normal break-words">{r.tags?.Owner || "—"}</td>
                                    <td className="p-3 text-gray-600 dark:text-gray-300 whitespace-normal break-words">{r.tags?.CostCenter || "—"}</td>
                                    <td className="p-3 text-gray-600 dark:text-gray-300 whitespace-normal">{fmtDate(r.createdTime, locale)}</td>
                                    <td className="p-3 font-bold text-gray-900 dark:text-white whitespace-normal">{fmtUsd(r.periodCost)}</td>
                                </tr>
                            ))}
                            {(!data.rows || data.rows.length === 0) && (
                                <tr><td colSpan={7} className="p-8 text-center text-gray-400">{t("no_resources")}</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="px-4 pb-4">
                    <Pagination page={page} setPage={(p: any) => setPage(typeof p === "function" ? p(page) : p)} pageSize={pageSize} setPageSize={setPageSize} total={data.total || 0} totalPages={totalPages} pageSizes={[15, 30, 45, 60]} />
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Resource Inventory Type
// ─────────────────────────────────────────────────────────────────────────────
function InventoryTab() {
    const t = useProviderTranslations("Resources");
    const key = useReadyKey("/api/resources/inventory");
    const { data, error, isLoading } = useAuthedSWR<any>(key);

    if (isLoading) return <LoadingBlock />;
    if (error) return <ErrorBlock message={error.message} />;
    if (!data) return null;

    const maxCount = Math.max(1, ...(data.byType || []).map((r: any) => r.count));

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Kpi icon={<DollarSign className="w-4.5 h-4.5 text-emerald-600" />} color="bg-emerald-50 dark:bg-emerald-950/40" label={t("kpi_cost_groups")} value={data.kpis?.costGroups ?? 0} />
                <Kpi icon={<Key className="w-4.5 h-4.5 text-amber-600" />} color="bg-amber-50 dark:bg-amber-950/40" label={t("kpi_subscriptions")} value={data.kpis?.subscriptions ?? 0} />
                <Kpi icon={<Boxes className="w-4.5 h-4.5 text-brand-deep" />} color="bg-brand-soft/60 dark:bg-slate-800" label={t("kpi_resource_groups")} value={data.kpis?.resourceGroups ?? 0} />
                <Kpi icon={<Grid3x3 className="w-4.5 h-4.5 text-sky-600" />} color="bg-sky-50 dark:bg-sky-950/40" label={t("kpi_resources")} value={data.kpis?.resources ?? 0} />
                <Kpi icon={<UserCircle2 className="w-4.5 h-4.5 text-purple-600" />} color="bg-purple-50 dark:bg-purple-950/40" label={t("kpi_owners")} value={data.kpis?.owners ?? 0} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-5">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">{t("distribution_by_type")}</h3>
                    <div className="space-y-2.5">
                        {(data.byType || []).map((r: any) => (
                            <div key={r.type} className="flex items-center gap-3">
                                <span className="text-xs text-gray-500 dark:text-gray-400 w-40 truncate shrink-0">{r.type}</span>
                                <div className="flex-1 h-5 bg-gray-100 dark:bg-slate-800 rounded overflow-hidden">
                                    <div className="h-full bg-brand-deep dark:bg-brand-bright rounded" style={{ width: `${(r.count / maxCount) * 100}%` }} />
                                </div>
                                <span className="text-xs font-bold text-gray-900 dark:text-white w-10 text-right shrink-0">{r.count}</span>
                            </div>
                        ))}
                        {(!data.byType || data.byType.length === 0) && <p className="text-sm text-gray-400 text-center py-6">{t("no_data")}</p>}
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-5">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">{t("resource_count_by_subscription")}</h3>
                    <div className="space-y-2.5">
                        {(data.bySubscription || []).map((r: any) => (
                            <div key={r.subscriptionId} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-slate-800/50">
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate" title={r.subscriptionId}>{r.subscriptionName || r.subscriptionId}</span>
                                <span className="text-sm font-extrabold text-gray-900 dark:text-white">{r.count}</span>
                            </div>
                        ))}
                        {(!data.bySubscription || data.bySubscription.length === 0) && <p className="text-sm text-gray-400 text-center py-6">{t("no_data")}</p>}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Created By
// ─────────────────────────────────────────────────────────────────────────────
function CreatedByTab() {
    const t = useProviderTranslations("Resources");
    const key = useReadyKey("/api/resources/created-by");
    const { data, error, isLoading } = useAuthedSWR<any>(key);
    const pg = usePagination<any>(data?.rows, 15);

    if (isLoading) return <LoadingBlock />;
    if (error) return <ErrorBlock message={error.message} />;
    if (!data) return null;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Kpi icon={<UserCircle2 className="w-4.5 h-4.5 text-purple-600" />} color="bg-purple-50 dark:bg-purple-950/40" label={t("kpi_created_by")} value={data.kpis?.createdBy ?? 0} />
                <Kpi icon={<DollarSign className="w-4.5 h-4.5 text-emerald-600" />} color="bg-emerald-50 dark:bg-emerald-950/40" label={t("kpi_cost_groups")} value={data.kpis?.costGroups ?? 0} />
                <Kpi icon={<Key className="w-4.5 h-4.5 text-amber-600" />} color="bg-amber-50 dark:bg-amber-950/40" label={t("kpi_subscriptions")} value={data.kpis?.subscriptions ?? 0} />
                <Kpi icon={<Boxes className="w-4.5 h-4.5 text-brand-deep" />} color="bg-brand-soft/60 dark:bg-slate-800" label={t("kpi_resource_groups")} value={data.kpis?.resourceGroups ?? 0} />
                <Kpi icon={<Grid3x3 className="w-4.5 h-4.5 text-sky-600" />} color="bg-sky-50 dark:bg-sky-950/40" label={t("kpi_resources")} value={data.kpis?.resources ?? 0} />
            </div>

            <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {t("created_by_caveat")}
            </p>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm table-fixed min-w-[560px]">
                        <thead className="bg-gray-50 dark:bg-slate-800/60">
                            <tr>
                                {["user_name", "resources", "resource_groups", "subscriptions"].map(k => (
                                    <ResizableTh key={k} className="bg-gray-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-bold p-3">{t(`col_${k}`)}</ResizableTh>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {pg.paged.map((r: any, i: number) => (
                                <tr key={i} className="border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/40 align-top">
                                    <td className="p-3 font-semibold text-gray-900 dark:text-white whitespace-normal break-words">{r.userName}</td>
                                    <td className="p-3 text-gray-600 dark:text-gray-300">{r.resources}</td>
                                    <td className="p-3 text-gray-600 dark:text-gray-300">{r.resourceGroups}</td>
                                    <td className="p-3 text-gray-600 dark:text-gray-300">{r.subscriptions}</td>
                                </tr>
                            ))}
                            {(!data.rows || data.rows.length === 0) && (
                                <tr><td colSpan={4} className="p-8 text-center text-gray-400">{t("no_data")}</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="px-4 pb-4">
                    <Pagination page={pg.page} setPage={pg.setPage} pageSize={pg.pageSize} setPageSize={pg.setPageSize} total={pg.total} totalPages={pg.totalPages} pageSizes={[15, 30, 45, 60]} />
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Costs by Tag
// ─────────────────────────────────────────────────────────────────────────────
function CostsByTagTab() {
    const t = useProviderTranslations("Resources");
    const key = useReadyKey("/api/resources/costs-by-tag");
    const { data, error, isLoading } = useAuthedSWR<any>(key);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    if (isLoading) return <LoadingBlock />;
    if (error) return <ErrorBlock message={error.message} />;
    if (!data) return null;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Kpi icon={<Grid3x3 className="w-4.5 h-4.5 text-sky-600" />} color="bg-sky-50 dark:bg-sky-950/40" label={t("kpi_resources")} value={data.kpis?.resources ?? 0} />
                <Kpi icon={<Tags className="w-4.5 h-4.5 text-emerald-600" />} color="bg-emerald-50 dark:bg-emerald-950/40" label={t("kpi_resources_with_tags")} value={data.kpis?.resourcesWithTags ?? 0} />
                <Kpi icon={<Tags className="w-4.5 h-4.5 text-rose-600" />} color="bg-rose-50 dark:bg-rose-950/40" label={t("kpi_resources_without_tags")} value={data.kpis?.resourcesWithoutTags ?? 0} />
                <Kpi icon={<Key className="w-4.5 h-4.5 text-amber-600" />} color="bg-amber-50 dark:bg-amber-950/40" label={t("kpi_tag_names")} value={data.kpis?.tagNames ?? 0} />
                <Kpi icon={<Key className="w-4.5 h-4.5 text-purple-600" />} color="bg-purple-50 dark:bg-purple-950/40" label={t("kpi_tag_values")} value={data.kpis?.tagValues ?? 0} />
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                <div className="grid grid-cols-[1fr_120px_120px] gap-2 px-4 py-3 bg-gray-50 dark:bg-slate-800/60 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-bold">
                    <span>{t("col_tag_name_value")}</span>
                    <span className="text-right">{t("col_avg_daily_cost")}</span>
                    <span className="text-right">{t("col_period_cost")}</span>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-slate-800">
                    {(data.tags || []).map((tag: any) => {
                        const isOpen = !!expanded[tag.key];
                        return (
                            <div key={tag.key}>
                                <button onClick={() => setExpanded(p => ({ ...p, [tag.key]: !p[tag.key] }))} className="w-full grid grid-cols-[1fr_120px_120px] gap-2 px-4 py-3 items-center hover:bg-gray-50 dark:hover:bg-slate-800/40 text-left">
                                    <span className="flex items-center gap-1.5 font-bold text-gray-900 dark:text-white">
                                        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                        {tag.key}
                                    </span>
                                    <span className="text-right text-gray-600 dark:text-gray-300 tabular-nums">{fmtUsd(tag.totalCost / 30)}</span>
                                    <span className="text-right font-bold text-gray-900 dark:text-white tabular-nums">{fmtUsd(tag.totalCost)}</span>
                                </button>
                                {isOpen && (tag.values || []).map((v: any) => (
                                    <div key={v.value} className="grid grid-cols-[1fr_120px_120px] gap-2 px-4 py-2 pl-10 items-center border-t border-gray-50 dark:border-slate-800/60">
                                        <span className="text-gray-500 dark:text-gray-400 truncate">{v.value}</span>
                                        <span className="text-right text-gray-500 dark:text-gray-400 tabular-nums">{fmtUsd(v.cost / 30)}</span>
                                        <span className="text-right text-gray-700 dark:text-gray-200 tabular-nums">{fmtUsd(v.cost)}</span>
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                    {(!data.tags || data.tags.length === 0) && (
                        <p className="p-8 text-center text-gray-400">{t("no_data")}</p>
                    )}
                </div>
            </div>
        </div>
    );
}

function LoadingBlock() {
    const t = useProviderTranslations("Resources");
    return (
        <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
            <p className="text-gray-500 dark:text-gray-400">{t("loading")}</p>
        </div>
    );
}

function ErrorBlock({ message }: { message: string }) {
    const { selectedTenant } = useTenant();
    const requiredTier = parseTierRequiredError(message);
    if (requiredTier) {
        return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName="Recursos" compact />;
    }
    return (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
            <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Error</h3>
            <p className="text-sm">{message}</p>
        </div>
    );
}

export default function ResourcesBoard() {
    const t = useProviderTranslations("Resources");
    const { selectedTenant } = useTenant();
    const [tab, setTab] = useState<"search" | "inventory" | "created_by" | "tags">("search");

    if (!selectedTenant || selectedTenant.id === "default") return null;

    const tabs: Array<{ id: typeof tab; label: string; icon: React.ReactNode }> = [
        { id: "search", label: t("tab_search"), icon: <Search className="w-4 h-4" /> },
        { id: "inventory", label: t("tab_inventory"), icon: <Boxes className="w-4 h-4" /> },
        { id: "created_by", label: t("tab_created_by"), icon: <Users className="w-4 h-4" /> },
        { id: "tags", label: t("tab_costs_by_tag"), icon: <Tags className="w-4 h-4" /> },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><Package className="w-5 h-5 text-brand-deep" />{t("title")}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t("subtitle")}</p>
            </div>

            <div className="flex gap-1 border-b border-gray-200 dark:border-slate-800">
                {tabs.map(tb => (
                    <button
                        key={tb.id}
                        onClick={() => setTab(tb.id)}
                        className={`relative flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold border-b-2 transition-colors ${tab === tb.id ? "border-brand-deep text-brand-deep dark:text-brand-bright bg-brand-soft/70 dark:bg-brand-deep/10" : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}
                        aria-pressed={tab === tb.id}
                    >
                        {tb.icon} {tb.label}
                        {tab === tb.id && (
                            <span className="absolute -bottom-[1px] left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-brand-deep dark:bg-brand-bright" />
                        )}
                    </button>
                ))}
            </div>

            {tab === "search" && <SearchResourcesTab />}
            {tab === "inventory" && <InventoryTab />}
            {tab === "created_by" && <CreatedByTab />}
            {tab === "tags" && <CostsByTagTab />}
        </div>
    );
}
