"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
  IconTarget,
  IconClipboardCheck,
  IconRotateClockwise,
  IconSparkles,
  IconCheck,
  IconRocket,
  IconTerminal2,
  IconBrandPowershell,
  IconCopy,
  IconX,
  IconLoader2,
  IconAlertTriangle,
} from "@tabler/icons-react";
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip,
} from "recharts";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import PageHeaderTierBadge from "@/components/dashboard/PageHeaderTierBadge";
import type {
  MaturityPayload,
  MaturityMilestone,
  MaturityStage,
} from "@/types/finopsMaturity.types";
import { MATURITY_QUESTIONS, calculateMaturityStage } from "@/lib/finopsMaturityConstants";
import { useChartTheme } from "@/lib/chartTheme";

// ─── Colores por Nivel de Madurez (Escala de Azules) ───
const STAGE_CONFIG: Record<
  MaturityStage,
  { bgClass: string; textClass: string; colorHex: string }
> = {
  CRAWL: {
    bgClass: "bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800/60",
    textClass: "text-sky-700 dark:text-sky-300",
    colorHex: "#93C5FD",
  },
  WALK: {
    bgClass: "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/60",
    textClass: "text-[#0284C7] dark:text-blue-300",
    colorHex: "#0284C7",
  },
  RUN: {
    bgClass: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60",
    textClass: "text-emerald-700 dark:text-emerald-300",
    colorHex: "#0078D4",
  },
};

// ─── Fetcher con autenticación OAuth ───
function buildFetcher(instance: any, accounts: any[], isDemo: boolean) {
  return async (url: string) => {
    const headers: Record<string, string> = {};
    if (!isDemo && accounts[0]) {
      headers.Authorization = `Bearer ${await getFreshIdToken(instance, accounts[0])}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return res.json();
  };
}

export default function MaturityDashboard() {
  const t = useTranslations("OverviewMaturity");
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();

  const tenantId = selectedTenant?.id;
  const isDemo = Boolean(tenantId && isMockTenant(tenantId));
  const canFetch = !!tenantId && tenantId !== "default" && (accounts.length > 0 || isDemo);

  const chart = useChartTheme();

  const [showAssessmentModal, setShowAssessmentModal] = useState(false);
  const [assessmentStep, setAssessmentStep] = useState(0);
  const [assessmentAnswers, setAssessmentAnswers] = useState<Record<string, number>>({});
  const [isSubmittingAssessment, setIsSubmittingAssessment] = useState(false);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ score: number; level: string } | null>(null);
  const [selectedMilestone, setSelectedMilestone] = useState<MaturityMilestone | null>(null);
  const [cmdTab, setCmdTab] = useState<"cli" | "powershell">("cli");
  const [copiedCmd, setCopiedCmd] = useState(false);

  const fetcher = useMemo(
    () => buildFetcher(instance, accounts, isDemo),
    [instance, accounts, isDemo]
  );

  const apiUrl = canFetch
    ? `/api/intelligence/maturity?tenantId=${encodeURIComponent(tenantId!)}${isDemo ? "&mock=true" : ""}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<MaturityPayload>(
    apiUrl,
    fetcher,
    { revalidateOnFocus: false }
  );

  const isRefreshing = isLoading;

  // ─── Radar Data Format ───
  const radarChartData = useMemo(() => {
    if (!data?.summary?.dimensions) return [];
    return data.summary.dimensions.map((d) => ({
      domain: t(`dimension.${d.key}`),
      score: d.score,
      fullMark: 100,
    }));
  }, [data, t]);

  // ─── Cuestionario interactivo ───
  const isLastStep = assessmentStep === MATURITY_QUESTIONS.length - 1;
  const allAnswered = MATURITY_QUESTIONS.every((q) => assessmentAnswers[q.id] !== undefined);

  const handleSelectOption = (questionId: string, score: number) => {
    const updated = { ...assessmentAnswers, [questionId]: score };
    setAssessmentAnswers(updated);
    // En el último paso NO se envía al vuelo: se deja elegir/revisar y se
    // finaliza con el botón explícito del footer.
    if (assessmentStep < MATURITY_QUESTIONS.length - 1) {
      setAssessmentStep(assessmentStep + 1);
    }
  };

  /**
   * Proyecta las respuestas del cuestionario sobre las dimensiones del radar.
   * Cada pregunta declara su `domainKey`, que coincide con la `key` de la
   * dimensión, así que el gráfico se actualiza sin esperar el round-trip.
   */
  const projectAnswersOntoPayload = (
    current: MaturityPayload | undefined,
    answers: Record<string, number>
  ): MaturityPayload | undefined => {
    if (!current?.summary?.dimensions) return current;
    const byDomain: Record<string, number> = {};
    for (const q of MATURITY_QUESTIONS) {
      const score = answers[q.id];
      if (typeof score === "number") byDomain[q.domainKey] = score;
    }
    const dimensions = current.summary.dimensions.map((d) =>
      byDomain[d.key] === undefined
        ? d
        : {
            ...d,
            score: byDomain[d.key],
            stage: calculateMaturityStage(byDomain[d.key]),
            telemetryScore: d.telemetryScore ?? d.score,
            scoreSource: "self_assessment" as const,
          }
    );
    const overallScore = Math.round(
      dimensions.reduce((acc, d) => acc + d.score, 0) / Math.max(1, dimensions.length)
    );
    return {
      ...current,
      summary: {
        ...current.summary,
        dimensions,
        overallScore,
        overallStage: calculateMaturityStage(overallScore),
      },
      lastAssessed: new Date().toISOString().slice(0, 10),
    };
  };

  const submitAssessment = async (answers: Record<string, number>) => {
    setIsSubmittingAssessment(true);
    setAssessmentError(null);
    const answersArray = Object.entries(answers).map(([id, score]) => ({ id, score }));

    try {
      // Demo: no hay tenant real donde persistir; se cierra y se refresca el
      // diagnóstico simulado en vez de pegarle al endpoint (que exige RBAC).
      if (isDemo) {
        setShowAssessmentModal(false);
        setAssessmentStep(0);
        // El mock del backend es estático: sin proyección local el radar de la
        // demo nunca reflejaría las respuestas recién elegidas.
        await mutate(projectAnswersOntoPayload(data, answers), { revalidate: false });
        return;
      }

      // La ruta exige `requireTenantAccess`: sin el Bearer devolvía 401 y el
      // wizard se quedaba trabado en el último paso sin mensaje alguno.
      const idToken = accounts.length ? await getFreshIdToken(instance, accounts[0]) : "";
      const res = await fetch("/api/intelligence/maturity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          tenantId: selectedTenant.id,
          assessmentData: answersArray,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAssessmentError(
          res.status === 401 || res.status === 403
            ? t("saveErrorNoAccess")
            : t("saveError", { detail: String(json.error || res.status) })
        );
        return;
      }
      // Transición inmediata a la vista de resultados: se cierra el wizard y se
      // revalida el payload para repintar radar, badge de nivel y hoja de ruta.
      setShowAssessmentModal(false);
      setAssessmentStep(0);
      setLastResult({ score: Number(json.score || 0), level: String(json.level || "") });
      // Optimista + revalidación: el radar se mueve ya y el backend confirma
      // (getLiveMaturityData aplica la autoevaluación guardada sobre la telemetría).
      await mutate(projectAnswersOntoPayload(data, answers), { revalidate: true });
    } catch (err) {
      console.error("[MaturityDashboard] Error saving assessment:", err);
      setAssessmentError(t("saveErrorNetwork"));
    } finally {
      setIsSubmittingAssessment(false);
    }
  };

  const handleCopyCmd = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  if (!selectedTenant || selectedTenant.id === "default") return null;

  if (isLoading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <IconLoader2 className="w-8 h-8 animate-spin text-[#0078D4] dark:text-[#38BDF8] mb-4" stroke={1.5} />
        <p className="text-slate-500 font-medium text-xs">{t("loadingLabel")}</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl border border-red-100 dark:border-red-900/50">
        <h3 className="font-bold flex items-center gap-2 text-sm">
          <IconAlertTriangle className="w-4 h-4" /> {t("loadError")}
        </h3>
        <p className="text-xs mt-1">{error.message}</p>
      </div>
    );
  }

  if (!data?.summary) return null;

  const { summary } = data;
  const overallConfig = STAGE_CONFIG[summary.overallStage];

  return (
    <div className="space-y-6 w-full animate-in fade-in">
      {/* ─── 1. HEADER CORPORATIVO ─── */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 text-[#0078D4] dark:text-[#38BDF8] bg-transparent">
              <IconTarget className="w-7 h-7" stroke={1.5} />
            </span>
            <h1 className="text-2xl font-black font-heading text-[#1B2A41] dark:text-white tracking-tight">
              {t("pageTitle") || "Madurez FinOps"}
            </h1>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("pageSubtitle") || "Marco de referencia oficial FinOps Foundation (Crawl, Walk, Run)"}
            </p>
            <PageHeaderTierBadge tier={(data.tier as any) || "Enterprise"} />
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Badge de Nivel Global */}
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold ${overallConfig.bgClass} ${overallConfig.textClass} shadow-2xs`}
          >
            <IconCheck className="w-3.5 h-3.5" stroke={2} />
            <span>{t("globalLevel", { stage: t(`stage.${summary.overallStage}`).toUpperCase() })}</span>
            <span className="font-mono font-black ml-1">({summary.overallScore}/100)</span>
          </div>

          {/* Botón Retomar Evaluación */}
          <button
            onClick={() => {
              setAssessmentStep(0);
              setAssessmentAnswers({});
              setShowAssessmentModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] hover:bg-[#0078D4] hover:text-white transition-all cursor-pointer shadow-2xs"
          >
            <IconClipboardCheck className="w-4 h-4" stroke={1.5} />
            {t("retakeAssessment")}
          </button>

          {/* Botón Actualizar */}
          <button
            onClick={() => mutate()}
            disabled={isRefreshing}
            title={t("refresh")}
            className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] hover:bg-blue-50/50 shadow-2xs cursor-pointer transition-all disabled:opacity-50"
          >
            <IconRotateClockwise
              className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
              stroke={1.5}
            />
          </button>
        </div>
      </div>

      {/* ─── 2. PANEL CENTRAL: RADAR & BARRAS DE CAPACIDAD (2 COLUMNAS) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Columna Izquierda: Radar de Madurez (7 Cols) */}
        <div className="lg:col-span-6 xl:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <IconTarget className="w-4 h-4 text-[#0078D4] dark:text-[#38BDF8]" stroke={1.5} />
              {t("radarTitle")}
            </h3>
            <span className="text-[11px] font-bold text-[#0078D4] dark:text-[#38BDF8] bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-md border border-blue-200/50 dark:border-blue-900/60">
              {t("officialDomains")}
            </span>
          </div>

          <div className="w-full h-72 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarChartData} margin={{ top: 10, right: 25, bottom: 10, left: 25 }}>
                <PolarGrid stroke={chart.grid} strokeDasharray="3 3" />
                <PolarAngleAxis
                  dataKey="domain"
                  tick={{ fontSize: 10.5, fill: chart.tick, fontWeight: 600 }}
                />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9, fill: chart.tick }} stroke={chart.axis} />
                <Tooltip
                  formatter={(val: any) => [`${val} pts`, t("scoreLabel")]}
                  contentStyle={{
                    backgroundColor: chart.tooltip.backgroundColor,
                    color: chart.tooltip.color,
                    borderRadius: "8px",
                    fontSize: "11px",
                    border: `1px solid ${chart.tooltip.borderColor}`,
                  }}
                />
                <Radar
                  name={t("pageTitle")}
                  dataKey="score"
                  stroke={chart.accent}
                  strokeWidth={2}
                  fill={chart.accent}
                  fillOpacity={0.25}
                  // MEJ-02: antes deshabilitada siempre (ver useChartTheme para
                  // el porqué); ahora reactiva -- se pierde la animación sólo
                  // cuando la pestaña carga oculta o "reducir movimiento" está
                  // activo, no siempre.
                  isAnimationActive={chart.animate}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center justify-around pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#93C5FD]" /> Gatear: &lt;40
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0284C7]" /> Caminar: 40-75
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0078D4]" /> Correr: &gt;75
            </span>
          </div>
        </div>

        {/* Columna Derecha: Nivel por Capacidad (6 Cols) */}
        <div className="lg:col-span-6 xl:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t("levelByCapability")}
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{t("scoreOutOf")}</span>
          </div>

          <div className="space-y-4">
            {summary.dimensions.map((dim) => {
              const stageConf = STAGE_CONFIG[dim.stage];
              const levelNumber = dim.stage === "CRAWL" ? 1 : dim.stage === "WALK" ? 2 : 3;

              return (
                <div key={dim.key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[#1B2A41] dark:text-slate-200">
                      {t(`dimension.${dim.key}`)}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${stageConf.bgClass} ${stageConf.textClass}`}>
                        {t(`stage.${dim.stage}`)}
                      </span>
                      <span className="font-mono font-bold text-slate-700 dark:text-slate-300 w-8 text-right">
                        {dim.score}%
                      </span>
                    </div>
                  </div>

                  {/* Barra segmentada en 3 bloques en escala de azules */}
                  <div className="grid grid-cols-3 gap-1.5 h-2">
                    {[1, 2, 3].map((block) => {
                      const isActive = block <= levelNumber;
                      const blockColor =
                        block === 1
                          ? "bg-[#93C5FD]"
                          : block === 2
                          ? "bg-[#0284C7]"
                          : "bg-[#0078D4]";

                      return (
                        <div
                          key={block}
                          className={`h-full rounded-sm transition-all ${
                            isActive
                              ? blockColor
                              : "bg-slate-100 dark:bg-slate-800"
                          }`}
                        />
                      );
                    })}
                  </div>
                  <p className="text-[10.5px] text-slate-400 line-clamp-1">
                    {dim.actionPlanKey ? t(dim.actionPlanKey, dim.actionPlanParams) : dim.actionPlan}
                    {dim.divergenceKey ? " " + t(dim.divergenceKey, dim.divergenceParams) : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ─── 3. PANEL INFERIOR: ROADMAP RESOLUTIVO PARA SUBIR DE NIVEL ─── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconRocket className="w-5 h-5 text-[#0078D4] dark:text-[#38BDF8]" stroke={1.5} />
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t("roadmapTitle")}
            </h3>
          </div>
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            {summary.nextMilestones.length} acciones prioritarias identificadas
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {summary.nextMilestones.map((milestone, idx) => (
            <div
              key={idx}
              className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-[#0078D4]/40 transition-colors bg-slate-50/30 dark:bg-slate-950/20"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-[#0078D4] border border-blue-200/50">
                    {milestone.fromStage} → {milestone.toStage}
                  </span>
                  {milestone.impactScore && (
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">
                      +{milestone.impactScore} pts
                    </span>
                  )}
                </div>
                <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 line-clamp-2">
                  {milestone.titleKey ? t(milestone.titleKey) : milestone.title}
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-3">
                  {milestone.descriptionKey
                    ? t(milestone.descriptionKey, milestone.descriptionParams)
                    : milestone.description}
                </p>
              </div>

              <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  {t("effortLabel")}: <strong className="text-slate-600 dark:text-slate-300">{t(`effort.${milestone.estimatedEffort || "LOW"}`)}</strong>
                </span>
                <button
                  onClick={() => setSelectedMilestone(milestone)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] hover:bg-[#0078D4] hover:text-white transition-all cursor-pointer shadow-2xs"
                >
                  <IconSparkles className="w-3.5 h-3.5" stroke={2} />
                  {t("implementAction")}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── 4. MODAL CUESTIONARIO INTERACTIVO (Z-50) ─── */}
      {showAssessmentModal && (
        <div className="fixed inset-0 bg-black/60 z-50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-150">
            {/* Header Modal */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-[#0078D4] dark:text-[#38BDF8]">
                  <IconClipboardCheck className="w-4 h-4" stroke={1.5} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#1B2A41] dark:text-white">
                    {t("selfAssessmentTitle")}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Paso {assessmentStep + 1} de {MATURITY_QUESTIONS.length}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAssessmentModal(false)}
                className="text-slate-400 dark:text-slate-300 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            {/* Barra de progreso */}
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5">
              <div
                className="bg-[#0078D4] dark:bg-[#38BDF8] h-1.5 transition-all duration-300"
                style={{
                  width: `${((assessmentStep + 1) / MATURITY_QUESTIONS.length) * 100}%`,
                }}
              />
            </div>

            {/* Pregunta Actual */}
            <div className="p-6 space-y-4">
              {(() => {
                const currentQ = MATURITY_QUESTIONS[assessmentStep];
                return (
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-base font-bold text-[#1B2A41] dark:text-white">
                        {t(`q.${currentQ.id}.title`)}
                      </h4>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{t(`q.${currentQ.id}.desc`)}</p>
                    </div>

                    <div className="space-y-2.5">
                      {currentQ.options.map((opt, i) => (
                        <button
                          key={i}
                          onClick={() => handleSelectOption(currentQ.id, opt.score)}
                          disabled={isSubmittingAssessment}
                          aria-pressed={assessmentAnswers[currentQ.id] === opt.score}
                          className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer group ${
                            assessmentAnswers[currentQ.id] === opt.score
                              ? "border-[#0078D4] dark:border-sky-400 bg-blue-50/60 dark:bg-sky-950/40"
                              : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:border-[#0078D4] dark:hover:border-sky-400 hover:bg-blue-50/20 dark:hover:bg-slate-800"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span
                              className={`text-xs font-bold group-hover:underline ${
                                assessmentAnswers[currentQ.id] === opt.score
                                  ? "text-[#0078D4] dark:text-sky-200"
                                  : "text-[#0078D4] dark:text-[#38BDF8]"
                              }`}
                            >
                              {t(`stage.${opt.level}`)}
                            </span>
                            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                              {opt.score} pts
                            </span>
                          </div>
                          <p className="text-[11.5px] text-slate-700 dark:text-slate-200 leading-relaxed">
                            {t(`q.${currentQ.id}.${opt.level}`)}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {assessmentError && (
              <div className="mx-6 mb-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-[11.5px] font-semibold text-rose-700 dark:text-rose-300 flex items-start gap-2">
                <IconAlertTriangle size={15} stroke={1.5} className="shrink-0 mt-0.5" />
                <span>{assessmentError}</span>
              </div>
            )}

            {/* Footer Modal */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center gap-3 flex-wrap bg-slate-50/50 dark:bg-slate-950/30">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAssessmentStep((s) => Math.max(0, s - 1))}
                  disabled={assessmentStep === 0 || isSubmittingAssessment}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer disabled:opacity-30"
                >
                  ← Anterior
                </button>
                <button
                  onClick={() => setShowAssessmentModal(false)}
                  disabled={isSubmittingAssessment}
                  className="px-4 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>

              {/* El último paso necesita una salida explícita: antes sólo había
                  Anterior y Cancelar, y el envío implícito al elegir opción
                  fallaba en silencio (401 sin Authorization). */}
              {isLastStep ? (
                <button
                  onClick={() => submitAssessment(assessmentAnswers)}
                  disabled={isSubmittingAssessment || !allAnswered}
                  title={!allAnswered ? t("answerAllDomains") : undefined}
                  className="inline-flex items-center gap-1.5 px-6 py-2.5 text-xs font-semibold rounded-lg bg-[#0078D4] hover:bg-[#0060AA] text-white dark:text-white shadow-sm cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmittingAssessment ? (
                    <>
                      <IconLoader2 size={16} stroke={2} className="animate-spin text-white" />
                      {t("savingDiagnosis")}
                    </>
                  ) : (
                    <>
                      <IconCheck size={16} stroke={2} className="text-white" />
                      {t("finishAssessment")}
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={() => setAssessmentStep((s) => Math.min(MATURITY_QUESTIONS.length - 1, s + 1))}
                  disabled={assessmentAnswers[MATURITY_QUESTIONS[assessmentStep].id] === undefined}
                  title={t("pickAnOption")}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0078D4] dark:border-sky-400 text-[#0078D4] dark:text-sky-300 hover:bg-blue-50/60 dark:hover:bg-slate-800 shadow-xs cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Siguiente →
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── 5. MODAL IMPLEMENTAR ACCIÓN RESOLUTIVA (Z-50) ─── */}
      {selectedMilestone && (
        <div className="fixed inset-0 bg-black/60 z-50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-[#0078D4]">
                  <IconRocket className="w-4 h-4" stroke={1.5} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
                    {selectedMilestone.titleKey ? t(selectedMilestone.titleKey) : selectedMilestone.title}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {t("transition", {
                      from: t(`stage.${selectedMilestone.fromStage}`),
                      to: t(`stage.${selectedMilestone.toStage}`),
                    })}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedMilestone(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-700/60 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {selectedMilestone.descriptionKey
                  ? t(selectedMilestone.descriptionKey, selectedMilestone.descriptionParams)
                  : selectedMilestone.description}
              </div>

              {selectedMilestone.commandPayload && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setCmdTab("cli")}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                          cmdTab === "cli"
                            ? "bg-[#0078D4] text-white"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                        }`}
                      >
                        <IconTerminal2 className="w-3.5 h-3.5" />
                        Azure CLI
                      </button>
                      <button
                        onClick={() => setCmdTab("powershell")}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                          cmdTab === "powershell"
                            ? "bg-[#0078D4] text-white"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                        }`}
                      >
                        <IconBrandPowershell className="w-3.5 h-3.5" />
                        PowerShell
                      </button>
                    </div>

                    <button
                      onClick={() => handleCopyCmd(selectedMilestone.commandPayload || "")}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#0078D4] hover:underline cursor-pointer"
                    >
                      {copiedCmd ? (
                        <IconCheck className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <IconCopy className="w-3.5 h-3.5" />
                      )}
                      {copiedCmd ? t("copied") : t("copyCommand")}
                    </button>
                  </div>

                  <pre className="bg-slate-900 text-slate-100 p-4 rounded-xl text-xs font-mono overflow-x-auto border border-slate-800">
                    {selectedMilestone.commandPayload}
                  </pre>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 bg-slate-50/50 dark:bg-slate-950/30">
              <button
                onClick={() => setSelectedMilestone(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
              >
                {t("close")}
              </button>
              {selectedMilestone.commandPayload && (
                <button
                  onClick={() => handleCopyCmd(selectedMilestone.commandPayload || "")}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0054A6] hover:bg-[#004080] rounded-lg cursor-pointer shadow-xs transition-colors"
                >
                  <IconCopy className="w-4 h-4" />
                  {t("copyAndApply")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
