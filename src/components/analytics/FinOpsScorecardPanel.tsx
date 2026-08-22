"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import type { IPublicClientApplication, AccountInfo } from "@azure/msal-browser";
import {
  IconAward,
  IconTrophy,
  IconMedal,
  IconAlertTriangle,
  IconUsersGroup,
  IconSearch,
  IconDatabaseExport,
  IconRotateClockwise,
  IconChevronDown,
  IconChevronUp,
  IconCheck,
  IconSparkles,
  IconTag,
  IconTrash,
  IconDiscount2,
  IconPigMoney,
  IconCopy,
  IconX,
  IconTerminal2,
  IconInfoCircle,
} from "@tabler/icons-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import {
  PILLAR_LABELS,
  PILLAR_MAX_POINTS,
  type ScorecardPayload,
  type ScorecardPenaltyItem,
  type ScorecardPillar,
  type ScorecardRemediationAction,
  type TeamScorecardItem,
} from "@/types/azureScorecard.types";

const VISIBLE_SCROLLBAR =
  "overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 " +
  "scrollbar-track-slate-100 dark:scrollbar-track-slate-800 " +
  "[&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full " +
  "[&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 " +
  "[&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800";

const money = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(v);

const PILLAR_ICONS: Record<ScorecardPillar, React.ComponentType<{ className?: string; stroke?: number }>> = {
  Tags: IconTag,
  Zombies: IconTrash,
  Commitments: IconDiscount2,
  Budget: IconPigMoney,
};

function buildFetcher(instance: IPublicClientApplication, accounts: AccountInfo[], isMock: boolean) {
  return async (url: string) => {
    const headers: Record<string, string> = {};
    if (!isMock && accounts.length > 0) {
      try {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
      } catch {
        // Se deja propagar el 401; no hay mock de rescate.
      }
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Error al cargar el scorecard");
    }
    return res.json();
  };
}

/** Insignia de puesto. Nada de dorados: el podio va en la paleta azul corporativa. */
function RankBadge({ rank, inactive }: { rank: number; inactive: boolean }) {
  if (inactive) {
    return (
      <span className="text-[10px] font-bold px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-500 bg-white dark:bg-slate-900 whitespace-nowrap">
        Inactivo
      </span>
    );
  }
  if (rank === 1) return <IconTrophy className="w-6 h-6 text-[#0078D4]" stroke={1.5} />;
  if (rank === 2 || rank === 3) return <IconMedal className="w-6 h-6 text-[#2563EB]" stroke={1.5} />;
  return (
    <span className="text-xs font-extrabold px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900">
      #{rank}
    </span>
  );
}

function PillarPill({ pillar, score }: { pillar: ScorecardPillar; score: number }) {
  const max = PILLAR_MAX_POINTS[pillar];
  const full = score >= max - 0.05;
  const Icon = PILLAR_ICONS[pillar];
  return (
    <span
      title={PILLAR_LABELS[pillar]}
      className={`text-[10px] font-bold px-2 py-1 rounded-lg border bg-white dark:bg-slate-900 flex items-center gap-1 whitespace-nowrap shadow-xs ${
        full
          ? "border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300"
          : score >= max * 0.6
            ? "border-sky-300 dark:border-sky-700 text-[#0284C7] dark:text-sky-400"
            : "border-slate-300 dark:border-slate-700 text-slate-500"
      }`}
    >
      <Icon className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
      <span>{score}/{max}</span>
    </span>
  );
}

// ─── Modal de Remediación Resolutiva ───
interface RemediationModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  teamName: string;
  pillar?: ScorecardPillar;
  pointsLost?: number;
  financialImpactUSD?: number;
  commandPayload?: string;
  affectedResources?: string[];
  actionType: string;
}

function RemediationModal({
  isOpen,
  onClose,
  title,
  subtitle,
  teamName,
  pillar,
  pointsLost,
  financialImpactUSD = 0,
  commandPayload,
  affectedResources = [],
}: RemediationModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (!commandPayload) return;
    navigator.clipboard.writeText(commandPayload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs animate-fadeIn">
      <div className="relative z-[100] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <IconSparkles className="w-6 h-6 text-[#0078D4] shrink-0" stroke={1.5} />
            <div>
              <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">{title}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Equipo: <span className="font-semibold text-[#0054A6]">{teamName}</span></p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer shadow-xs transition"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>

        {/* Impact Cards */}
        <div className="grid grid-cols-2 gap-3">
          {pointsLost !== undefined && pointsLost > 0 && (
            <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-white dark:bg-slate-900">
              <span className="block text-[10px] font-medium text-slate-500 dark:text-slate-400">Puntos a Recuperar</span>
              <span className="text-sm font-extrabold text-rose-600 dark:text-rose-400">+{pointsLost} pts en Scorecard</span>
            </div>
          )}
          {financialImpactUSD > 0 && (
            <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-white dark:bg-slate-900">
              <span className="block text-[10px] font-medium text-slate-500 dark:text-slate-400">Ahorro / Impacto Mensual</span>
              <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">{money(financialImpactUSD)}/mes</span>
            </div>
          )}
        </div>

        {/* Description */}
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
          <p>{subtitle}</p>
        </div>

        {/* Affected Resources List */}
        {affectedResources.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
              <IconInfoCircle className="w-3.5 h-3.5 text-[#0078D4]" />
              Recursos Implicados ({affectedResources.length}):
            </span>
            <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              {affectedResources.map((res) => (
                <code key={res} className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  {res}
                </code>
              ))}
            </div>
          </div>
        )}

        {/* Command Payload / Script */}
        {commandPayload && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200 flex items-center gap-1.5">
                <IconTerminal2 className="w-4 h-4 text-[#0078D4]" />
                Comando Azure CLI Sugerido:
              </span>
              <button
                onClick={handleCopy}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-emerald-600 text-emerald-600 bg-white dark:bg-slate-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition flex items-center gap-1 cursor-pointer shadow-xs"
              >
                {copied ? <IconCheck className="w-3.5 h-3.5" /> : <IconCopy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copiado" : "Copiar Comando"}</span>
              </button>
            </div>
            <pre className="p-3 text-[11px] font-mono rounded-xl bg-slate-900 text-slate-100 overflow-x-auto whitespace-pre-wrap leading-relaxed border border-slate-800">
              {commandPayload}
            </pre>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer shadow-xs"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Fila de equipo con acordeón ───
function TeamRow({
  team,
  onRemediate,
}: {
  team: TeamScorecardItem;
  onRemediate: (team: TeamScorecardItem, penalty: ScorecardPenaltyItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const scoreColor =
    team.isInactive
      ? "text-slate-400"
      : team.overallScore >= 90
        ? "text-emerald-600 dark:text-emerald-400"
        : team.overallScore >= 75
          ? "text-[#0054A6] dark:text-blue-300"
          : "text-amber-600 dark:text-amber-400";

  return (
    <div
      className={`rounded-2xl bg-white dark:bg-slate-900 border shadow-xs transition ${
        team.rank === 1 && !team.isInactive
          ? "border-blue-300 dark:border-blue-800"
          : "border-slate-200 dark:border-slate-800"
      }`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full p-4 flex items-center gap-4 text-left cursor-pointer flex-wrap lg:flex-nowrap"
      >
        <div className="w-10 shrink-0 flex justify-center">
          <RankBadge rank={team.rank} inactive={team.isInactive} />
        </div>

        <div className="min-w-[180px] flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">{team.teamName}</span>
            {team.mergedAliases.length > 0 && (
              <span
                title={`Variantes fusionadas: ${team.mergedAliases.join(", ")}`}
                className="text-[10px] font-semibold px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-700 text-slate-500 bg-white dark:bg-slate-900"
              >
                +{team.mergedAliases.length} alias
              </span>
            )}
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {money(team.monthlySpendUSD)}/mes · {team.managedResourcesCount} recurso(s)
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <PillarPill pillar="Tags" score={team.tagHygieneScore} />
          <PillarPill pillar="Zombies" score={team.wasteScore} />
          <PillarPill pillar="Commitments" score={team.commitmentScore} />
          <PillarPill pillar="Budget" score={team.budgetDisciplineScore} />
        </div>

        <div className="flex items-center gap-3 shrink-0 ml-auto">
          <span className={`text-xl font-extrabold ${scoreColor}`}>
            {team.overallScore}
            <span className="text-xs font-semibold text-slate-400"> / 100</span>
          </span>
          {open ? (
            <IconChevronUp className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
          ) : (
            <IconChevronDown className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
          )}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2.5">
          {team.isInactive ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Este equipo no tiene gasto ni recursos gestionados. No compite en el ranking: un centro de costo
              vacío no puede quedar por encima de equipos activos solo por no tener nada que optimizar.
            </p>
          ) : team.penalties.length === 0 ? (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <IconCheck className="w-4 h-4 text-emerald-500" />
              Sin penalizaciones: los cuatro pilares están al máximo.
            </p>
          ) : (
            team.penalties.map((p) => {
              const Icon = PILLAR_ICONS[p.pillar];
              return (
                <div key={p.id} className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-2 min-w-0">
                      <Icon className="w-4 h-4 text-[#0078D4] shrink-0 mt-0.5" stroke={1.5} />
                      <div className="min-w-0">
                        <span className="block text-xs font-bold text-rose-600 dark:text-rose-400">
                          −{p.pointsDeducted} puntos · {PILLAR_LABELS[p.pillar]}
                        </span>
                        <span className="block text-[11px] text-slate-600 dark:text-slate-400">{p.reason}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {p.financialImpactUSD > 0 && (
                        <span className="text-[11px] font-bold text-[#1B2A41] dark:text-slate-100">
                          Impacto: {money(p.financialImpactUSD)}/mes
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemediate(team, p);
                        }}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] text-[#0054A6] bg-white dark:bg-slate-900 hover:bg-blue-50/50 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <IconSparkles className="w-3.5 h-3.5 text-[#0078D4]" />
                        <span>Remediar Penalización</span>
                      </button>
                    </div>
                  </div>
                  {p.affectedResourceNames.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.affectedResourceNames.map((n) => (
                        <code
                          key={n}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                        >
                          {n}
                        </code>
                      ))}
                      {p.affectedResourcesCount > p.affectedResourceNames.length && (
                        <span className="text-[10px] text-slate-400">
                          +{p.affectedResourcesCount - p.affectedResourceNames.length} más
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── Componente Principal ───
export default function FinOpsScorecardPanel() {
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

  const fetcher = useMemo(() => buildFetcher(instance, accounts, isMock), [instance, accounts, isMock]);
  const apiUrl = `/api/analytics/scorecard?tenantId=${encodeURIComponent(tenantId)}`;
  const { data, error, isValidating, mutate } = useSWR<ScorecardPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [range, setRange] = useState("ALL");
  const [sortBy, setSortBy] = useState<"rank" | "spend" | "penalty">("rank");

  // Estado del modal de remediación
  const [activeModalData, setActiveModalData] = useState<{
    isOpen: boolean;
    title: string;
    subtitle: string;
    teamName: string;
    pillar?: ScorecardPillar;
    pointsLost?: number;
    financialImpactUSD?: number;
    commandPayload?: string;
    affectedResources?: string[];
    actionType: string;
  }>({
    isOpen: false,
    title: "",
    subtitle: "",
    teamName: "",
    actionType: "",
  });

  const summary = data?.summary;
  const teams = useMemo(() => summary?.teams || [], [summary]);

  const filtered = useMemo(() => {
    const penaltyOf = (t: TeamScorecardItem) => t.penalties.reduce((a, p) => a + p.pointsDeducted, 0);
    return teams
      .filter((t) => {
        if (searchTerm && !t.teamName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
        if (range === "TOP" && t.overallScore < 90) return false;
        if (range === "MID" && (t.overallScore < 75 || t.overallScore >= 90)) return false;
        if (range === "LOW" && t.overallScore >= 75) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "spend") return b.monthlySpendUSD - a.monthlySpendUSD;
        if (sortBy === "penalty") return penaltyOf(b) - penaltyOf(a);
        return a.rank - b.rank;
      });
  }, [teams, searchTerm, range, sortBy]);

  const { paged, page, totalPages, pageSize, setPage, setPageSize, total } = usePagination(filtered, 15);

  const handleRemediatePenalty = (team: TeamScorecardItem, penalty: ScorecardPenaltyItem) => {
    setActiveModalData({
      isOpen: true,
      title: `Plan de Remediación — ${PILLAR_LABELS[penalty.pillar]}`,
      subtitle: penalty.reason,
      teamName: team.teamName,
      pillar: penalty.pillar,
      pointsLost: penalty.pointsDeducted,
      financialImpactUSD: penalty.financialImpactUSD,
      commandPayload: penalty.commandPayload,
      affectedResources: penalty.affectedResourceNames,
      actionType: penalty.remediationActionType,
    });
  };

  const handleRemediateRecommendation = (rec: ScorecardRemediationAction) => {
    const team = teams.find((t) => t.teamId === rec.teamId);
    setActiveModalData({
      isOpen: true,
      title: rec.title,
      subtitle: rec.description,
      teamName: team?.teamName || "Tenant Global",
      financialImpactUSD: rec.estimatedSavingsUSD,
      commandPayload: rec.commandPayload,
      actionType: rec.actionType,
    });
  };

  const handleExportCSV = () => {
    if (filtered.length === 0) return;
    const headers = ["Rank", "Team", "Merged Aliases", "Monthly Spend USD", "Resources", "Tags", "Waste", "Commitments", "Budget", "Overall", "Status"];
    const rows = filtered.map((t) => [
      t.rank,
      `"${t.teamName}"`,
      `"${t.mergedAliases.join(" | ")}"`,
      t.monthlySpendUSD.toFixed(2),
      t.managedResourcesCount,
      t.tagHygieneScore,
      t.wasteScore,
      t.commitmentScore,
      t.budgetDisciplineScore,
      t.overallScore,
      `"${t.status}"`,
    ]);
    const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `finops-scorecard-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado ─── */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconAward className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>Scorecard de Eficiencia FinOps</span>
              <InfoTooltip
                content="El scorecard solo sirve si los equipos están bien identificados. El mismo equipo suele aparecer como IA, ai y Artificial Intelligence según quién creó el recurso; sin normalizar eso el tablero mostraría equipos fantasma con scores parciales. Por eso el pipeline de alias corre antes del cálculo, y las variantes fusionadas quedan visibles en cada fila."
                position="bottom"
                align="left"
              />
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Live Resource Graph" : "Demo Sandbox"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Índice multi-pilar 0-100: higiene de tags, ausencia de desperdicio, cobertura de tarifas y disciplina
            presupuestaria
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <IconDatabaseExport className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
            <span>Exportar Tabla CSV</span>
          </button>
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
          >
            <IconRotateClockwise className={`w-4 h-4 text-[#0078D4] ${isValidating ? "animate-spin" : ""}`} stroke={1.5} />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 flex items-start gap-2">
          <IconAlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-red-700 dark:text-red-400">{String(error.message || error)}</p>
        </div>
      )}

      {/* ─── 4 KPI Cards ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Score Promedio del Tenant",
            tip: "Promedio ponderado POR GASTO: un equipo de $5 con score perfecto no debe compensar a uno de $5.000 con score malo.",
            value: `${summary?.tenantAvgScore ?? 0} / 100`,
            sub: `${summary?.activeTeamsCount ?? 0} equipo(s) activo(s)`,
            Icon: IconAward,
          },
          {
            label: "Equipo Líder",
            tip: "Equipo con mayor eficiencia entre los que tienen recursos activos. Los inactivos quedan excluidos del podio.",
            value: summary?.topPerformingTeam || "—",
            sub: summary ? `${summary.topPerformingScore} / 100` : "",
            Icon: IconTrophy,
            small: true,
          },
          {
            label: "Gasto en Riesgo",
            tip: "Impacto financiero acumulado de todas las penalizaciones: desperdicio, gasto sin atribuir y desvío presupuestario.",
            value: money(summary?.totalPenaltyWasteUSD || 0),
            sub: `${money(summary?.untaggedSpendUSD || 0)} sin dueño`,
            Icon: IconAlertTriangle,
            warn: (summary?.totalPenaltyWasteUSD || 0) > 0,
          },
          {
            label: "Equipos Evaluados",
            tip: "Centros de costo únicos tras fusionar las variantes de tag.",
            value: String(summary?.totalEvaluatedTeams || 0),
            sub: `${(summary?.totalEvaluatedTeams || 0) - (summary?.activeTeamsCount || 0)} inactivo(s)`,
            Icon: IconUsersGroup,
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
                className={`font-extrabold truncate ${c.small ? "text-lg" : "text-2xl"} ${
                  c.warn ? "text-amber-600 dark:text-amber-400" : "text-[#1B2A41] dark:text-slate-100"
                }`}
                title={c.value}
              >
                {c.value}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{c.sub}</div>
            </div>
            <c.Icon className="w-8 h-8 text-[#0078D4] shrink-0" stroke={1.5} />
          </div>
        ))}
      </div>

      {/* ─── Filtros ─── */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="lg:col-span-2 relative">
            <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar equipo o centro de costo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            />
          </div>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">Eficiencia (Todos)</option>
            <option value="TOP">Sobresaliente (90-100)</option>
            <option value="MID">Aceptable (75-89)</option>
            <option value="LOW">Requiere Atención (&lt;75)</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="rank">Ordenar por: Puesto</option>
            <option value="spend">Ordenar por: Gasto Total</option>
            <option value="penalty">Ordenar por: Mayor Penalización</option>
          </select>
        </div>
      </div>

      {/* ─── Tabla de posiciones ─── */}
      <div className={`space-y-3 ${VISIBLE_SCROLLBAR}`}>
        {paged.length === 0 ? (
          <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center">
            <IconAward className="w-7 h-7 text-[#0078D4] mx-auto mb-2" stroke={1.5} />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {teams.length === 0
                ? "Azure no reporta recursos con tags de equipo en las suscripciones visibles."
                : "Ningún equipo coincide con los filtros aplicados."}
            </p>
          </div>
        ) : (
          paged.map((t: TeamScorecardItem) => (
            <TeamRow key={t.teamId} team={t} onRemediate={handleRemediatePenalty} />
          ))
        )}
      </div>

      <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <Pagination page={page} totalPages={totalPages} pageSize={pageSize} total={total} setPage={setPage} setPageSize={setPageSize} pageSizes={[15, 30, 45, 60]} />
      </div>

      {/* ─── Recomendaciones de Cultura y Gobernanza ─── */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
          <span>Recomendaciones de Cultura y Gobernanza</span>
          <InfoTooltip content="Solo la purga de zombis es ahorro directo. Etiquetar y notificar no reducen la factura: hacen que el gasto tenga dueño, que es la condición previa para que alguien lo optimice." />
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {data?.remediations && data.remediations.length > 0 ? (
            data.remediations.map((a) => (
              <div key={a.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5 flex flex-col justify-between shadow-xs">
                <div className="space-y-2">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 text-[#0054A6] bg-white dark:bg-slate-900 uppercase">
                      {a.actionType}
                    </span>
                    {a.estimatedSavingsUSD > 0 && (
                      <span className="text-xs font-extrabold text-emerald-600">+{money(a.estimatedSavingsUSD)}/mes</span>
                    )}
                  </div>
                  <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 leading-snug">{a.title}</h4>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-4 leading-relaxed">
                    {a.description}
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-slate-400">
                    Confianza: {a.confidence}
                  </span>
                  <button
                    onClick={() => handleRemediateRecommendation(a)}
                    className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-[#0054A6] text-[#0054A6] bg-white dark:bg-slate-900 hover:bg-blue-50/50 dark:hover:bg-slate-800 transition flex items-center gap-1 cursor-pointer shadow-xs"
                  >
                    <IconSparkles className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
                    <span>Ver Plan</span>
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              <IconCheck className="w-6 h-6 text-emerald-500 mx-auto mb-1" stroke={1.5} />
              Todos los equipos están por encima del umbral y no hay gasto sin dueño.
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <span className="text-[10px] text-slate-400 flex items-center gap-1">
          <IconSparkles className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
          Los equipos sin gasto ni recursos no compiten en el ranking.
        </span>
      </div>

      {/* ─── Modal de Remediación ─── */}
      <RemediationModal
        isOpen={activeModalData.isOpen}
        onClose={() => setActiveModalData((prev) => ({ ...prev, isOpen: false }))}
        title={activeModalData.title}
        subtitle={activeModalData.subtitle}
        teamName={activeModalData.teamName}
        pillar={activeModalData.pillar}
        pointsLost={activeModalData.pointsLost}
        financialImpactUSD={activeModalData.financialImpactUSD}
        commandPayload={activeModalData.commandPayload}
        affectedResources={activeModalData.affectedResources}
        actionType={activeModalData.actionType}
      />
    </div>
  );
}
