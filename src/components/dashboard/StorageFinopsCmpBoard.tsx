"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Coins,
  Gauge,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import Pagination, { usePagination } from "@/components/Pagination";

type StorageFinopsFamily = "storage-accounts" | "managed-disks" | "backups" | "data-lake-gen2";

interface StorageAccountItem {
  id: string;
  name: string;
  resourceGroup: string;
  subscriptionId: string;
  location: string;
  tier: string;
  sku?: string;
  usedGb: number | null;
  monthlyCost: number;
}

interface StorageEfficiencyResponse {
  success?: boolean;
  empty?: boolean;
  message?: string;
  totalCost?: number;
  costPerGb?: number;
  recommendation?: {
    potentialSavings?: number;
  };
  accounts?: StorageAccountItem[];
}

interface ServiceCostItem {
  serviceLabel: string;
  monthlyCost: number;
  resourceCount: number;
}

interface ServiceCostResponse {
  success?: boolean;
  message?: string;
  totalMonthlyCost?: number;
  items?: ServiceCostItem[];
}

interface ResourceRow {
  id: string;
  name: string;
  region: string;
  state: string;
  sku: string;
  monthlyCostUsd: number;
  metricA?: string;
  metricB?: string;
}

interface Recommendation {
  title: string;
  resource: string;
  monthlySavings: number;
  risk: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  actionType: "manual" | "guided" | "automatic";
  playbookKey: string;
}

const FAMILY_CONFIG: Record<StorageFinopsFamily, { metricALabelKey: string; metricBLabelKey: string; recTitle: string }> = {
  "storage-accounts": { metricALabelKey: "metricAStorageAccounts", metricBLabelKey: "metricBStorageAccounts", recTitle: "recStorageAccounts" },
  "managed-disks": { metricALabelKey: "metricAManagedDisks", metricBLabelKey: "metricBManagedDisks", recTitle: "recManagedDisks" },
  backups: { metricALabelKey: "metricABackups", metricBLabelKey: "metricBBackups", recTitle: "recBackups" },
  "data-lake-gen2": { metricALabelKey: "metricADataLake", metricBLabelKey: "metricBDataLake", recTitle: "recDataLake" },
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function toNumeric(value?: string): number {
  if (!value) return 0;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function forecast(costMtd: number, now: Date) {
  const day = Math.max(1, now.getDate());
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const base = (costMtd / day) * days;
  const band = base * 0.08;
  return { value: round2(base), low: round2(Math.max(0, base - band)), high: round2(base + band) };
}

function forecastRobust(costMtd: number, now: Date, values: number[]) {
  const base = forecast(costMtd, now).value;
  if (values.length < 2) {
    const band = base * 0.08;
    return { value: base, low: round2(Math.max(0, base - band)), high: round2(base + band) };
  }
  const avg = values.reduce((acc, value) => acc + value, 0) / values.length;
  const variance = values.reduce((acc, value) => acc + Math.pow(value - avg, 2), 0) / values.length;
  const stddev = Math.sqrt(variance);
  const volatilityRatio = avg > 0 ? stddev / avg : 0.08;
  const bandRatio = Math.min(0.22, Math.max(0.06, volatilityRatio));
  const band = base * bandRatio;
  return { value: base, low: round2(Math.max(0, base - band)), high: round2(base + band) };
}

export default function StorageFinopsCmpBoard({ family }: { family: StorageFinopsFamily }) {
  const t = useTranslations("StorageFinopsCmp");
  const { selectedTenant } = useTenant();
  const { format } = useCurrency();
  const { instance, accounts } = useMsal();
  const config = FAMILY_CONFIG[family];

  const [items, setItems] = useState<ResourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string>("");
  const [apiPotentialSavings, setApiPotentialSavings] = useState(0);
  const [efficiencyValue, setEfficiencyValue] = useState(0);

  const fetchData = useCallback(async (isManual = false) => {
    if (!selectedTenant) return;
    if (isManual) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const tenantId = selectedTenant.id;
      let token: string | null = null;
      if (!isMockTenant(tenantId)) {
        if (!accounts[0]) throw new Error(t("errorNoSession"));
        token = await getFreshIdToken(instance, accounts[0]);
      }

      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

      if (family === "storage-accounts") {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const params = new URLSearchParams({
          tenantId,
          startDate: formatLocalDate(startOfMonth),
          endDate: formatLocalDate(now),
        });
        const response = await fetch(`/api/intelligence/storage-efficiency?${params.toString()}`, {
          cache: "no-store",
          headers,
        });
        const body: StorageEfficiencyResponse = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error((body as any).error || body.message || `HTTP ${response.status}`);

        const mapped: ResourceRow[] = (body.accounts || []).map((acc) => ({
          id: acc.id,
          name: acc.name,
          region: acc.location || "unknown",
          state: "active",
          sku: acc.sku || "Unknown",
          monthlyCostUsd: Number(acc.monthlyCost || 0),
          metricA: acc.usedGb === null ? "N/A" : String(round2(acc.usedGb)),
          metricB: acc.tier || "N/A",
        }));
        setItems(mapped);
        setApiPotentialSavings(Number(body.recommendation?.potentialSavings || 0));
        setEfficiencyValue(Number(body.costPerGb || 0));
      } else {
        const params = new URLSearchParams({ tenantId, family });
        const response = await fetch(`/api/intelligence/storage/service-cost?${params.toString()}`, {
          cache: "no-store",
          headers,
        });
        const body: ServiceCostResponse = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error((body as any).error || body.message || `HTTP ${response.status}`);

        const mapped: ResourceRow[] = (body.items || []).map((item, index) => ({
          id: `${family}-${index}-${item.serviceLabel}`,
          name: item.serviceLabel,
          region: "global",
          state: "active",
          sku: "Standard",
          monthlyCostUsd: Number(item.monthlyCost || 0),
          metricA: String(Number(item.resourceCount || 0)),
          metricB: item.monthlyCost > 0 ? String(round2(item.monthlyCost / Math.max(1, item.resourceCount))) : "0",
        }));
        setItems(mapped);
        setApiPotentialSavings(0);
        setEfficiencyValue(0);
      }

      setLastUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedTenant, family, accounts, instance, t]);

  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

  useEffect(() => {
    if (!selectedResourceId && items.length > 0) setSelectedResourceId(items[0].id);
  }, [items, selectedResourceId]);

  const selected = useMemo(() => items.find((item) => item.id === selectedResourceId) || null, [items, selectedResourceId]);

  const derived = useMemo(() => {
    const mtdCost = round2(items.reduce((acc, item) => acc + (item.monthlyCostUsd || 0), 0));
    const eom = forecastRobust(mtdCost, new Date(), items.map((item) => item.monthlyCostUsd));
    const prevMonth = mtdCost * 0.9;
    const delta = mtdCost - prevMonth;
    const deltaPct = prevMonth > 0 ? (delta / prevMonth) * 100 : 0;
    const underutilized = items.filter((item) => toNumeric(item.metricA) <= 1).length;
    const criticalAlerts = items.filter((item) => item.monthlyCostUsd > 0 && toNumeric(item.metricA) === 0).length;
    const healthScore = Math.max(0, 100 - criticalAlerts * 8);

    const recommendations: Recommendation[] = items
      .filter((item) => item.monthlyCostUsd > 0)
      .map((item) => ({
        title: t(config.recTitle),
        resource: item.name,
        monthlySavings: round2(item.monthlyCostUsd * 0.15),
        risk: item.monthlyCostUsd > 100 ? "high" as const : "medium" as const,
        confidence: toNumeric(item.metricA) > 0 ? "high" as const : "medium" as const,
        actionType: toNumeric(item.metricA) > 0 ? "guided" as const : "manual" as const,
        playbookKey: family === "storage-accounts"
          ? "playbookStorageAccounts"
          : family === "managed-disks"
            ? "playbookManagedDisks"
            : family === "backups"
              ? "playbookBackups"
              : "playbookDataLake",
      }))
      .sort((a, b) => b.monthlySavings - a.monthlySavings)
      .slice(0, 8);

    const potentialSavings = round2(
      Math.max(apiPotentialSavings, recommendations.reduce((acc, rec) => acc + rec.monthlySavings, 0))
    );

    const efficiencyComputed = items.length > 0
      ? mtdCost / Math.max(1, items.reduce((acc, item) => acc + toNumeric(item.metricA), 0))
      : 0;

    const byRegion = new Map<string, { count: number; cost: number }>();
    for (const item of items) {
      const key = item.region || "unknown";
      const curr = byRegion.get(key) || { count: 0, cost: 0 };
      curr.count += 1;
      curr.cost += item.monthlyCostUsd || 0;
      byRegion.set(key, curr);
    }
    const comparison = Array.from(byRegion.entries())
      .map(([region, info]) => ({
        region,
        count: info.count,
        cost: round2(info.cost),
        avgCost: round2(info.cost / Math.max(1, info.count)),
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 8);

    return {
      mtdCost,
      eom,
      deltaValue: round2(delta),
      deltaPct: round2(deltaPct),
      underutilized,
      criticalAlerts,
      healthScore: round2(healthScore),
      recommendations,
      potentialSavings,
      efficiency: efficiencyValue > 0 ? efficiencyValue : round2(efficiencyComputed),
      comparison,
    };
  }, [items, apiPotentialSavings, efficiencyValue, t, config.recTitle, family]);

  const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(items, 10);

  if (!selectedTenant) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">{t("selectTenant")}</div>;
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        <p className="text-sm text-slate-600">{t("loading")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{t("headerTitle")}</h3>
            <p className="text-sm text-slate-600">{t("headerSubtitle")}</p>
            {lastUpdatedAt && <p className="mt-2 text-xs text-slate-500">{t("updatedAt")}: {lastUpdatedAt.toLocaleTimeString()}</p>}
          </div>
          <button type="button" onClick={() => void fetchData(true)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50" disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {t("refresh")}
          </button>
        </div>
      </section>

      {error && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{error}</p>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title={t("kpiMtdCost")} value={format(derived.mtdCost)} icon={<Wallet className="h-5 w-5 text-sky-600" />} />
        <KpiCard title={t("kpiForecast")} value={format(derived.eom.value)} subtitle={`${format(derived.eom.low)} - ${format(derived.eom.high)}`} icon={<Gauge className="h-5 w-5 text-violet-600" />} />
        <KpiCard title={t("kpiPotentialSavings")} value={format(derived.potentialSavings)} icon={<Coins className="h-5 w-5 text-emerald-600" />} />
        <KpiCard title={t("kpiDelta")} value={`${derived.deltaPct >= 0 ? "+" : ""}${derived.deltaPct.toFixed(2)}%`} subtitle={format(derived.deltaValue)} icon={derived.deltaPct >= 0 ? <ArrowUpRight className="h-5 w-5 text-rose-600" /> : <ArrowDownRight className="h-5 w-5 text-emerald-600" />} />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title={t("kpiResources")} value={String(items.length)} icon={<CheckCircle2 className="h-5 w-5 text-cyan-600" />} />
        <KpiCard title={t("kpiEfficiency")} value={format(derived.efficiency)} icon={<Gauge className="h-5 w-5 text-amber-600" />} />
        <KpiCard title={t("kpiUnderutilized")} value={String(derived.underutilized)} icon={<Gauge className="h-5 w-5 text-orange-600" />} />
        <KpiCard title={t("kpiHealth")} value={`${derived.healthScore.toFixed(1)} / 100`} subtitle={t("criticalAlerts", { count: derived.criticalAlerts })} icon={<ShieldAlert className="h-5 w-5 text-rose-600" />} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">{t("resourceDetailTitle")}</h3>
        <select
          value={selectedResourceId}
          onChange={(e) => setSelectedResourceId(e.target.value)}
          className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 hover:border-slate-400"
        >
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.region})
            </option>
          ))}
        </select>
        {selected ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <DetailCard label={t("detailResource")} value={selected.name} />
            <DetailCard label={t("detailRegion")} value={selected.region} />
            <DetailCard label={t(config.metricALabelKey)} value={selected.metricA || t("na")} />
            <DetailCard label={t(config.metricBLabelKey)} value={selected.metricB || t("na")} />
            <DetailCard label={t("detailState")} value={selected.state || t("na")} />
            <DetailCard label={t("detailSku")} value={selected.sku || t("na")} />
            <DetailCard label={t("detailMonthlyCost")} value={format(selected.monthlyCostUsd || 0)} />
            <DetailCard label={t("detailPotentialSaving")} value={format(round2((selected.monthlyCostUsd || 0) * 0.15))} />
          </div>
        ) : (
          <p className="text-sm text-slate-600">{t("noResourceSelected")}</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">{t("allResourcesTitle")}</h3>
        {items.length === 0 ? (
          <p className="text-sm text-slate-600">{t("noResources")}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <th className="py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">{t("colResource")}</th>
                    <th className="py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">{t("colRegion")}</th>
                    <th className="py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">{t("colState")}</th>
                    <th className="py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">{t(config.metricALabelKey)}</th>
                    <th className="py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">{t(config.metricBLabelKey)}</th>
                    <th className="py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right">{t("colMonthlyCost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 border-b border-slate-100 text-sm font-medium text-slate-900">{item.name}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600">{item.region}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600">{item.state || t("na")}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600">{item.metricA || t("na")}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600">{item.metricB || t("na")}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-900 text-right">{format(item.monthlyCostUsd || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} />
          </>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">{t("recommendationsTitle")}</h3>
        {derived.recommendations.length === 0 ? (
          <p className="text-sm text-slate-600">{t("noRecommendations")}</p>
        ) : (
          <div className="space-y-3">
            {derived.recommendations.map((rec, index) => (
              <article key={`${rec.resource}-${index}`} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{rec.title}</p>
                    <p className="text-xs text-slate-500">{rec.resource}</p>
                  </div>
                  <p className="text-sm font-semibold text-emerald-700">{format(rec.monthlySavings)}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <Badge label={t("riskLabel", { value: t(`risk_${rec.risk}`) })} />
                  <Badge label={t("confidenceLabel", { value: t(`confidence_${rec.confidence}`) })} />
                  <Badge label={t("actionLabel", { value: t(`action_${rec.actionType}`) })} />
                </div>
                <p className="mt-2 text-xs text-slate-600">{t(rec.playbookKey)}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">{t("comparisonTitle")}</h3>
        {derived.comparison.length === 0 ? (
          <p className="text-sm text-slate-600">{t("noComparisonData")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr>
                  <th className="py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">{t("colDimension")}</th>
                  <th className="py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right">{t("colResources")}</th>
                  <th className="py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right">{t("colMonthlyCost")}</th>
                  <th className="py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right">{t("colAvgCost")}</th>
                </tr>
              </thead>
              <tbody>
                {derived.comparison.map((row) => (
                  <tr key={row.region}>
                    <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-700">{row.region}</td>
                    <td className="py-3 px-4 border-b border-slate-100 text-sm text-right text-slate-700">{row.count}</td>
                    <td className="py-3 px-4 border-b border-slate-100 text-sm text-right text-slate-900">{format(row.cost)}</td>
                    <td className="py-3 px-4 border-b border-slate-100 text-sm text-right text-slate-700">{format(row.avgCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({ title, value, subtitle, icon }: { title: string; value: string; subtitle?: string; icon: React.ReactNode }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
        {icon}
      </div>
      <p className="text-xl font-semibold text-slate-900">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
    </article>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-900">{value}</p>
    </article>
  );
}

function Badge({ label }: { label: string }) {
  return <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{label}</span>;
}
