"use client";
import { useTranslations } from "next-intl";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useSearchParams } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import {
  IconContract,
  IconReceipt2,
  IconCash,
  IconTrendingUp,
  IconBuildingBank,
  IconCoins,
  IconCalendarDue,
  IconFlame,
  IconChartLine,
  IconSparkles,
  IconRotateClockwise,
  IconAlertTriangle,
  IconCheck,
  IconX,
  IconChevronRight,
  IconArrowUpRight,
  IconShieldCheck,
  IconInfoCircle,
} from "@tabler/icons-react";
import {
  MaccContractStatus,
  MaccBillingAccountItem,
  MaccSubscriptionBreakdownItem,
  MaccTrackingPayload,
  MaccSimulationResult,
} from "@/types/azureMaccTracking.types";

const VISIBLE_SCROLLBAR =
  "scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800";

// `t` entra por parametro: buildFetcher no es un componente ni un hook y no
// puede llamar a useTranslations.
function buildFetcher(instance: any, accounts: any[], isMock: boolean, t: (k: string) => string) {
  return async (url: string) => {
    if (isMock) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(t("loadError"));
      return res.json();
    }
    const token = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  };
}

function money(amount: number, compact = false): string {
  if (compact) {
    if (Math.abs(amount) >= 1000000) {
      return `$${(amount / 1000000).toFixed(2)}M`;
    }
    if (Math.abs(amount) >= 1000) {
      return `$${(amount / 1000).toFixed(0)}K`;
    }
  }
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

function getStatusBadge(status: MaccContractStatus) {
  switch (status) {
    case "EARLY_COMPLETION":
      return {
        label: "Ritmo Acelerado · Cumplimiento Anticipado",
        className: "border-emerald-500 text-emerald-600 bg-white dark:bg-slate-900",
      };
    case "ON_TRACK":
      return {
        label: "En Ritmo (On Track)",
        className: "border-[#0054A6] text-[#0054A6] bg-white dark:bg-slate-900",
      };
    case "UNDER_BURN_RISK":
      return {
        label: "Riesgo de Sub-consumo (Under-burn)",
        className: "border-amber-400 text-amber-600 bg-white dark:bg-slate-900",
      };
    default:
      return {
        label: "Evaluando",
        className: "border-slate-300 text-slate-600 bg-white dark:bg-slate-900",
      };
  }
}

// ─── Drawer Lateral de Simulación Contractual MACC ───
interface SimulationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  account: MaccBillingAccountItem | null;
  tenantId: string;
}

function MaccSimulationDrawer({ isOpen, onClose, account, tenantId }: SimulationDrawerProps) {
  const t = useTranslations("MaccTracking");
  const { instance, accounts } = useMsal();
  const [increasePercentage, setIncreasePercentage] = useState<number>(20);
  const [simulationResult, setSimulationResult] = useState<MaccSimulationResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  React.useEffect(() => {
    if (!account) return;

    const runSimulation = async () => {
      setLoading(true);
      try {
        const isMock = isMockTenant(tenantId);
        const token = isMock ? "demo" : await getFreshIdToken(instance, accounts[0], ["User.Read"]);

        const res = await fetch(`/api/analytics/macc?tenantId=${encodeURIComponent(tenantId)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            commitmentAmountUSD: account.commitmentAmountUSD,
            consumedAmountUSD: account.consumedAmountUSD,
            monthlyBurnRateUSD: account.monthlyBurnRateUSD,
            increasePercentage,
          }),
        });

        const data = await res.json();
        if (data.simulation) {
          setSimulationResult(data.simulation);
        }
      } catch (err) {
        console.error("Error en simulación MACC:", err);
      } finally {
        setLoading(false);
      }
    };

    runSimulation();
  }, [account, increasePercentage, tenantId, instance, accounts]);

  if (!isOpen || !account) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end">
      <div className="bg-white dark:bg-slate-900 max-w-lg w-full h-full p-6 shadow-2xl border-l border-slate-200 dark:border-slate-800 z-[100] overflow-y-auto space-y-6 flex flex-col justify-between">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-2">
              <IconSparkles className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <div>
                <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">
                  {t("simTitle")}
                </h3>
                <p className="text-xs text-slate-500">Cuenta {account.billingAccountId}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
              <IconX className="w-5 h-5" />
            </button>
          </div>

          {/* Estado Actual */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 space-y-2">
            <span className="text-xs font-bold text-slate-500 block">{t("commitVsProjection")}</span>
            <div className="flex items-center justify-between text-xs">
              <span>Compromiso Contratado:</span>
              <span className="font-bold text-[#1B2A41] dark:text-slate-100">
                {money(account.commitmentAmountUSD, true)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span>{t("accumulatedUsage")}</span>
              <span className="font-bold text-[#0054A6]">{money(account.consumedAmountUSD, true)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span>{t("expiryDate")}</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">{account.endDate}</span>
            </div>
          </div>

          {/* Selector de Incremento */}
          <div className="space-y-3">
            <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-200">
              {t("simModelLabel", { pct: increasePercentage })}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[20, 50, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setIncreasePercentage(pct)}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition cursor-pointer ${
                    increasePercentage === pct
                      ? "border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 shadow-xs"
                      : "border-slate-200 dark:border-slate-800 text-slate-500 bg-slate-50 dark:bg-slate-800/30"
                  }`}
                >
                  +{pct}% Banda
                </button>
              ))}
            </div>
          </div>

          {/* Resultados de Simulación */}
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <IconRotateClockwise className="w-4 h-4 animate-spin text-[#0078D4]" />
              <span>{t("recalculating")}</span>
            </div>
          ) : simulationResult ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20 space-y-3">
                <span className="text-xs font-bold text-[#0054A6] flex items-center gap-1">
                  <IconArrowUpRight className="w-4 h-4 text-[#0078D4]" />
                  Impacto Financiero Proyectado
                </span>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-300">Nuevo Compromiso Simulado:</span>
                    <span className="font-extrabold text-[#1B2A41] dark:text-slate-100">
                      {money(simulationResult.simulatedCommitmentUSD, true)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-300">{t("tierDiscount")}</span>
                    <span className="font-extrabold text-[#0054A6]">
                      {simulationResult.simulatedDiscountPercentage}% (vs {simulationResult.currentTierDiscountPercentage}% actual)
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-300">{t("fulfillmentDate")}</span>
                    <span className="font-bold text-emerald-600">
                      {simulationResult.estimatedCompletionDate}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-blue-100 dark:border-blue-900/50 flex items-center justify-between">
                    <span className="font-bold text-[#1B2A41] dark:text-slate-100">{t("extraAnnualSavings")}</span>
                    <span className="font-black text-emerald-600 text-sm">
                      {t("perYearPlus", { amount: money(simulationResult.additionalAnnualSavingsUSD) })}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 text-xs text-slate-500 leading-relaxed">
                <p>
                  {t("renegotiateNote1")}
                  {t("renegotiateNote2")}
                  Marketplace elegible.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 dark:border-slate-800 pt-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 hover:bg-blue-50/50 transition cursor-pointer shadow-xs"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function MaccTrackingPanel() {
  const t = useTranslations("MaccTracking");
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
  const apiUrl = `/api/analytics/macc?tenantId=${encodeURIComponent(tenantId)}`;
  const { data, error, isValidating, mutate } = useSWR<MaccTrackingPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  const [selectedAccountForSimulation, setSelectedAccountForSimulation] = useState<MaccBillingAccountItem | null>(null);

  const metrics = data?.metrics;
  const billingAccounts = useMemo(() => metrics?.billingAccounts || [], [metrics]);
  const subscriptionsBreakdown = useMemo(() => metrics?.subscriptionsBreakdown || [], [metrics]);
  const pacingTrend = useMemo(() => metrics?.pacingTrend || [], [metrics]);

  const { paged, page, totalPages, pageSize, setPage, setPageSize, total } = usePagination(subscriptionsBreakdown, 15);

  const statusBadge = getStatusBadge(metrics?.globalStatus || "ON_TRACK");

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado y Acciones ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconContract className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>MACC Tracking &amp; Compromisos Enterprise</span>
            </h1>
            <InfoTooltip content={t("pageTooltip")} />
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {isMock ? t("demoEnv") : t("liveProduction")}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t("pageSubtitle")}
          </p>
        </div>

        <button
          onClick={() => mutate()}
          disabled={isValidating}
          className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 hover:bg-blue-50/50 transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60 self-start md:self-auto"
          title="Recargar compromisos"
        >
          <IconRotateClockwise className={`w-4 h-4 text-[#0078D4] ${isValidating ? "animate-spin" : ""}`} stroke={1.5} />
          <span>{t("refreshData")}</span>
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 flex items-start gap-3">
          <IconAlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-red-700 dark:text-red-400">{String(error.message || error)}</p>
        </div>
      )}

      {/* ─── 4 KPI Cards Superiores ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Compromiso Total MACC",
            tip: "Monto global acumulado contratado en los acuerdos de facturación activos.",
            value: money(metrics?.totalCommitmentUSD ?? 0, true),
            sub: `${billingAccounts.length} Cuentas de Facturación Activas`,
            Icon: IconContract,
          },
          {
            label: "Consumo Acumulado",
            tip: "Gasto total elegible devengado a la fecha sobre los compromisos MACC.",
            value: money(metrics?.totalConsumedUSD ?? 0, true),
            sub: `${
              metrics?.totalCommitmentUSD && metrics.totalCommitmentUSD > 0
                ? Math.round((metrics.totalConsumedUSD / metrics.totalCommitmentUSD) * 100)
                : 0
            }% del total contratado`,
            Icon: IconReceipt2,
          },
          {
            label: "Saldo Restante",
            tip: "Monto pendiente de devengar antes de la fecha de vencimiento contractual.",
            value: money(metrics?.totalRemainingUSD ?? 0, true),
            sub: "Pendiente de consumo",
            Icon: IconCash,
          },
          {
            label: "Estado Global del Contrato",
            tip: "Evaluación del ritmo de consumo frente a la trayectoria teórica ideal.",
            value: statusBadge.label.split("·")[0].trim(),
            sub: "Evaluación de Pacing Velocity",
            Icon: IconTrendingUp,
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
              <div className="text-2xl font-extrabold truncate text-[#1B2A41] dark:text-slate-100" title={c.value}>
                {c.value}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{c.sub}</div>
            </div>
            <c.Icon className="w-8 h-8 text-[#0078D4] shrink-0" stroke={1.5} />
          </div>
        ))}
      </div>

      {/* ─── Fila 1: Gráfica de Ritmo de Consumo "Pacing Velocity & Burn-Up" ─── */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconChartLine className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
              <span>{t("pacingTitle")}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {t("pacingSub")}
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs font-semibold text-slate-500">
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-[#0078D4] inline-block" /> Real Acumulado
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 border-t border-dashed border-slate-400 inline-block" /> Objetivo Lineal
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 border-t border-dashed border-[#0284C7] inline-block" /> Forecast
            </span>
          </div>
        </div>

        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={pacingTrend} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94A3B8" opacity={0.2} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748B" }} />
              <YAxis
                tick={{ fontSize: 11, fill: "#64748B" }}
                tickFormatter={(val) => money(val, true)}
                domain={[0, (dataMax: number) => Math.max(dataMax, metrics?.totalCommitmentUSD || 1000000)]}
              />
              <Tooltip
                formatter={(value: any, name: any) => [
                  money(Number(value || 0)),
                  name === "actualSpendUSD"
                    ? "Real Acumulado"
                    : name === "linearTargetUSD"
                      ? "Objetivo Lineal"
                      : name === "forecastSpendUSD"
                        ? "Proyección Forecast"
                        : name,
                ]}
                labelFormatter={(label) => `Mes: ${label}`}
                contentStyle={{
                  backgroundColor: "#1B2A41",
                  border: "1px solid #334155",
                  borderRadius: "0.75rem",
                  color: "#FFFFFF",
                  fontSize: "12px",
                  boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
                }}
              />
              {metrics?.totalCommitmentUSD ? (
                <ReferenceLine
                  y={metrics.totalCommitmentUSD}
                  stroke="#2563EB"
                  strokeDasharray="4 4"
                  label={{
                    value: `Meta MACC: ${money(metrics.totalCommitmentUSD, true)}`,
                    fill: "#2563EB",
                    fontSize: 11,
                    position: "insideTopRight",
                  }}
                />
              ) : null}
              <Line
                type="monotone"
                dataKey="actualSpendUSD"
                name="actualSpendUSD"
                stroke="#0078D4"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#0078D4" }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="linearTargetUSD"
                name="linearTargetUSD"
                stroke="#94A3B8"
                strokeWidth={1.5}
                strokeDasharray="3 3"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="forecastSpendUSD"
                name="forecastSpendUSD"
                stroke="#0284C7"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={{ r: 3, fill: "#0284C7" }}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ─── Fila 2: Tarjetas de Cuentas de Facturación MACC (Estándar CMP) ─── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
            <IconBuildingBank className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <span>{t("accountsTitle")}</span>
          </h2>
          <span className="text-xs text-slate-400">{billingAccounts.length} Cuentas Registradas</span>
        </div>

        {billingAccounts.length === 0 ? (
          <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
            {t("noMaccContracts")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {billingAccounts.map((account) => {
              const bBadge = getStatusBadge(account.status);

              return (
                <div
                  key={account.id}
                  className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5"
                >
                  {/* Header de la Cuenta */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div className="flex items-center gap-3">
                      <IconBuildingBank className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
                      <div>
                        <div className="font-bold text-[#1B2A41] dark:text-slate-100 text-sm">
                          {account.displayName} ({account.billingAccountId})
                        </div>
                        <span className="text-xs text-slate-400">Tipo de Acuerdo: {account.agreementType}</span>
                      </div>
                    </div>

                    <span className={`px-3 py-1 text-xs font-extrabold rounded-xl border ${bBadge.className}`}>
                      {bBadge.label}
                    </span>
                  </div>

                  {/* Banner Informativo Sutil */}
                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2">
                    <IconInfoCircle className="w-4 h-4 text-[#0078D4] shrink-0 mt-0.5" />
                    <span>
                      {account.status === "EARLY_COMPLETION"
                        ? `La proyección actual (${money(
                            account.projectedFinalCostUSD,
                            true
                          )}) alcanzará el 100% antes del vencimiento (${account.endDate}). Se sugiere evaluar una ampliación de banda con Microsoft para desbloquear mayor descuento.`
                        : account.status === "UNDER_BURN_RISK"
                          ? `El ritmo actual proyecta un déficit respecto al compromiso contratado. Recomendamos auditar compras de Marketplace elegibles o acelerar migraciones programadas.`
                          : `El ritmo de consumo se encuentra alineado con la trayectoria contractual esperada.`}
                    </span>
                  </div>

                  {/* Grid de 6 Métricas Clave */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <div className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 space-y-1">
                      <span className="text-[11px] font-medium text-slate-500 block">Compromiso Total</span>
                      <span className="text-sm font-extrabold text-[#1B2A41] dark:text-slate-100">
                        {money(account.commitmentAmountUSD, true)}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 space-y-1">
                      <span className="text-[11px] font-medium text-slate-500 block">Consumido (Progreso)</span>
                      <span className="text-sm font-extrabold text-[#0054A6]">
                        {money(account.consumedAmountUSD, true)}{" "}
                        <span className="text-xs font-semibold text-slate-500">({account.progressPercentage}%)</span>
                      </span>
                    </div>

                    <div className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 space-y-1">
                      <span className="text-[11px] font-medium text-slate-500 block">Saldo Restante</span>
                      <span className="text-sm font-extrabold text-[#1B2A41] dark:text-slate-100">
                        {money(account.remainingAmountUSD, true)}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 space-y-1">
                      <span className="text-[11px] font-medium text-slate-500 block">{t("daysRemaining")}</span>
                      <span className="text-sm font-extrabold text-[#1B2A41] dark:text-slate-100">
                        {t("daysValue", { n: account.daysRemaining })}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 space-y-1">
                      <span className="text-[11px] font-medium text-slate-500 block">Burn Rate Mensual</span>
                      <span className="text-sm font-extrabold text-[#0054A6]">
                        {money(account.monthlyBurnRateUSD, true)}/mes
                      </span>
                    </div>

                    <div className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 space-y-1">
                      <span className="text-[11px] font-medium text-slate-500 block">{t("finalProjection")}</span>
                      <span className="text-sm font-extrabold text-emerald-600">
                        {money(account.projectedFinalCostUSD, true)}
                      </span>
                    </div>
                  </div>

                  {/* Barra de Progreso de Consumo */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>Inicio: {account.startDate}</span>
                      <span className="font-bold text-[#0054A6]">Progreso: {account.progressPercentage}%</span>
                      <span>Vencimiento: {account.endDate} ({money(account.commitmentAmountUSD, true)})</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-3 rounded-full overflow-hidden">
                      <div
                        className="bg-[#0078D4] h-full rounded-full transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, account.progressPercentage))}%` }}
                      />
                    </div>
                  </div>

                  {/* Botones de Acción */}
                  <div className="flex items-center justify-between gap-3 flex-wrap border-t border-slate-100 dark:border-slate-800 pt-3">
                    <div className="text-xs text-slate-500">
                      Desglose: {money(account.eligibleFirstPartySpendUSD, true)} 1st Party ·{" "}
                      {money(account.eligibleMarketplaceSpendUSD, true)} Marketplace Elegible
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSelectedAccountForSimulation(account)}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <IconSparkles className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
                        <span>Simular Nuevo Compromiso</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Fila 3: Tabla "Desglose de Suscripciones y Elegibilidad MACC" ─── */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconCoins className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
              {t("breakdownTitle")}
            </h2>
            <InfoTooltip content={t("tableTooltip")} />
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-blue-200 dark:border-blue-800 text-[#0054A6] bg-white dark:bg-slate-900">
            {subscriptionsBreakdown.length} Suscripciones Contribuyentes
          </span>
        </div>

        <div className={`overflow-x-auto ${VISIBLE_SCROLLBAR}`}>
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-800/30">
                <th className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 min-w-[200px]">{t("colSubscription")}</th>
                <th className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 min-w-[130px]">{t("colMaccAccount")}</th>
                <th className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 min-w-[140px]">{t("colFirstParty")}</th>
                <th className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 min-w-[150px]">{t("colMarketplaceEligible")}</th>
                <th className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 min-w-[130px]">{t("colIneligible")}</th>
                <th className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 min-w-[120px]">{t("colContribution")}</th>
                <th className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 text-right min-w-[140px]">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    {t("noContributingSubs")}
                  </td>
                </tr>
              ) : (
                paged.map((sub) => (
                  <tr key={sub.subscriptionId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4">
                      <div className="font-bold text-[#1B2A41] dark:text-slate-100">{sub.subscriptionName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{sub.subscriptionId}</div>
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-mono text-slate-600 dark:text-slate-300 font-semibold">
                        {sub.billingAccountId}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-100">
                      {money(sub.firstPartySpendUSD)}
                    </td>

                    <td className="py-3 px-4 font-bold text-[#0054A6]">
                      {money(sub.marketplaceEligibleSpendUSD)}
                    </td>

                    <td className="py-3 px-4 text-slate-400">{money(sub.ineligibleSpendUSD)}</td>

                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-[#1B2A41] dark:text-slate-100">{sub.contributionPercentage}%</span>
                        <div className="w-12 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-[#0078D4] h-full rounded-full"
                            style={{ width: `${Math.min(100, sub.contributionPercentage)}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() =>
                          alert(`Auditoría de software Marketplace elegible para ${sub.subscriptionName}`)
                        }
                        className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition inline-flex items-center gap-1 cursor-pointer shadow-xs"
                      >
                        <IconShieldCheck className="w-3.5 h-3.5 text-[#0078D4]" />
                        <span>Auditar</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación CMP */}
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

      {/* ─── Drawer Lateral de Simulación ─── */}
      <MaccSimulationDrawer
        isOpen={Boolean(selectedAccountForSimulation)}
        onClose={() => setSelectedAccountForSimulation(null)}
        account={selectedAccountForSimulation}
        tenantId={tenantId}
      />
    </div>
  );
}
