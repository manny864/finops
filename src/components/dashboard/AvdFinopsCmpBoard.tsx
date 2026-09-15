"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  IconRefresh,
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconUsers,
  IconSparkles,
  IconLayoutGrid,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from "@/lib/apiErrors";
import { useTextoDeRecomendacion } from "@/lib/recommendationText";
import VmRemediationModal from "@/components/dashboard/VmRemediationModal";
import type { AvdRemediationAction } from "@/lib/computeWorkloadTypes";
import type { AvdInventory, AvdHostPool } from "@/modules/collectors/azure/avdService";

/** Bytes a GB legibles; `null` cuando la metrica no vino. */
function gb(bytes: number | null): string {
  if (bytes == null) return "—";
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

interface FlatRecommendation {
  action: AvdRemediationAction;
  resourceName: string;
}

export default function AvdFinopsCmpBoard() {
  const t = useTranslations("AvdFinopsCmp");
  const { titulo: tituloDeAccion, descripcion: descripcionDeAccion } = useTextoDeRecomendacion();
  const { selectedTenant } = useTenant();
  const { format } = useCurrency();
  const { instance, accounts } = useMsal();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AvdInventory | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modalAction, setModalAction] = useState<FlatRecommendation | null>(null);

  const fetchData = async (bustCache = false) => {
    if (!selectedTenant || selectedTenant.id === "default") {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let headers: HeadersInit = {};
      if (accounts.length > 0 && !isMockTenant(selectedTenant.id)) {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        if (idToken) headers = { Authorization: `Bearer ${idToken}` };
      }

      const url = `/api/intelligence/compute/avd?tenantId=${encodeURIComponent(
        selectedTenant.id
      )}${bustCache ? "&bust=1" : ""}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        if (res.status === 401) throw new Error(t("errorUnauthorized"));
        throw new Error(t("errorFetch"));
      }
      const json: { ok: boolean; data: AvdInventory; message?: string } = await res.json();
      if (!json.ok) throw new Error(json.message || t("errorFetch"));
      setData(json.data);
    } catch (err) {
      setError(errorMessage(err) || t("errorUnknown"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenant?.id, accounts.length, instance]);

  const hostPools = useMemo(() => data?.hostPools || [], [data]);
  const storage = useMemo(() => data?.storage || [], [data]);
  const workspaces = useMemo(() => data?.workspaces || [], [data]);

  const recommendations = useMemo<FlatRecommendation[]>(() => {
    const list: FlatRecommendation[] = [];
    for (const hp of hostPools) {
      for (const action of hp.remediationActions) {
        list.push({ action, resourceName: hp.friendlyName || hp.name });
      }
      for (const sh of hp.sessionHosts) {
        for (const action of sh.remediationActions) {
          list.push({ action, resourceName: sh.name });
        }
      }
    }
    return list.sort((a, b) => b.action.monthlySavingsUsd - a.action.monthlySavingsUsd);
  }, [hostPools]);

  const totalPotentialSavingUsd = useMemo(
    () => hostPools.reduce((acc, hp) => acc + hp.potentialSavingUsd, 0),
    [hostPools]
  );

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading && !data) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0054A6] border-t-transparent"></div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-900/50 dark:bg-rose-950/20">
        <IconAlertTriangle className="mx-auto h-8 w-8 text-rose-500" />
        <h3 className="mt-2 text-sm font-semibold text-rose-800 dark:text-rose-300">{t("errorTitle")}</h3>
        <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>
        <button
          onClick={() => fetchData(true)}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#0054A6] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#0054A6] dark:text-blue-400 shadow-sm transition-all hover:bg-blue-50 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          <IconRefresh className="h-4 w-4" />
          {t("retry")}
        </button>
      </div>
    );
  }

  const summary = data?.summary;

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t("kpiHostPools")}
          </p>
          <span className="text-2xl font-bold text-slate-900 dark:text-white">{summary?.hostPoolCount ?? 0}</span>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t("kpiSessionHosts")}
          </p>
          <span className="text-2xl font-bold text-slate-900 dark:text-white">{summary?.sessionHostCount ?? 0}</span>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t("kpiActiveSessions", { count: summary?.totalSessions ?? 0 })}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t("kpiComputeCost")}
          </p>
          <span className="text-2xl font-bold text-slate-900 dark:text-white">
            {format(summary?.monthlyComputeCostUsd ?? 0)}
          </span>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t("kpiStorageCost")}
          </p>
          <span className="text-2xl font-bold text-slate-900 dark:text-white">
            {format(summary?.monthlyStorageCostUsd ?? 0)}
          </span>
        </div>
        <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/60 p-4 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            {t("kpiPotentialSaving")}
          </p>
          <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
            {format(totalPotentialSavingUsd)}
          </span>
        </div>
      </div>

      {/* Recomendaciones */}
      {recommendations.length > 0 && (
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
            <IconSparkles className="h-4 w-4 text-[#0054A6]" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t("recommendationsTitle")}</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {recommendations.map((rec) => (
              <div
                key={rec.action.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{rec.resourceName}</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                      +{format(rec.action.monthlySavingsUsd)}
                    </span>
                  </div>
                  <h4 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{tituloDeAccion(rec.action)}</h4>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    {descripcionDeAccion(rec.action)}
                  </p>
                </div>
                <button
                  onClick={() => setModalAction(rec)}
                  className="mt-3 inline-flex items-center justify-center gap-1.5 self-start rounded-lg border border-[#0054A6] bg-white px-3 py-1.5 text-xs font-semibold text-[#0054A6] dark:text-blue-400 shadow-sm transition-all hover:bg-blue-50 dark:bg-slate-900 dark:hover:bg-slate-800"
                >
                  <IconSparkles className="h-3.5 w-3.5" />
                  {t("viewRemediation")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Host Pools */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <IconUsers className="h-4 w-4 text-[#0054A6]" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t("hostPoolsTitle")}</h3>
        </div>
        {hostPools.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">{t("emptyHostPools")}</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left"></th>
                <th className="px-4 py-2 text-left">{t("colName")}</th>
                <th className="px-4 py-2 text-left">{t("colType")}</th>
                <th className="px-4 py-2 text-left">{t("colLoadBalancer")}</th>
                <th className="px-4 py-2 text-left">{t("colRegion")}</th>
                <th className="px-4 py-2 text-left">{t("colAppGroups")}</th>
                <th className="px-4 py-2 text-right">{t("colSessionHosts")}</th>
                <th className="px-4 py-2 text-right">{t("colSessions")}</th>
                <th className="px-4 py-2 text-right">{t("colUsers")}</th>
                <th className="px-4 py-2 text-right">{t("colCostPerUser")}</th>
                <th className="px-4 py-2 text-right">{t("colMonthlyCost")}</th>
              </tr>
            </thead>
            <tbody>
              {hostPools.map((hp: AvdHostPool) => {
                const isOpen = expanded.has(hp.id);
                return (
                  <React.Fragment key={hp.id}>
                    <tr
                      className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                      onClick={() => toggleExpanded(hp.id)}
                    >
                      <td className="px-4 py-2">
                        {isOpen ? (
                          <IconChevronDown className="h-3.5 w-3.5 text-slate-400" />
                        ) : (
                          <IconChevronRight className="h-3.5 w-3.5 text-slate-400" />
                        )}
                      </td>
                      <td className="px-4 py-2 font-medium text-slate-900 dark:text-slate-100">
                        {hp.friendlyName || hp.name}
                        {!hp.alcanzable && (
                          <span
                            className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                            title={t("unreachableTooltip")}
                          >
                            {t("unreachableBadge")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{hp.hostPoolType || t("na")}</td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{hp.loadBalancerType || t("na")}</td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{hp.region}</td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                        {hp.applicationGroups.length === 0 ? (
                          <span className="text-rose-600 dark:text-rose-400">{t("sinAppGroups")}</span>
                        ) : (
                          hp.applicationGroups
                            .map((ag) => `${ag.friendlyName || ag.name}${ag.tipo ? ` (${ag.tipo})` : ""}${ag.workspaceName ? "" : ` · ${t("sinWorkspace")}`}`)
                            .join(", ")
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">
                        {hp.sessionHosts.length}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">{hp.totalSessions}</td>
                      <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">
                        {hp.uso.disponible ? (
                          <span title={t("usersTooltip", { dias: hp.uso.diasAnalizados, horas: hp.uso.horasConexion, pico: hp.uso.picoConcurrencia })}>
                            {hp.uso.usuariosUnicos}
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500" title={t(`usoMotivo_${hp.uso.motivo ?? "error"}`)}>
                            {t("na")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">
                        {hp.costoPorUsuarioUsd != null ? format(hp.costoPorUsuarioUsd) : t("na")}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-slate-900 dark:text-slate-100">
                        {format(hp.monthlyCostUsd)}
                      </td>
                    </tr>
                    {isOpen &&
                      hp.sessionHosts.map((sh) => (
                        <tr key={sh.id} className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/20">
                          <td className="px-4 py-2"></td>
                          <td className="px-4 py-2 pl-6 text-slate-600 dark:text-slate-300" colSpan={2}>
                            {sh.name}
                          </td>
                          <td className="px-4 py-2 text-slate-500 dark:text-slate-400" colSpan={2}>
                            {sh.status} · {sh.osVersion || t("na")}
                            {sh.ahubActive && (
                              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                                AHUB
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right text-slate-500 dark:text-slate-400">
                            {sh.cpuAvgPercent != null ? `${sh.cpuAvgPercent.toFixed(1)}% CPU` : t("na")}
                          </td>
                          <td className="px-4 py-2 text-right text-slate-500 dark:text-slate-400" colSpan={4}>
                            {sh.sessions}
                          </td>
                          <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">
                            {sh.costDataAvailable ? format(sh.monthlyCostUsd) : t("na")}
                          </td>
                        </tr>
                      ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Workspaces */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <IconLayoutGrid className="h-4 w-4 text-[#0054A6]" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t("workspacesTitle")}</h3>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">{t("workspacesHint")}</span>
        </div>
        {workspaces.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">{t("emptyWorkspaces")}</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left">{t("colName")}</th>
                <th className="px-4 py-2 text-left">{t("colRegion")}</th>
                <th className="px-4 py-2 text-right">{t("colAppGroups")}</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => (
                <tr key={w.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2 font-medium text-slate-900 dark:text-slate-100">
                    {w.friendlyName || w.name}
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{w.region}</td>
                  <td className="px-4 py-2 text-right">
                    {w.applicationGroupCount === 0 ? (
                      <span className="text-amber-600 dark:text-amber-400" title={t("workspaceVaciaTooltip")}>0</span>
                    ) : (
                      <span className="text-slate-600 dark:text-slate-300">{w.applicationGroupCount}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* FSLogix / Storage */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <IconDatabase className="h-4 w-4 text-[#0054A6]" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t("storageTitle")}</h3>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">{t("storageHint")}</span>
        </div>
        {storage.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">{t("emptyStorage")}</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left">{t("colName")}</th>
                <th className="px-4 py-2 text-left">{t("colType")}</th>
                <th className="px-4 py-2 text-left">{t("colRegion")}</th>
                <th className="px-4 py-2 text-right">{t("colUsed")}</th>
                <th className="px-4 py-2 text-right">{t("colQuota")}</th>
                <th className="px-4 py-2 text-right">{t("colUtilization")}</th>
                <th className="px-4 py-2 text-right">{t("colMonthlyCost")}</th>
              </tr>
            </thead>
            <tbody>
              {storage.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2 font-medium text-slate-900 dark:text-slate-100">{s.name}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{s.type}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{s.region}</td>
                  <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">{gb(s.usedBytes)}</td>
                  <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">{gb(s.quotaBytes)}</td>
                  <td className="px-4 py-2 text-right">
                    {s.utilizacionPct != null ? (
                      <span className={s.utilizacionPct < 50 ? "font-semibold text-amber-600 dark:text-amber-400" : "text-slate-600 dark:text-slate-300"}>
                        {s.utilizacionPct.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-slate-400">{t("na")}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-slate-900 dark:text-slate-100">
                    {s.costDataAvailable ? format(s.monthlyCostUsd) : t("na")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <VmRemediationModal
        isOpen={modalAction !== null}
        onClose={() => setModalAction(null)}
        action={modalAction?.action ?? null}
        resourceName={modalAction?.resourceName ?? ""}
      />
    </div>
  );
}
