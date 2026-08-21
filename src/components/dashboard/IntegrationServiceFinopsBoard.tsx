"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import {
  IconRotateClockwise,
  IconCash,
  IconHistory,
  IconTrendingUp,
  IconLayersLinked,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import FinopsTableControls, { type FinopsTableOption } from "@/components/dashboard/FinopsTableControls";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";

type ServiceId = "logic-apps" | "apim" | "service-bus" | "event-grid" | "event-hubs" | "adf";
type SortMode = "name-asc" | "name-desc" | "cost-desc" | "cost-asc";

type IntegrationItem = {
  id: string;
  name: string;
  type: string;
  region: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  provisioningState: string;
  resourceHealth: string;
  mtdCostUsd: number;
  previousPeriodCostUsd: number;
  forecastEomUsd: number;
  metrics: Record<string, number | null>;
};

type IntegrationResponse = {
  data?: {
    summary?: {
      resourceCount?: number;
      mtdCostUsd?: number;
      previousPeriodCostUsd?: number;
      forecastEomUsd?: number;
      dataAvailable?: boolean;
    };
    metricNames?: [string, string];
    items?: IntegrationItem[];
    enterpriseConnectors?: {
      enterpriseConnectorCalls: number;
      enterpriseConnectorCostUsd: number;
      enterpriseConnectorRatioPct: number;
      topConnectors: Array<{ name: string; calls: number; estimatedCostUsd: number }>;
    } | null;
  };
};

type EnterpriseConnectorsSummary = NonNullable<
  NonNullable<IntegrationResponse["data"]>["enterpriseConnectors"]
>;

const FILTER_ALL = "__all__";

const METRIC_LABELS: Record<ServiceId, [string, string]> = {
  "logic-apps": ["logicMetricA", "logicMetricB"],
  apim: ["apimMetricA", "apimMetricB"],
  "service-bus": ["serviceBusMetricA", "serviceBusMetricB"],
  "event-grid": ["eventGridMetricA", "eventGridMetricB"],
  "event-hubs": ["eventHubsMetricA", "eventHubsMetricB"],
  adf: ["adfMetricA", "adfMetricB"],
};

export default function IntegrationServiceFinopsBoard({ service }: { service: ServiceId }) {
  const t = useTranslations("IntegrationServicesFinops");
  const { selectedTenant } = useTenant();
  const { format } = useCurrency();
  const { instance, accounts } = useMsal();

  const [items, setItems] = useState<IntegrationItem[]>([]);
  const [metricNames, setMetricNames] = useState<[string, string]>(["metricA", "metricB"]);
  const [enterpriseConnectors, setEnterpriseConnectors] = useState<EnterpriseConnectorsSummary | null>(null);
  const [summary, setSummary] = useState<NonNullable<IntegrationResponse["data"]>["summary"]>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resourceFilter, setResourceFilter] = useState(FILTER_ALL);
  const [regionFilter, setRegionFilter] = useState(FILTER_ALL);
  const [typeFilter, setTypeFilter] = useState(FILTER_ALL);
  const [resourceGroupFilter, setResourceGroupFilter] = useState(FILTER_ALL);
  const [sortMode, setSortMode] = useState<SortMode>("cost-desc");

  const fetchData = useCallback(
    async (manual = false) => {
      if (!selectedTenant) return;
      if (manual) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        let token: string | null = null;
        if (!isMockTenant(selectedTenant.id)) {
          if (!accounts[0]) throw new Error(t("errorNoSession"));
          token = await getFreshIdToken(instance, accounts[0]);
        }

        const response = await fetch(
          `/api/intelligence/integration-services/${service}?tenantId=${encodeURIComponent(selectedTenant.id)}`,
          {
            cache: "no-store",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          }
        );
        const body: IntegrationResponse = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error((body as any)?.error || `HTTP ${response.status}`);

        setItems(body.data?.items || []);
        setSummary(body.data?.summary || {});
        setMetricNames(body.data?.metricNames || ["metricA", "metricB"]);
        setEnterpriseConnectors(body.data?.enterpriseConnectors || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("errorGeneric"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accounts, instance, selectedTenant, service, t]
  );

  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

  const resourceOptions = useMemo<FinopsTableOption[]>(
    () => [
      { value: FILTER_ALL, label: t("allOption") },
      ...Array.from(new Set(items.map((i) => i.name)))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    ],
    [items, t]
  );
  const regionOptions = useMemo<FinopsTableOption[]>(
    () => [
      { value: FILTER_ALL, label: t("allOption") },
      ...Array.from(new Set(items.map((i) => i.region)))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    ],
    [items, t]
  );
  const typeOptions = useMemo<FinopsTableOption[]>(
    () => [
      { value: FILTER_ALL, label: t("allOption") },
      ...Array.from(new Set(items.map((i) => i.type)))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    ],
    [items, t]
  );
  const resourceGroupOptions = useMemo<FinopsTableOption[]>(
    () => [
      { value: FILTER_ALL, label: t("allOption") },
      ...Array.from(new Set(items.map((i) => i.resourceGroup)))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    ],
    [items, t]
  );
  const sortOptions = useMemo<FinopsTableOption[]>(
    () => [
      { value: "name-asc", label: t("sortAz") },
      { value: "name-desc", label: t("sortZa") },
      { value: "cost-desc", label: t("sortCostDesc") },
      { value: "cost-asc", label: t("sortCostAsc") },
    ],
    [t]
  );

  const filtered = useMemo(() => {
    const base = items.filter((row) => {
      if (resourceFilter !== FILTER_ALL && row.name !== resourceFilter) return false;
      if (regionFilter !== FILTER_ALL && row.region !== regionFilter) return false;
      if (typeFilter !== FILTER_ALL && row.type !== typeFilter) return false;
      if (resourceGroupFilter !== FILTER_ALL && row.resourceGroup !== resourceGroupFilter) return false;
      return true;
    });
    const sorted = [...base];
    if (sortMode === "name-asc") sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (sortMode === "name-desc") sorted.sort((a, b) => b.name.localeCompare(a.name));
    if (sortMode === "cost-desc") sorted.sort((a, b) => b.mtdCostUsd - a.mtdCostUsd);
    if (sortMode === "cost-asc") sorted.sort((a, b) => a.mtdCostUsd - b.mtdCostUsd);
    return sorted;
  }, [items, resourceFilter, regionFilter, typeFilter, resourceGroupFilter, sortMode]);

  const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(filtered, 15);
  const metricLabelKeys = METRIC_LABELS[service];

  if (!selectedTenant) return null;

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6 pb-12">
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-[#1B2A41] dark:text-slate-100">{t("kpiTitle")}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">{t("kpiSubtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => void fetchData(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-[#0078D4] bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-[#0078D4] hover:bg-[#0078D4] hover:text-white transition-all cursor-pointer"
            disabled={refreshing}
          >
            <IconRotateClockwise className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} stroke={2} />
            {t("refresh")}
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title={t("kpiMtdCost")} value={format(Number(summary?.mtdCostUsd || 0))} icon={<IconCash className="h-6 w-6 text-[#0078D4]" stroke={1.5} />} />
        <KpiCard title={t("kpiPrevCost")} value={format(Number(summary?.previousPeriodCostUsd || 0))} icon={<IconHistory className="h-6 w-6 text-[#0078D4]" stroke={1.5} />} />
        <KpiCard title={t("kpiForecast")} value={format(Number(summary?.forecastEomUsd || 0))} icon={<IconTrendingUp className="h-6 w-6 text-[#0078D4]" stroke={1.5} />} />
        <KpiCard title={t("kpiResources")} value={String(summary?.resourceCount || items.length)} icon={<IconLayersLinked className="h-6 w-6 text-[#0078D4]" stroke={1.5} />} />
      </section>

      {service === "logic-apps" && enterpriseConnectors && (
        <section className="rounded-2xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/30 p-6 shadow-xs">
          <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">{t("enterpriseConnectorsTitle")}</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <DetailCard label={t("enterpriseCalls")} value={String(enterpriseConnectors.enterpriseConnectorCalls)} />
            <DetailCard label={t("enterpriseCost")} value={format(enterpriseConnectors.enterpriseConnectorCostUsd)} />
            <DetailCard label={t("enterpriseRatio")} value={`${enterpriseConnectors.enterpriseConnectorRatioPct}%`} />
          </div>
        </section>
      )}

      <FinopsTableControls
        resourceOptions={resourceOptions}
        regionOptions={regionOptions}
        typeOptions={typeOptions}
        resourceGroupOptions={resourceGroupOptions}
        sortOptions={sortOptions}
        selectedResource={resourceFilter}
        selectedRegion={regionFilter}
        selectedType={typeFilter}
        selectedResourceGroup={resourceGroupFilter}
        selectedSort={sortMode}
        onResourceChange={setResourceFilter}
        onRegionChange={setRegionFilter}
        onTypeChange={setTypeFilter}
        onResourceGroupChange={setResourceGroupFilter}
        onSortChange={(value) => setSortMode(value as SortMode)}
        labels={{
          resource: t("filterResource"),
          region: t("filterRegion"),
          type: t("filterType"),
          resourceGroup: t("filterResourceGroup"),
          sort: t("sortBy"),
        }}
      />

      {error && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <div className="flex items-start gap-2">
            <IconAlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{error}</p>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
        {loading ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">{t("loading")}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">{t("noResources")}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-full table-fixed text-left border-collapse text-xs">
                <thead>
                  <tr>
                    <ResizableTh minWidth={170} className="bg-slate-50 dark:bg-slate-800/80 py-3 px-4 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-500 uppercase">{t("colResource")}</ResizableTh>
                    <ResizableTh minWidth={120} className="bg-slate-50 dark:bg-slate-800/80 py-3 px-4 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-500 uppercase">{t("colRegion")}</ResizableTh>
                    <ResizableTh minWidth={170} className="bg-slate-50 dark:bg-slate-800/80 py-3 px-4 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-500 uppercase">{t("colType")}</ResizableTh>
                    <ResizableTh minWidth={170} className="bg-slate-50 dark:bg-slate-800/80 py-3 px-4 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-500 uppercase">{t("colResourceGroup")}</ResizableTh>
                    <ResizableTh minWidth={170} className="bg-slate-50 dark:bg-slate-800/80 py-3 px-4 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-500 uppercase">{t("colSubscription")}</ResizableTh>
                    <ResizableTh minWidth={120} className="bg-slate-50 dark:bg-slate-800/80 py-3 px-4 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-500 uppercase text-right">{t("colMtdCost")}</ResizableTh>
                    <ResizableTh minWidth={120} className="bg-slate-50 dark:bg-slate-800/80 py-3 px-4 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-500 uppercase text-right">{t("colPrevCost")}</ResizableTh>
                    <ResizableTh minWidth={120} className="bg-slate-50 dark:bg-slate-800/80 py-3 px-4 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-500 uppercase text-right">{t("colForecast")}</ResizableTh>
                    <ResizableTh minWidth={140} className="bg-slate-50 dark:bg-slate-800/80 py-3 px-4 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-500 uppercase">{t("colProvisioning")}</ResizableTh>
                    <ResizableTh minWidth={120} className="bg-slate-50 dark:bg-slate-800/80 py-3 px-4 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-500 uppercase">{t("colHealth")}</ResizableTh>
                    <ResizableTh minWidth={120} className="bg-slate-50 dark:bg-slate-800/80 py-3 px-4 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-500 uppercase text-right">{t(metricLabelKeys[0])}</ResizableTh>
                    <ResizableTh minWidth={120} className="bg-slate-50 dark:bg-slate-800/80 py-3 px-4 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-500 uppercase text-right">{t(metricLabelKeys[1])}</ResizableTh>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-950/30">
                      <td className="py-3 px-4 text-slate-900 dark:text-slate-200 font-medium whitespace-normal break-words">{row.name}</td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-400 whitespace-normal break-words">{row.region}</td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-400 whitespace-normal break-words">{row.type}</td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-400 whitespace-normal break-words">{row.resourceGroup}</td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-400 whitespace-normal break-words">{row.subscriptionName}</td>
                      <td className="py-3 px-4 text-slate-900 dark:text-slate-200 font-bold text-right">{format(row.mtdCostUsd)}</td>
                      <td className="py-3 px-4 text-slate-900 dark:text-slate-300 text-right">{format(row.previousPeriodCostUsd)}</td>
                      <td className="py-3 px-4 text-slate-900 dark:text-slate-300 text-right">{format(row.forecastEomUsd)}</td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-400">{row.provisioningState}</td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-400">{row.resourceHealth}</td>
                      <td className="py-3 px-4 text-slate-900 dark:text-slate-300 text-right">{formatMetric(row.metrics[metricNames[0]])}</td>
                      <td className="py-3 px-4 text-slate-900 dark:text-slate-300 text-right">{formatMetric(row.metrics[metricNames[1]])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              setPage={setPage}
              pageSize={pageSize}
              setPageSize={setPageSize}
              total={total}
              totalPages={totalPages}
              pageSizes={[15, 30, 45, 60]}
            />
          </>
        )}
      </section>
    </div>
  );
}

function formatMetric(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function KpiCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
        {icon}
      </div>
      <p className="text-xl font-semibold text-slate-900">{value}</p>
    </article>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-indigo-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-indigo-700">{label}</p>
      <p className="mt-1 text-sm font-medium text-indigo-900">{value}</p>
    </article>
  );
}
