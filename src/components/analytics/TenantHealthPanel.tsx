"use client";
import { useTranslations } from "next-intl";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import type { IPublicClientApplication, AccountInfo } from "@azure/msal-browser";
import {
  IconHeartRateMonitor,
  IconPigMoney,
  IconSparkles,
  IconShieldLock,
  IconHeartbeat,
  IconActivity,
  IconRotateClockwise,
  IconDatabaseExport,
  IconCheck,
  IconAlertTriangle,
  IconKey,
  IconX,
  IconTerminal2,
  IconCopy,
  IconChevronRight,
  IconArrowUpRight,
  IconInfoCircle,
} from "@tabler/icons-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import {
  type HealthGrade,
  type HealthSignalItem,
  type TenantHealthActionPlan,
  type TenantHealthPayload,
  GRADE_THRESHOLDS,
} from "@/types/azureTenantHealth.types";

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

// ─── Modal de Ejecución / Remediación de Salud ───
interface RemediationModalProps {
  action: TenantHealthActionPlan | null;
  onClose: () => void;
}

function HealthRemediationModal({ action, onClose }: RemediationModalProps) {
  const t = useTranslations("TenantHealth");
  const [copied, setCopied] = useState(false);

  if (!action) return null;

  const handleCopy = () => {
    if (!action.commandPayload) return;
    navigator.clipboard.writeText(action.commandPayload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs animate-fadeIn">
      <div className="relative z-[100] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <IconSparkles className="w-6 h-6 text-[#0078D4] shrink-0" stroke={1.5} />
            <div>
              <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">{action.title}</h3>
              <p className="text-xs text-slate-500">Pilar: <span className="font-semibold text-[#0054A6]">{action.pillar}</span></p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer shadow-xs transition"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/30 dark:bg-slate-800/30">
            <span className="block text-[11px] font-medium text-slate-500">{t("healthGain")}</span>
            <span className="text-lg font-extrabold text-[#0054A6]">{t("scorePoints", { points: action.healthPointsGain })}</span>
          </div>
          {action.estimatedSavingsUSD > 0 ? (
            <div className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-slate-800/30">
              <span className="block text-[11px] font-medium text-slate-500">{t("estimatedSavings")}</span>
              <span className="text-lg font-extrabold text-emerald-600">+{money(action.estimatedSavingsUSD)}/mes</span>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
              <span className="block text-[11px] font-medium text-slate-500">Prioridad</span>
              <span className="text-sm font-extrabold text-[#1B2A41] dark:text-slate-100">{action.priority}</span>
            </div>
          )}
        </div>

        {action.commandPayload && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200 flex items-center gap-1.5">
                <IconTerminal2 className="w-4 h-4 text-[#0078D4]" />
                {t("cliGuide")}
              </span>
              <button
                onClick={handleCopy}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-emerald-600 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition flex items-center gap-1 cursor-pointer shadow-xs"
              >
                {copied ? <IconCheck className="w-3.5 h-3.5" /> : <IconCopy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copiado" : "Copiar Comando"}</span>
              </button>
            </div>
            <pre className="p-3 text-[11px] font-mono rounded-xl bg-slate-900 text-slate-100 overflow-x-auto whitespace-pre-wrap leading-relaxed border border-slate-800">
              {action.commandPayload}
            </pre>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition cursor-pointer shadow-xs"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Simulación de Score ───
function ScoreSimulatorModal({
  isOpen,
  onClose,
  currentScore,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentScore: number;
}) {
  const t = useTranslations("TenantHealth");
  const [simMfa, setSimMfa] = useState(true);
  const [simBudget, setSimBudget] = useState(true);
  const [simCoin, setSimCoin] = useState(true);

  const simulatedGain = (simMfa ? 20 : 0) + (simBudget ? 9 : 0) + (simCoin ? 21 : 0);
  const simulatedScore = Math.min(100, currentScore + simulatedGain);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs animate-fadeIn">
      <div className="relative z-[100] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <IconSparkles className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
            <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">
              {t("simTitle")}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
            <IconX className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-between p-4 rounded-2xl bg-blue-50/50 dark:bg-slate-800/40 border border-blue-200 dark:border-blue-800">
          <div>
            <span className="text-xs text-slate-500 font-semibold block">Score Actual vs Simulado</span>
            <span className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {currentScore} <span className="text-xs text-slate-400">/ 100</span> →{" "}
              <span className="text-[#0054A6]">{simulatedScore}</span> <span className="text-xs text-[#0054A6]">/ 100</span>
            </span>
          </div>
          <span className="px-3 py-1 text-xs font-extrabold rounded-lg bg-[#0054A6] text-white">
            {simulatedScore >= 90 ? "Grado A" : simulatedScore >= 80 ? "Grado B" : "Grado C"}
          </span>
        </div>

        <div className="space-y-3">
          <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 block">{t("enableMfaAdmins")}</span>
              <span className="text-[11px] text-slate-500">{t("simSecurity")}</span>
            </div>
            <input
              type="checkbox"
              checked={simMfa}
              onChange={(e) => setSimMfa(e.target.checked)}
              className="w-4 h-4 text-[#0054A6] rounded focus:ring-0 cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 block">Configurar Presupuesto Mensual (+9 pts)</span>
              <span className="text-[11px] text-slate-500">{t("simBudget")}</span>
            </div>
            <input
              type="checkbox"
              checked={simBudget}
              onChange={(e) => setSimBudget(e.target.checked)}
              className="w-4 h-4 text-[#0054A6] rounded focus:ring-0 cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 block">Implementar Top Recomendaciones COIN (+21 pts)</span>
              <span className="text-[11px] text-slate-500">{t("simOptimization")}</span>
            </div>
            <input
              type="checkbox"
              checked={simCoin}
              onChange={(e) => setSimCoin(e.target.checked)}
              className="w-4 h-4 text-[#0054A6] rounded focus:ring-0 cursor-pointer"
            />
          </label>
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 hover:bg-blue-50/50 transition cursor-pointer shadow-xs"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function TenantHealthPanel() {
  const t = useTranslations("TenantHealth");
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
  const canFetch = Boolean(tenantId && tenantId !== "default" && (accounts.length > 0 || isMock));
  const apiUrl = canFetch ? `/api/analytics/tenant-health?tenantId=${encodeURIComponent(tenantId)}` : null;
  const { data, error, isValidating, mutate } = useSWR<TenantHealthPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  const [selectedActionForModal, setSelectedActionForModal] = useState<TenantHealthActionPlan | null>(null);
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);

  const summary = data?.summary;
  const overallScore = summary?.overallScore ?? (data ? 100 : 0);
  const grade = summary?.grade ?? (data ? "A" : "—");
  const signals = useMemo(() => summary?.signals || [], [summary]);
  const actionPlan = useMemo(() => summary?.actionPlan || [], [summary]);
  const trend = useMemo(() => summary?.historicalTrend || [], [summary]);

  const { paged, page, totalPages, pageSize, setPage, setPageSize, total } = usePagination(actionPlan, 15);

  const handleExportCSV = () => {
    if (actionPlan.length === 0) return;
    const headers = ["ID", "Accion", "Pilar", "Puntos Ganados", "Ahorro Estimado USD", "Prioridad"];
    const rows = actionPlan.map((a) => [
      a.id,
      `"${a.title}"`,
      a.pillar,
      a.healthPointsGain,
      a.estimatedSavingsUSD.toFixed(2),
      a.priority,
    ]);
    const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `tenant-health-actions-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getSignalIcon = (type: string) => {
    switch (type) {
      case "BUDGET_COMPLIANCE":
        return IconPigMoney;
      case "CREDENTIAL_EXPIRY":
        return IconKey;
      case "COIN_OPTIMIZATION":
        return IconSparkles;
      case "SECURITY_MFA":
        return IconShieldLock;
      default:
        return IconActivity;
    }
  };

  const CustomTrendTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const point = payload[0].payload;
      return (
        <div className="bg-[#1B2A41] text-white p-3 rounded-xl shadow-2xl border border-slate-700 text-xs space-y-1 z-[9999]">
          <p className="font-bold text-slate-200">Fecha: {label}</p>
          <p className="font-mono text-emerald-400">Score de Salud: {point.overallScore} / 100</p>
          <p className="font-semibold text-sky-300">Grado Asignado: Grado {point.grade}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado ─── */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconHeartRateMonitor className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>{t("pageTitle")}</span>
              <InfoTooltip
                content={t("pageTooltip")}
                position="bottom"
                align="left"
              />
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Live Governance APIs" : "Demo Sandbox"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t("pageSubtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <IconDatabaseExport className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
            <span>Exportar Plan CSV</span>
          </button>
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 hover:bg-blue-50/50 transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
          >
            <IconRotateClockwise className={`w-4 h-4 text-[#0078D4] ${isValidating ? "animate-spin" : ""}`} stroke={1.5} />
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
            label: "Salud General del Tenant",
            tip: "Score global ponderado (0-100) y grado asignado.",
            value: `${overallScore} / 100`,
            sub: `Grado ${grade} (${GRADE_THRESHOLDS.find((g) => g.grade === grade)?.label.split("—")[1]?.trim() || "Aceptable"})`,
            Icon: IconHeartRateMonitor,
            warn: overallScore < 70,
          },
          {
            label: "Presupuesto Mensual",
            tip: "Estado del presupuesto mensual y porcentaje consumido.",
            value: signals.find((s) => s.signalType === "BUDGET_COMPLIANCE")?.score === 100 ? "100% Control" : "Sin Presupuesto",
            sub: signals.find((s) => s.signalType === "BUDGET_COMPLIANCE")?.statusText || "Evaluando",
            Icon: IconPigMoney,
            warn: (signals.find((s) => s.signalType === "BUDGET_COMPLIANCE")?.score ?? 0) < 80,
          },
          {
            label: "Adopción FinOps (COIN)",
            tip: "Porcentaje de recomendaciones implementadas en los últimos 90 días.",
            value: `${signals.find((s) => s.signalType === "COIN_OPTIMIZATION")?.score || 0}%`,
            sub: `${signals.find((s) => s.signalType === "COIN_OPTIMIZATION")?.detailsCount?.total ?? 0} oportunidades activas`,
            Icon: IconSparkles,
            warn: (signals.find((s) => s.signalType === "COIN_OPTIMIZATION")?.score || 0) < 50,
          },
          {
            label: "MFA en Cuentas Privilegiadas",
            tip: "Proporción de administradores con autenticación multifactor activa.",
            value: `${signals.find((s) => s.signalType === "SECURITY_MFA")?.detailsCount?.current ?? 0} / ${signals.find((s) => s.signalType === "SECURITY_MFA")?.detailsCount?.total ?? 0} Admins`,
            sub: signals.find((s) => s.signalType === "SECURITY_MFA")?.statusText || "Seguridad",
            Icon: IconShieldLock,
            warn: (signals.find((s) => s.signalType === "SECURITY_MFA")?.score || 0) < 100,
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
                className="text-2xl font-extrabold truncate text-[#1B2A41] dark:text-slate-100"
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

      {/* ─── Fila 1: Score Principal & 4 Señales de Salud ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Panel Izquierdo: Score Principal */}
        <div className="col-span-1 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <IconHeartbeat className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
                <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">{t("globalHealthScore")}</h3>
              </div>
              <span
                className={`px-3 py-1 text-xs font-extrabold rounded-xl border ${
                  grade === "A"
                    ? "border-emerald-500 text-emerald-600 bg-white dark:bg-slate-900"
                    : grade === "B"
                      ? "border-[#0054A6] text-[#0054A6] bg-white dark:bg-slate-900"
                      : grade === "C"
                        ? "border-[#00AEEF] text-[#0054A6] bg-white dark:bg-slate-900"
                        : "border-slate-300 dark:border-slate-700 text-[#1B2A41] dark:text-slate-200 bg-white dark:bg-slate-900"
                }`}
              >
                Grado {grade}
              </span>
            </div>

            <div className="py-3 text-center space-y-1">
              <div className="text-5xl font-black text-[#1B2A41] dark:text-slate-100 tracking-tight">
                {overallScore}
                <span className="text-lg font-bold text-slate-400"> / 100</span>
              </div>
              <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                {t("compositeScore")}
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsSimulatorOpen(true)}
            className="w-full py-2.5 px-4 text-xs font-semibold rounded-xl border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
          >
            <IconSparkles className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
            <span>{t("simulateImprovement")}</span>
          </button>
        </div>

        {/* Panel Derecho: Detalle de las 4 Señales */}
        <div className="col-span-1 lg:col-span-2 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
              <span>{t("signalsTitle")}</span>
              <InfoTooltip content={t("signalsTooltip")} />
            </h3>
            <span className="text-xs text-slate-400">Total: 100%</span>
          </div>

          <div className="space-y-4">
            {signals.map((signal) => {
              const SignalIcon = getSignalIcon(signal.signalType);
              return (
                <div
                  key={signal.signalType}
                  className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 space-y-2.5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <SignalIcon className="w-5 h-5 text-[#0078D4] shrink-0" stroke={1.5} />
                      <div>
                        <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-100">
                          {signal.displayName}
                        </span>
                        <span className="text-[11px] text-slate-400 ml-2">
                          (peso {signal.weightPercentage}%)
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-xs font-extrabold text-[#1B2A41] dark:text-slate-100">
                        {signal.score} / 100
                      </span>
                      {signal.actionRequiredTitle && (
                        <button
                          onClick={() => {
                            const found = actionPlan.find((a) => a.actionType === signal.actionType);
                            if (found) setSelectedActionForModal(found);
                            else
                              setSelectedActionForModal({
                                id: `act-${signal.signalType}`,
                                title: signal.actionRequiredTitle || "Acción Requerida",
                                pillar: signal.signalType === "BUDGET_COMPLIANCE" ? "Budget" : "Security",
                                healthPointsGain: 15,
                                estimatedSavingsUSD: 0,
                                priority: "HIGH",
                                actionType: signal.actionType || "FIX",
                                commandPayload: signal.commandPayload,
                              });
                          }}
                          className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition flex items-center gap-1 cursor-pointer shadow-xs"
                        >
                          <IconSparkles className="w-3 h-3 text-[#0078D4]" />
                          <span>{signal.actionRequiredTitle}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Barra de progreso */}
                  <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        signal.score >= 90
                          ? "bg-[#0078D4]"
                          : signal.score >= 70
                            ? "bg-[#2563EB]"
                            : signal.score >= 50
                              ? "bg-[#0284C7]"
                              : "bg-slate-400"
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, signal.score))}%` }}
                    />
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{signal.statusText}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ─── Fila 2: Evolución Histórica de Salud ─── */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
            <span>{t("historyTitle")}</span>
            <InfoTooltip content={t("historyTooltip")} />
          </h3>
          <span className="text-xs text-slate-500">Tendencia mensual</span>
        </div>

        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="healthGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0078D4" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#0078D4" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94A3B8" opacity={0.2} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#64748B" }}
                tickFormatter={(val) => val.split("-").slice(1).join("/")}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: "#64748B" }}
                tickFormatter={(val) => `${val}`}
              />
              <Tooltip content={<CustomTrendTooltip />} />
              <Area
                type="monotone"
                dataKey="overallScore"
                stroke="#0078D4"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#healthGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ─── Fila 3: Plan de Acción Priorizado ─── */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
              <span>{t("planTitle")}</span>
              <InfoTooltip content={t("planTooltip")} />
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {t("planSubtitle")}
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-blue-200 dark:border-blue-800 text-[#0054A6] bg-white dark:bg-slate-900">
            {actionPlan.length} Acciones Sugeridas
          </span>
        </div>

        <div className={`space-y-3 ${VISIBLE_SCROLLBAR}`}>
          {paged.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              <IconCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2" stroke={1.5} />
              {t("noPendingActions")}
            </div>
          ) : (
            paged.map((action) => (
              <div
                key={action.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs hover:border-blue-300 transition"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-100">
                      {action.title}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-700 text-slate-500 bg-white dark:bg-slate-900">
                      Pilar: {action.pillar}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 text-[#0054A6] bg-white dark:bg-slate-900">
                      +{action.healthPointsGain} Pts Salud
                    </span>
                  </div>
                  {action.estimatedSavingsUSD > 0 && (
                    <span className="text-xs font-semibold text-emerald-600">
                      {t("estSavingsValue", { amount: money(action.estimatedSavingsUSD) })}
                    </span>
                  )}
                </div>

                <button
                  onClick={() => setSelectedActionForModal(action)}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0 self-end sm:self-auto"
                >
                  <IconSparkles className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
                  <span>{t("runRemediation")}</span>
                </button>
              </div>
            ))
          )}
        </div>

        {/* Paginación */}
        <div className="pt-2">
          <Pagination page={page} totalPages={totalPages} pageSize={pageSize} total={total} setPage={setPage} setPageSize={setPageSize} pageSizes={[15, 30, 45, 60]} />
        </div>
      </div>

      {/* ─── Modales ─── */}
      <HealthRemediationModal
        action={selectedActionForModal}
        onClose={() => setSelectedActionForModal(null)}
      />

      <ScoreSimulatorModal
        isOpen={isSimulatorOpen}
        onClose={() => setIsSimulatorOpen(false)}
        currentScore={overallScore}
      />
    </div>
  );
}
