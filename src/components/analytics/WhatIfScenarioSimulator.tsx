"use client";
import { useLocale, useTranslations } from "next-intl";

import React, { useState, useMemo, useEffect } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import type { IPublicClientApplication, AccountInfo } from "@azure/msal-browser";
import {
  IconCalculator,
  IconCurrencyDollar,
  IconTrendingDown,
  IconSparkles,
  IconRotateClockwise,
  IconDatabaseExport,
  IconBookmark,
  IconCpu,
  IconServer2,
  IconWorld,
  IconPigMoney,
  IconBolt,
  IconClockPause,
  IconShieldCheck,
  IconDeviceDesktopAnalytics,
  IconPlayerPlay,
  IconArrowsExchange,
  IconCheck,
  IconX,
  IconTrash,
  IconDownload,
  IconChevronRight,
  IconAlertTriangle,
} from "@tabler/icons-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import { simulateScenario } from "@/services/azureWhatIfSimulator.service";
import { TOOLTIP_TEMA } from "@/lib/chartTooltip";
import {
  type SavedWhatIfScenario,
  type WhatIfParameters,
  type WhatIfPayload,
  type WhatIfSimulationResult,
} from "@/types/azureWhatIf.types";

const VISIBLE_SCROLLBAR =
  "overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 " +
  "scrollbar-track-slate-100 dark:scrollbar-track-slate-800 " +
  "[&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full " +
  "[&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 " +
  "[&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800";

const money = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(v);

// `t` entra por parametro: buildFetcher no es un componente ni un hook y no
// puede llamar a useTranslations.
function buildFetcher(instance: IPublicClientApplication, accounts: AccountInfo[], isMock: boolean, t: (k: string) => string) {
  return async (url: string) => {
    const headers: Record<string, string> = {};
    if (!isMock && accounts.length > 0) {
      try {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
      } catch {
        // Dejar propagar
      }
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || t("loadError"));
    }
    return res.json();
  };
}

// ─── Modal de Comparación de Escenarios Lado a Lado ───
interface ComparisonModalProps {
  scenarios: SavedWhatIfScenario[];
  onClose: () => void;
}

function ScenarioComparisonModal({ scenarios, onClose }: ComparisonModalProps) {
  const t = useTranslations("WhatIfSimulator");
  if (scenarios.length < 2) return null;

  const comparisonChartData = scenarios.map((s) => ({
    name: s.name.length > 20 ? s.name.slice(0, 20) + "..." : s.name,
    base: s.baseCostUSD,
    projected: s.projectedCostUSD,
    savings: s.simulationResult.totalSavingsUSD,
  }));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs animate-fadeIn">
      <div className="relative z-[100] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-4xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <IconArrowsExchange className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
            <div>
              <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">
                {t("sideBySideTitle", { n: scenarios.length })}
              </h3>
              <p className="text-xs text-slate-500">
                {t("sideBySideSub")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer shadow-xs transition"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>

        {/* Gráfica de Barras Comparativa */}
        <div className="h-[220px] w-full p-2 bg-slate-50/50 dark:bg-slate-800/30 rounded-xl border border-slate-200 dark:border-slate-800">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={comparisonChartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94A3B8" opacity={0.2} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748B" }} />
              <YAxis tick={{ fontSize: 11, fill: "#64748B" }} tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(val: any) => money(Number(val))} {...TOOLTIP_TEMA} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="base" name={t("legendBaseCost")} fill="#64748B" radius={[4, 4, 0, 0]} />
              <Bar dataKey="projected" name={t("legendProjectedCost")} fill="#0054A6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="savings" name={t("legendSavings")} fill="#0284C7" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Matriz Comparativa */}
        <div className={`border border-slate-200 dark:border-slate-800 rounded-xl ${VISIBLE_SCROLLBAR}`}>
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                <th className="p-3 font-bold text-slate-700 dark:text-slate-200">{t("colMetric")}</th>
                {scenarios.map((s) => (
                  <th key={s.id} className="p-3 font-bold text-[#0054A6] dark:text-sky-400 min-w-[160px]">
                    {s.nameKey ? t(s.nameKey) : s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              <tr>
                <td className="p-3 font-semibold text-slate-600 dark:text-slate-300">{t("colBaseSpend")}</td>
                {scenarios.map((s) => (
                  <td key={s.id} className="p-3 font-mono font-bold text-slate-800 dark:text-slate-100">
                    {money(s.baseCostUSD)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-3 font-semibold text-slate-600 dark:text-slate-300">{t("colNetProjected")}</td>
                {scenarios.map((s) => (
                  <td key={s.id} className="p-3 font-mono font-extrabold text-[#0054A6] dark:text-sky-400">
                    {money(s.projectedCostUSD)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-3 font-semibold text-slate-600 dark:text-slate-300">{t("colNetVariation")}</td>
                {scenarios.map((s) => (
                  <td key={s.id} className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded-md font-bold text-[11px] ${
                        s.deltaPercentage <= 0
                          ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                          : "bg-blue-50 text-[#0054A6] border border-blue-200"
                      }`}
                    >
                      {s.deltaPercentage > 0 ? `+${s.deltaPercentage}%` : `${s.deltaPercentage}%`}
                    </span>
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-3 font-semibold text-slate-600 dark:text-slate-300">{t("colTotalSavings")}</td>
                {scenarios.map((s) => (
                  <td key={s.id} className="p-3 font-semibold text-emerald-600">
                    {money(s.simulationResult.totalSavingsUSD)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-3 font-semibold text-slate-600 dark:text-slate-300">RIs / Savings Plans</td>
                {scenarios.map((s) => (
                  <td key={s.id} className="p-3 text-slate-600 dark:text-slate-300">
                    {s.parameters.commitmentCoveragePercentage}% ({s.parameters.commitmentTerm})
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-3 font-semibold text-slate-600 dark:text-slate-300">Instancias Spot / Off-Hours</td>
                {scenarios.map((s) => (
                  <td key={s.id} className="p-3 text-slate-600 dark:text-slate-300">
                    Spot: {s.parameters.spotMixPercentage}% | Off-Hours: {s.parameters.offHoursShutdownPercentage}%
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-3 font-semibold text-slate-600 dark:text-slate-300">AHB & ARM64</td>
                {scenarios.map((s) => (
                  <td key={s.id} className="p-3 text-slate-600 dark:text-slate-300">
                    AHB: {s.parameters.enableAhbLicensing ? t("yes") : t("no")} | ARM64:{" "}
                    {s.parameters.enableArm64Modernization ? t("yes") : t("no")}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition cursor-pointer shadow-xs"
          >
            {t("closeComparator")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal para Guardar Escenario ───
interface SaveScenarioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  defaultName: string;
}

function SaveScenarioModal({ isOpen, onClose, onSave, defaultName }: SaveScenarioModalProps) {
  const t = useTranslations("WhatIfSimulator");
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    setName(defaultName);
  }, [defaultName]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs animate-fadeIn">
      <div className="relative z-[100] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
            <IconBookmark className="w-5 h-5 text-[#0078D4]" />
            {t("saveScenarioTitle")}
          </h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
            <IconX className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t("scenarioName")}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
            placeholder={t("scenarioPlaceholder")}
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            {t("cancel")}
          </button>
          <button
            onClick={() => {
              if (name.trim()) onSave(name.trim());
            }}
            className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-[#0054A6] text-white hover:bg-[#004080] transition cursor-pointer shadow-xs"
          >
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function WhatIfScenarioSimulator() {
  const t = useTranslations("WhatIfSimulator");
  const locale = useLocale();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || "";
  const searchParams = useSearchParams();
  const { instance, accounts } = useMsal();

  const isMock = useMemo(
    () =>
      isMockTenant(tenantId) ||
      searchParams.get("mock") === "true" ||
      tenantId.startsWith("demo-") ||
      tenantId.startsWith("mock-"),
    [tenantId, searchParams]
  );

  const fetcher = useMemo(() => buildFetcher(instance, accounts, isMock, t), [instance, accounts, isMock, t]);
  const apiUrl = `/api/analytics/simulator?tenantId=${encodeURIComponent(tenantId)}`;
  const { data, error, isValidating, mutate } = useSWR<WhatIfPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  // Estado de variables del escenario
  const initialBaseCost = data?.baseCostUSD ?? 0;
  const [baseCostUSD, setBaseCostUSD] = useState<number>(initialBaseCost);
  const [isBaseCostEdited, setIsBaseCostEdited] = useState<boolean>(false);

  const [computeGrowth, setComputeGrowth] = useState<number>(0);
  const [storageGrowth, setStorageGrowth] = useState<number>(0);
  const [networkGrowth, setNetworkGrowth] = useState<number>(0);

  const [commitmentCoverage, setCommitmentCoverage] = useState<number>(60);
  const [commitmentTerm, setCommitmentTerm] = useState<"1Year" | "3Years">("3Years");
  const [spotMix, setSpotMix] = useState<number>(20);
  const [offHoursShutdown, setOffHoursShutdown] = useState<number>(50);
  const [enableAhb, setEnableAhb] = useState<boolean>(true);
  const [enableArm64, setEnableArm64] = useState<boolean>(false);

  // Escenarios guardados locales + remotos
  const [savedScenariosList, setSavedScenariosList] = useState<SavedWhatIfScenario[]>([]);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState<boolean>(false);
  const [isComparisonModalOpen, setIsComparisonModalOpen] = useState<boolean>(false);

  // Sincronizar estado inicial cuando llegue la data
  useEffect(() => {
    if (data?.baseCostUSD && !isBaseCostEdited) {
      setBaseCostUSD(data.baseCostUSD);
    }
    if (data?.savedScenarios) {
      setSavedScenariosList(data.savedScenarios);
    }
  }, [data, isBaseCostEdited]);

  // Cálculo en tiempo real de la simulación actual
  const currentParams: WhatIfParameters = useMemo(
    () => ({
      baseCostUSD,
      computeGrowthPercentage: computeGrowth,
      storageGrowthPercentage: storageGrowth,
      networkEgressGrowthPercentage: networkGrowth,
      commitmentCoveragePercentage: commitmentCoverage,
      commitmentTerm,
      spotMixPercentage: spotMix,
      offHoursShutdownPercentage: offHoursShutdown,
      enableAhbLicensing: enableAhb,
      enableArm64Modernization: enableArm64,
    }),
    [
      baseCostUSD,
      computeGrowth,
      storageGrowth,
      networkGrowth,
      commitmentCoverage,
      commitmentTerm,
      spotMix,
      offHoursShutdown,
      enableAhb,
      enableArm64,
    ]
  );

  const activeResult: WhatIfSimulationResult = useMemo(
    () => simulateScenario(currentParams),
    [currentParams]
  );

  // El servicio manda `stepKey`, no el nombre del paso: no conoce el locale del
  // lector y su payload se cachea. La etiqueta del eje se arma aca.
  const pasosTraducidos = useMemo(
    () =>
      activeResult.waterfallSteps.map((paso) => ({
        ...paso,
        stepLabel: t(`waterfall_${paso.stepKey}`),
      })),
    [activeResult, t]
  );

  // Paginación para la tabla de escenarios
  const { paged, page, totalPages, pageSize, setPage, setPageSize, total } = usePagination(
    savedScenariosList,
    15
  );

  const handleSaveScenario = async (name: string) => {
    setIsSaveModalOpen(false);
    const newScenario: SavedWhatIfScenario = {
      id: `scen-${Date.now()}`,
      name,
      baseCostUSD,
      projectedCostUSD: activeResult.netProjectedCostUSD,
      deltaPercentage: activeResult.deltaPercentage,
      parameters: currentParams,
      simulationResult: activeResult,
      createdAt: new Date().toISOString(),
    };

    setSavedScenariosList((prev) => [newScenario, ...prev]);

    // Persistir si es tenant conectado
    if (!isMock) {
      try {
        const idToken = accounts[0] ? await getFreshIdToken(instance, accounts[0]) : "";
        await fetch("/api/analytics/simulator", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            tenantId,
            action: "SAVE_SCENARIO",
            name,
            parameters: currentParams,
          }),
        });
      } catch {
        // Fallback silencioso
      }
    }
  };

  const handleLoadScenario = (scen: SavedWhatIfScenario) => {
    setBaseCostUSD(scen.parameters.baseCostUSD);
    setIsBaseCostEdited(true);
    setComputeGrowth(scen.parameters.computeGrowthPercentage);
    setStorageGrowth(scen.parameters.storageGrowthPercentage);
    setNetworkGrowth(scen.parameters.networkEgressGrowthPercentage);
    setCommitmentCoverage(scen.parameters.commitmentCoveragePercentage);
    setCommitmentTerm(scen.parameters.commitmentTerm);
    setSpotMix(scen.parameters.spotMixPercentage);
    setOffHoursShutdown(scen.parameters.offHoursShutdownPercentage);
    setEnableAhb(scen.parameters.enableAhbLicensing);
    setEnableArm64(scen.parameters.enableArm64Modernization);
  };

  const handleDeleteScenario = (id: string) => {
    setSavedScenariosList((prev) => prev.filter((s) => s.id !== id));
    setSelectedScenarioIds((prev) => prev.filter((item) => item !== id));
  };

  const handleExportCSV = () => {
    if (savedScenariosList.length === 0) return;
    const headers = [
      t("csvId"),
      t("csvName"),
      t("csvBaseCostUSD"),
      t("csvProjectedCostUSD"),
      t("csvDelta"),
      t("csvCreatedAt"),
    ];
    const rows = savedScenariosList.map((s) => [
      s.id,
      `"${s.nameKey ? t(s.nameKey) : s.name}"`,
      s.baseCostUSD.toFixed(2),
      s.projectedCostUSD.toFixed(2),
      s.deltaPercentage,
      s.createdAt,
    ]);
    const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `whatif-scenarios-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleSelectScenario = (id: string) => {
    setSelectedScenarioIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectedScenariosForComparison = savedScenariosList.filter((s) =>
    selectedScenarioIds.includes(s.id)
  );

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado ─── */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconCalculator className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>{t("boardTitle")}</span>
              <InfoTooltip
                content={t("pageTooltip")}
                position="bottom"
                align="left"
              />
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Live FOCUS & Rates" : "Demo Predictive Sandbox"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t("pageSubtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-800 text-[#0054A6] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <IconDatabaseExport className="w-4 h-4" stroke={1.5} />
            <span>{t("downloadScenarios")}</span>
          </button>
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-800 text-[#0054A6] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
          >
            <IconRotateClockwise className={`w-4 h-4 ${isValidating ? "animate-spin" : ""}`} stroke={1.5} />
            <span>{t("refresh")}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 flex items-start gap-2">
          <IconAlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-red-700 dark:text-red-400">{String(error.message || error)}</p>
        </div>
      )}

      {/* ─── 4 KPI Cards Superiores ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: t("kpiBaseCost"),
            tip: t("kpiBaseCostTip"),
            value: money(baseCostUSD),
            sub: isBaseCostEdited ? t("kpiBaseCostCustom") : t("kpiBaseCostSub"),
            Icon: IconCurrencyDollar,
            warn: false,
          },
          {
            label: t("kpiProjected"),
            tip: t("kpiProjectedTip"),
            value: money(activeResult.netProjectedCostUSD),
            sub: t("kpiProjectedSub", { delta: activeResult.deltaPercentage > 0 ? `+${activeResult.deltaPercentage}` : `${activeResult.deltaPercentage}` }),
            Icon: IconCalculator,
            warn: activeResult.deltaPercentage > 20,
          },
          {
            label: t("kpiMonthlySavings"),
            tip: t("kpiMonthlySavingsTip"),
            value: money(activeResult.totalSavingsUSD),
            sub: t("kpiActiveLevers", { count: activeResult.waterfallSteps.length - 2 }),
            Icon: IconTrendingDown,
            warn: false,
          },
          {
            label: t("kpiAnnualized"),
            tip: t("kpiAnnualizedTip"),
            value: money(activeResult.annualizedSavingsUSD),
            sub: t("kpiAnnualizedSub"),
            Icon: IconSparkles,
            warn: false,
          },
        ].map((c) => (
          <div
            key={c.label}
            className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between"
          >
            <div className="space-y-1 min-w-0">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <span>{c.label}</span>
                <InfoTooltip content={c.tip} />
              </div>
              <div
                className={`text-2xl font-extrabold truncate ${
                  c.warn ? "text-amber-600 dark:text-amber-400" : "text-[#1B2A41] dark:text-slate-100"
                }`}
                title={c.value}
              >
                {c.value}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{c.sub}</div>
            </div>
            <c.Icon className="w-8 h-8 text-[#0078D4] shrink-0" stroke={1.5} />
          </div>
        ))}
      </div>

      {/* ─── Fila 1: Panel What-If (Grid 1/2 Variables + 1/2 Resultados) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Columna Izquierda: Variables del Escenario */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconDeviceDesktopAnalytics className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
              <span>{t("leversTitle")}</span>
            </h3>
            {isBaseCostEdited && (
              <button
                onClick={() => {
                  setBaseCostUSD(data?.baseCostUSD ?? 607.91);
                  setIsBaseCostEdited(false);
                }}
                className="text-[11px] font-semibold text-[#0054A6] hover:underline cursor-pointer"
              >
                {t("resetToActual")}
              </button>
            )}
          </div>

          {/* Input Costo Base */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <IconCurrencyDollar className="w-4 h-4 text-emerald-600" />
              <span>{t("baseMonthlySpend")}</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">$</span>
              <input
                type="number"
                min="0"
                step="10"
                value={baseCostUSD}
                onChange={(e) => {
                  setBaseCostUSD(Math.max(0, Number(e.target.value)));
                  setIsBaseCostEdited(true);
                }}
                className="w-full pl-7 pr-3 py-2 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
              />
            </div>
          </div>

          {/* Grupo 1: Crecimiento de Capacidad */}
          <div className="space-y-3 pt-2">
            <span className="text-xs font-bold text-[#0054A6] dark:text-white uppercase tracking-wider block">
              {t("sectionGrowth")}
            </span>

            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <IconCpu className="w-4 h-4 text-[#0078D4]" />
                    {t("leverCompute")}
                  </span>
                  <span className="font-bold text-[#0054A6]">
                    {computeGrowth > 0 ? `+${computeGrowth}%` : `${computeGrowth}%`}
                  </span>
                </div>
                <input
                  type="range"
                  min="-50"
                  max="200"
                  step="5"
                  value={computeGrowth}
                  onChange={(e) => setComputeGrowth(Number(e.target.value))}
                  className="w-full accent-[#0078D4] cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <IconServer2 className="w-4 h-4 text-amber-500" />
                    {t("leverStorage")}
                  </span>
                  <span className="font-bold text-[#0054A6]">
                    {storageGrowth > 0 ? `+${storageGrowth}%` : `${storageGrowth}%`}
                  </span>
                </div>
                <input
                  type="range"
                  min="-50"
                  max="200"
                  step="5"
                  value={storageGrowth}
                  onChange={(e) => setStorageGrowth(Number(e.target.value))}
                  className="w-full accent-[#0078D4] cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <IconWorld className="w-4 h-4 text-emerald-500" />
                    {t("leverEgress")}
                  </span>
                  <span className="font-bold text-[#0054A6]">+{networkGrowth}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="300"
                  step="10"
                  value={networkGrowth}
                  onChange={(e) => setNetworkGrowth(Number(e.target.value))}
                  className="w-full accent-[#0078D4] cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Grupo 2: Palancas de Ahorro y Eficiencia */}
          <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs font-bold text-[#0054A6] dark:text-white uppercase tracking-wider block">
              {t("sectionLevers")}
            </span>

            <div className="space-y-3">
              {/* RIs / Savings Plans */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <IconPigMoney className="w-4 h-4 text-[#0078D4]" />
                    {t("leverCommitmentCoverage")}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCommitmentTerm(commitmentTerm === "1Year" ? "3Years" : "1Year")}
                      className="px-2 py-0.5 text-[10px] font-bold rounded-md border border-[#0054A6] bg-white dark:bg-slate-800 text-[#0054A6] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                    >
                      {commitmentTerm === "3Years" ? t("termThreeYears") : t("termOneYear")}
                    </button>
                    <span className="font-bold text-[#0054A6]">{commitmentCoverage}%</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={commitmentCoverage}
                  onChange={(e) => setCommitmentCoverage(Number(e.target.value))}
                  className="w-full accent-[#0078D4] cursor-pointer"
                />
              </div>

              {/* Spot Mix */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <IconBolt className="w-4 h-4 text-orange-500" />
                    {t("spotMixLabel")}
                  </span>
                  <span className="font-bold text-[#0054A6]">{spotMix}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={spotMix}
                  onChange={(e) => setSpotMix(Number(e.target.value))}
                  className="w-full accent-[#0078D4] cursor-pointer"
                />
              </div>

              {/* Off-Hours */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <IconClockPause className="w-4 h-4 text-purple-500" />
                    {t("leverOffHours")}
                  </span>
                  <span className="font-bold text-[#0054A6]">{offHoursShutdown}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={offHoursShutdown}
                  onChange={(e) => setOffHoursShutdown(Number(e.target.value))}
                  className="w-full accent-[#0078D4] cursor-pointer"
                />
              </div>

              {/* Toggles AHB & ARM64 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 cursor-pointer">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 flex items-center gap-1">
                      <IconShieldCheck className="w-4 h-4 text-[#0078D4]" />
                      Azure Hybrid Benefit
                    </span>
                    <span className="text-[10px] text-slate-500">Windows/SQL Server</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={enableAhb}
                    onChange={(e) => setEnableAhb(e.target.checked)}
                    className="w-4 h-4 text-[#0054A6] rounded focus:ring-0 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 cursor-pointer">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 flex items-center gap-1">
                      <IconSparkles className="w-4 h-4 text-[#0078D4]" />
                      {t("leverArm64")}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">{t("leverArm64Sub")}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={enableArm64}
                    onChange={(e) => setEnableArm64(e.target.checked)}
                    className="w-4 h-4 text-[#0054A6] rounded focus:ring-0 cursor-pointer"
                  />
                </label>
              </div>
            </div>
          </div>

          <button
            onClick={() => setIsSaveModalOpen(true)}
            className="w-full py-3 px-4 text-xs font-bold rounded-xl border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
          >
            <IconBookmark className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
            <span>{t("saveThisScenario")}</span>
          </button>
        </div>

        {/* Columna Derecha: Visualizador Waterfall en Tiempo Real */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                <span>{t("waterfallTitle")}</span>
                <InfoTooltip content={t("waterfallTooltip")} />
              </h3>
              <span className="text-xs font-mono font-bold text-[#0054A6]">
                {money(activeResult.netProjectedCostUSD)}
              </span>
            </div>

            {/* Gráfica Waterfall (Bar Chart) */}
            <div className="h-[280px] w-full p-2 bg-slate-50/50 dark:bg-slate-800/30 rounded-xl border border-slate-200 dark:border-slate-800">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pasosTraducidos} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94A3B8" opacity={0.2} />
                  <XAxis
                    dataKey="stepLabel"
                    tick={{ fontSize: 10, fill: "#64748B" }}
                    angle={-20}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "#64748B" }} tickFormatter={(v) => `$${v}`} />
                  <Bar dataKey="amountUSD" radius={[4, 4, 0, 0]}>
                    {activeResult.waterfallSteps.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Resumen de Impacto Financiero */}
          <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/40 dark:bg-slate-800/40 space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-600 dark:text-slate-300 font-semibold">{t("grossProjected")}</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                {money(activeResult.grossProjectedCostUSD)}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-600 dark:text-slate-300 font-semibold">{t("leverDeductions")}</span>
              <span className="font-mono font-bold text-emerald-600">
                -{money(activeResult.totalSavingsUSD)}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs pt-2 border-t border-blue-200 dark:border-slate-700">
              <span className="text-slate-800 dark:text-slate-100 font-bold">{t("netMonthlyCost")}</span>
              <span className="font-mono font-extrabold text-base text-[#0054A6] dark:text-sky-400">
                {money(activeResult.netProjectedCostUSD)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Fila 2: Tabla "Escenarios Guardados" ─── */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
          <div>
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
              <span>{t("savedLibrary")}</span>
              <InfoTooltip content={t("compareTooltip")} />
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {t("scenariosAvailable", { count: savedScenariosList.length })}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {selectedScenarioIds.length >= 2 && (
              <button
                onClick={() => setIsComparisonModalOpen(true)}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-[#0054A6] text-white hover:bg-[#004080] transition flex items-center gap-1.5 cursor-pointer shadow-xs animate-bounce"
              >
                <IconArrowsExchange className="w-4 h-4" />
                <span>Comparar ({selectedScenarioIds.length})</span>
              </button>
            )}
            <button
              onClick={() => setIsSaveModalOpen(true)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition flex items-center gap-1 cursor-pointer shadow-xs"
            >
              <IconBookmark className="w-3.5 h-3.5 text-[#0078D4]" />
              <span>{t("saveCurrent")}</span>
            </button>
          </div>
        </div>

        {/* Tabla */}
        <div className={`border border-slate-200 dark:border-slate-800 rounded-xl ${VISIBLE_SCROLLBAR}`}>
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                <th className="p-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={
                      savedScenariosList.length > 0 &&
                      selectedScenarioIds.length === savedScenariosList.length
                    }
                    onChange={(e) => {
                      if (e.target.checked) setSelectedScenarioIds(savedScenariosList.map((s) => s.id));
                      else setSelectedScenarioIds([]);
                    }}
                    className="rounded text-[#0054A6] cursor-pointer"
                  />
                </th>
                <th className="p-3 font-bold">{t("scenarioName")}</th>
                <th className="p-3 font-bold">{t("colBaseCost")}</th>
                <th className="p-3 font-bold">{t("colProjectedCost")}</th>
                <th className="p-3 font-bold">{t("colNetChange")}</th>
                <th className="p-3 font-bold">{t("colKeyParams")}</th>
                <th className="p-3 font-bold">{t("colDate")}</th>
                <th className="p-3 font-bold text-right">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-xs text-slate-400">
                    {t("noScenarios")}
                  </td>
                </tr>
              ) : (
                paged.map((scen) => (
                  <tr
                    key={scen.id}
                    className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition text-slate-700 dark:text-slate-300"
                  >
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={selectedScenarioIds.includes(scen.id)}
                        onChange={() => toggleSelectScenario(scen.id)}
                        className="rounded text-[#0054A6] cursor-pointer"
                      />
                    </td>
                    <td className="p-3 font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                      <IconBookmark className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />
                      <span className="truncate max-w-[200px]" title={scen.nameKey ? t(scen.nameKey) : scen.name}>
                        {scen.nameKey ? t(scen.nameKey) : scen.name}
                      </span>
                    </td>
                    <td className="p-3 font-mono font-semibold">{money(scen.baseCostUSD)}</td>
                    <td className="p-3 font-mono font-bold text-[#0054A6] dark:text-sky-400">
                      {money(scen.projectedCostUSD)}
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                          scen.deltaPercentage <= 0
                            ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                            : "bg-blue-50 text-[#0054A6] border border-blue-200"
                        }`}
                      >
                        {scen.deltaPercentage > 0 ? `+${scen.deltaPercentage}%` : `${scen.deltaPercentage}%`}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        {scen.parameters.commitmentCoveragePercentage > 0 && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200">
                            RIs {scen.parameters.commitmentTerm === "3Years" ? "3Y" : "1Y"} (
                            {scen.parameters.commitmentCoveragePercentage}%)
                          </span>
                        )}
                        {scen.parameters.enableAhbLicensing && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-blue-50 text-[#0054A6] border border-blue-200">
                            AHB
                          </span>
                        )}
                        {scen.parameters.spotMixPercentage > 0 && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-orange-50 text-orange-600 border border-orange-200">
                            Spot ({scen.parameters.spotMixPercentage}%)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-[11px] text-slate-400">
                      {scen.createdAt ? scen.createdAt.split("T")[0] : t("recent")}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleLoadScenario(scen)}
                          className="px-2 py-1 text-[11px] font-semibold rounded-md border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition cursor-pointer"
                          title={t("loadInSimulator")}
                        >
                          {t("load")}
                        </button>
                        <button
                          onClick={() => handleDeleteScenario(scen.id)}
                          className="p-1 rounded-md border border-slate-200 text-slate-400 hover:text-red-500 transition cursor-pointer"
                          title={t("deleteScenario")}
                        >
                          <IconTrash className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        <div className="pt-2">
          <Pagination
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            total={total}
            setPage={setPage}
            setPageSize={setPageSize}
            pageSizes={[15, 30, 45, 60]}
          />
        </div>
      </div>

      {/* ─── Modales ─── */}
      <SaveScenarioModal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        onSave={handleSaveScenario}
        defaultName={t("defaultScenarioName", {
          date: new Date().toLocaleDateString(locale),
        })}
      />

      <ScenarioComparisonModal
        scenarios={selectedScenariosForComparison}
        onClose={() => setIsComparisonModalOpen(false)}
      />
    </div>
  );
}
