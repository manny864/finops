"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { useMsal } from "@azure/msal-react";
import { useTenant } from "./TenantProvider";
import { useSubscription } from "./SubscriptionProvider";
import { useLocale, useTranslations } from "next-intl";
import RoleAssignmentBanner from "./RoleAssignmentBanner";
import {
  IconBulb,
  IconCash,
  IconShieldCheck,
  IconWorldCheck,
  IconGauge,
  IconAdjustmentsCheck,
  IconPigMoney,
  IconLayersLinked,
  IconDownload,
  IconSparkles,
  IconRotateClockwise,
  IconServer,
  IconDatabase,
  IconFolder,
  IconCloud,
  IconCheck,
  IconCopy,
  IconX,
  IconChevronLeft,
  IconChevronRight,
  IconFilter,
} from "@tabler/icons-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import type {
  AdvisorCategory,
  AdvisorRecommendation,
  AdvisorApiResponse,
} from "@/types/azureAdvisor.types";
import { buildAdvisorRemediationCommand } from "@/lib/advisorRemediation";

const CATEGORIES: AdvisorCategory[] = [
  "Cost",
  "Security",
  "HighAvailability",
  "Performance",
  "OperationalExcellence",
];

const PAGE_SIZES = [15, 30, 45, 60];

function getServiceIcon(serviceName?: string) {
  const s = (serviceName || "").toLowerCase();
  if (s.includes("virtual machine") || s.includes("vm") || s.includes("compute")) {
    return <IconServer className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />;
  }
  if (s.includes("database") || s.includes("sql") || s.includes("redis") || s.includes("cosmos")) {
    return <IconDatabase className="w-4 h-4 text-[#0284C7] shrink-0" stroke={1.5} />;
  }
  if (s.includes("storage") || s.includes("disk") || s.includes("blob")) {
    return <IconFolder className="w-4 h-4 text-[#2563EB] shrink-0" stroke={1.5} />;
  }
  return <IconCloud className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />;
}

export function ResizableTh({
  children,
  minWidth = 100,
  className = "",
}: {
  children: React.ReactNode;
  minWidth?: number;
  className?: string;
}) {
  const thRef = useRef<HTMLTableCellElement>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const th = thRef.current;
    if (!th) return;
    const startX = e.clientX;
    const startWidth = th.getBoundingClientRect().width;

    const onMove = (ev: MouseEvent) => {
      th.style.width = `${Math.max(minWidth, startWidth + (ev.clientX - startX))}px`;
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <th
      ref={thRef}
      style={{ minWidth }}
      className={`sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/80 relative text-left text-[11px] tracking-[0.5px] uppercase text-slate-600 dark:text-slate-300 font-bold p-[10px_14px] border-b border-slate-200 dark:border-slate-700 whitespace-nowrap select-none ${className}`}
    >
      {children}
      <span
        onMouseDown={onMouseDown}
        title="Arrastrar para ajustar ancho"
        className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-blue-400/50 active:bg-blue-500"
      />
    </th>
  );
}

export default function AdvisorPanel() {
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  const locale = useLocale();
  const t = useTranslations("advisor");
  const tCommon = useTranslations("Common");

  const [advisorData, setAdvisorData] = useState<AdvisorApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<AdvisorCategory>("Cost");
  const [selectedSub, setSelectedSub] = useState<string>("all");
  const { selectedSubscription, setSelectedSubscription } = useSubscription();

  // Filtros CMP
  const [impactFilter, setImpactFilter] = useState<string>("ALL");
  const [serviceFilter, setServiceFilter] = useState<string>("ALL");
  const [rgFilter, setRgFilter] = useState<string>("ALL");
  const [searchFilter, setSearchFilter] = useState<string>("");

  // Paginación y orden
  const [pageSize, setPageSize] = useState<number>(15);
  const [page, setPage] = useState<number>(0);
  const [sortField, setSortField] = useState<"savings" | "impact" | "name">("savings");
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // Modales de resolución
  const [selectedRecForModal, setSelectedRecForModal] = useState<AdvisorRecommendation | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<boolean>(false);
  const [activeCmdTab, setActiveCmdTab] = useState<"cli" | "powershell">("cli");
  const [snoozeMsg, setSnoozeMsg] = useState<string | null>(null);

  // Términos seleccionados por recomendación id
  const [selectedTermsMap, setSelectedTermsMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (selectedSubscription) {
      setSelectedSub(selectedSubscription.toLowerCase() === "all" ? "all" : selectedSubscription);
    }
  }, [selectedSubscription]);

  useEffect(() => {
    setPage(0);
  }, [selectedCategory, selectedSub, impactFilter, serviceFilter, rgFilter, searchFilter, pageSize]);

  const fetchAdvisor = async () => {
    if ((accounts.length === 0 && !isMockTenant(selectedTenant?.id || "")) || selectedTenant.id === "default") {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const idToken = accounts.length ? await getFreshIdToken(instance, accounts[0]) : "";
      const subQuery = selectedSub !== "all" ? `&subscriptionId=${encodeURIComponent(selectedSub)}` : "";
      const res = await fetch(
        `/api/advisor?tenantId=${selectedTenant.id}&locale=${encodeURIComponent(locale)}${subQuery}`,
        {
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Accept-Language": locale,
          },
        }
      );
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error === "MISSING_RBAC_ROLE" ? "MISSING_RBAC_ROLE" : (json.error || "Error de servidor."));
        setLoading(false);
        return;
      }
      setAdvisorData(json);
    } catch (err) {
      console.error(err);
      setError("Fallo de red o credenciales.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdvisor();
  }, [accounts, instance, selectedTenant, locale, selectedSub]);

  const pillarMeta: Record<
    AdvisorCategory,
    { label: string; icon: React.ReactNode; colorClass: string; borderActiveClass: string }
  > = {
    Cost: {
      label: "Costo",
      icon: <IconCash className="w-4 h-4 text-[#0078D4]" stroke={1.5} />,
      colorClass: "text-[#0078D4]",
      borderActiveClass: "border-[#0078D4] text-[#0078D4]",
    },
    Security: {
      label: "Seguridad",
      icon: <IconShieldCheck className="w-4 h-4 text-[#2563EB]" stroke={1.5} />,
      colorClass: "text-[#2563EB]",
      borderActiveClass: "border-[#2563EB] text-[#2563EB]",
    },
    HighAvailability: {
      label: "Confiabilidad",
      icon: <IconWorldCheck className="w-4 h-4 text-[#0284C7]" stroke={1.5} />,
      colorClass: "text-[#0284C7]",
      borderActiveClass: "border-[#0284C7] text-[#0284C7]",
    },
    Performance: {
      label: "Rendimiento",
      icon: <IconGauge className="w-4 h-4 text-[#38BDF8]" stroke={1.5} />,
      colorClass: "text-[#38BDF8]",
      borderActiveClass: "border-[#38BDF8] text-[#38BDF8]",
    },
    OperationalExcellence: {
      label: "Excelencia Op.",
      icon: <IconAdjustmentsCheck className="w-4 h-4 text-[#94A3B8]" stroke={1.5} />,
      colorClass: "text-[#94A3B8]",
      borderActiveClass: "border-[#94A3B8] text-[#94A3B8]",
    },
  };

  // Listado de recomendaciones de la categoría activa
  const rawList = useMemo(() => {
    return advisorData?.recommendations?.[selectedCategory] || [];
  }, [advisorData, selectedCategory]);

  // Conjuntos para dropdowns de filtros
  const filterOptions = useMemo(() => {
    const services = new Set<string>();
    const rgs = new Set<string>();
    rawList.forEach((r) => {
      if (r.serviceName) services.add(r.serviceName);
      if (r.resourceGroup) rgs.add(r.resourceGroup);
    });
    return {
      services: Array.from(services).sort(),
      rgs: Array.from(rgs).sort(),
    };
  }, [rawList]);

  // Filtrado y ordenamiento de recomendaciones
  const filteredList = useMemo(() => {
    let list = [...rawList];

    if (impactFilter !== "ALL") {
      list = list.filter((r) => r.impact.toUpperCase() === impactFilter.toUpperCase());
    }
    if (serviceFilter !== "ALL") {
      list = list.filter((r) => r.serviceName === serviceFilter);
    }
    if (rgFilter !== "ALL") {
      list = list.filter((r) => r.resourceGroup === rgFilter);
    }
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      list = list.filter(
        (r) =>
          r.titleTranslated.toLowerCase().includes(q) ||
          r.resourceName.toLowerCase().includes(q) ||
          r.resourceGroup.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      if (sortField === "savings") {
        const diff = (a.annualSavingsUSD || 0) - (b.annualSavingsUSD || 0);
        return sortAsc ? diff : -diff;
      }
      if (sortField === "impact") {
        const weight: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
        const diff = (weight[a.impact] || 0) - (weight[b.impact] || 0);
        return sortAsc ? diff : -diff;
      }
      const diff = a.titleTranslated.localeCompare(b.titleTranslated);
      return sortAsc ? diff : -diff;
    });

    return list;
  }, [rawList, impactFilter, serviceFilter, rgFilter, searchFilter, sortField, sortAsc]);

  const pageCount = Math.max(1, Math.ceil(filteredList.length / pageSize));
  const pageItems = useMemo(() => {
    const start = page * pageSize;
    return filteredList.slice(start, start + pageSize);
  }, [filteredList, page, pageSize]);

  const activePillarSummary = advisorData?.pillars?.[selectedCategory];

  const fmtUsd = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n || 0);

  const handleExportCsv = () => {
    if (!advisorData) return;
    const headers = ["Categoría", "Recomendación", "Impacto", "Recurso", "Grupo de Recursos", "Suscripción", "Ahorro Anual (USD)", "Ahorro Mensual (USD)", "Acción"];
    const rows: string[][] = [];

    CATEGORIES.forEach((cat) => {
      const recs = advisorData.recommendations[cat] || [];
      recs.forEach((r) => {
        rows.push([
          cat,
          r.titleTranslated,
          r.impact,
          r.resourceName,
          r.resourceGroup,
          r.subscriptionName,
          r.annualSavingsUSD ? String(r.annualSavingsUSD) : "0.00",
          r.monthlySavingsUSD ? String(r.monthlySavingsUSD) : "0.00",
          r.actionType,
        ]);
      });
    });

    const esc = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
    const csvContent = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `azure-advisor-${selectedTenant.id}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleCopyCmd = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const handleSnooze = async (days: number) => {
    if (!selectedRecForModal) return;
    try {
      const res = await fetch("/api/advisor/suppress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: selectedTenant.id,
          recommendationId: selectedRecForModal.id,
          category: selectedRecForModal.category,
          resourceId: selectedRecForModal.resourceId,
          durationDays: days,
          reason: "Postpuesto desde portal FinOps",
        }),
      });
      if (res.ok) {
        setSnoozeMsg(`Recomendación pospuesta por ${days} días.`);
        setTimeout(() => {
          setSnoozeMsg(null);
          setSelectedRecForModal(null);
          fetchAdvisor();
        }, 1200);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleTermChange = (recId: string, newTermFormatted: string, rec: AdvisorRecommendation) => {
    setSelectedTermsMap((prev) => ({ ...prev, [recId]: newTermFormatted }));
    const opt = rec.reservationOptions?.find(
      (o) => `${o.term} / ${o.lookback}` === newTermFormatted || o.term === newTermFormatted
    );
    if (opt) {
      rec.annualSavingsUSD = opt.annualSavingsUSD;
      rec.monthlySavingsUSD = opt.monthlySavingsUSD;
      rec.selectedTerm = newTermFormatted;
      const cmd = buildAdvisorRemediationCommand(rec);
      rec.remediationCommand = cmd.cli;
      rec.powerShellCommand = cmd.powerShell;
    }
  };

  if ((accounts.length === 0 && !isMockTenant(selectedTenant?.id || "")) || selectedTenant.id === "default") {
    return <div className="p-8 text-center text-slate-500">{tCommon("loading")}</div>;
  }

  const overallScore = advisorData?.overallScore ?? 64.6;

  return (
    <div className="w-full flex flex-col gap-6 animate-in fade-in">
      {/* 1. HEADER CORPORATIVO */}
      <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 text-[#0078D4] bg-transparent">
              <IconBulb className="w-7 h-7" stroke={1.5} />
            </span>
            <h1 className="text-2xl font-black font-heading text-[#1B2A41] dark:text-white tracking-tight">
              Azure Advisor & Well-Architected Framework
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Optimización continua y gobernanza basada en los 5 pilares de Microsoft Azure.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-50/80 dark:bg-slate-800 text-[#0078D4] dark:text-blue-300 border border-blue-200 dark:border-slate-700">
            {advisorData?.tenantName || selectedTenant.name}
          </span>

          {/* Badge Advisor Score */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xs">
            <span className="text-xs font-bold text-[#1B2A41] dark:text-white">
              🏆 Advisor Score: <span className="text-[#0078D4] font-black">{overallScore}%</span>
            </span>
            <div className="w-16 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-[#0078D4] rounded-full transition-all"
                style={{ width: `${Math.max(5, Math.min(100, overallScore))}%` }}
              />
            </div>
          </div>

          {/* Selector de Suscripciones */}
          <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 shadow-xs">
            <span className="text-[10px] uppercase font-bold text-slate-400">Alcance:</span>
            <select
              value={selectedSub}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedSub(val);
                setSelectedSubscription(val === "all" ? "All" : val);
              }}
              className="text-xs font-bold text-[#1B2A41] dark:text-white bg-transparent border-none cursor-pointer focus:outline-none"
            >
              <option value="all">Todas las Suscripciones</option>
              {(advisorData?.subscriptions || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || s.id}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-300 hover:bg-blue-50/50 shadow-xs cursor-pointer transition-all"
          >
            <IconDownload className="w-4 h-4" stroke={1.5} />
            Descargar como CSV
          </button>

          <button
            onClick={fetchAdvisor}
            title="Refrescar datos"
            className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-300 hover:bg-blue-50/50 shadow-xs cursor-pointer transition-all"
          >
            <IconRotateClockwise className="w-4 h-4" stroke={1.5} />
          </button>
        </div>
      </div>

      {error === "MISSING_RBAC_ROLE" ? (
        <RoleAssignmentBanner />
      ) : error ? (
        <div className="p-4 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-sm">{error}</div>
      ) : loading && !advisorData ? (
        <div className="p-12 text-center text-slate-500 animate-pulse text-sm">{tCommon("loading")}</div>
      ) : (
        <>
          {/* 2. PESTAÑAS DE LOS 5 PILARES */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {CATEGORIES.map((cat) => {
              const meta = pillarMeta[cat];
              const summary = advisorData?.pillars?.[cat];
              const isActive = selectedCategory === cat;
              const count = summary?.recommendationsCount || 0;
              const score = summary?.scorePercentage ?? 0;

              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`flex flex-col gap-1 p-3.5 rounded-xl border transition-all text-left bg-white dark:bg-slate-900 shadow-xs cursor-pointer ${
                    isActive
                      ? `${meta.borderActiveClass} border-2 ring-2 ring-blue-500/10 shadow-sm`
                      : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-xs">
                      <span className="bg-transparent">{meta.icon}</span>
                      <span>{meta.label}</span>
                    </div>
                    <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {count}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] mt-1 text-slate-500">
                    <span>Puntuación:</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{score}% Score</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mt-0.5">
                    <div
                      className="h-full bg-current rounded-full"
                      style={{ width: `${Math.max(5, Math.min(100, score))}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          {/* 3. KPI CARDS DEL PILAR ACTIVO */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {selectedCategory === "Cost" ? (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 text-[#0078D4] bg-transparent">
                    <IconPigMoney className="w-8 h-8" stroke={1.5} />
                  </div>
                  <div>
                    <span className="text-[11px] uppercase font-bold tracking-wider text-slate-400">
                      Ahorro Potencial Total (Costo)
                    </span>
                    <div className="text-2xl font-black text-[#0078D4] font-heading leading-tight mt-0.5">
                      {fmtUsd(activePillarSummary?.totalSavingsUSD || 0)}{" "}
                      <span className="text-xs font-normal text-slate-500">USD/año</span>
                    </div>
                    <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                      ≈ {fmtUsd((activePillarSummary?.totalSavingsUSD || 0) / 12)} / mes identificable
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-500">Oportunidades activas:</span>
                  <div className="text-xl font-bold text-slate-800 dark:text-white">
                    {filteredList.length}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center gap-4">
                <div className="p-3 text-[#0078D4] bg-transparent">
                  {pillarMeta[selectedCategory].icon}
                </div>
                <div>
                  <span className="text-[11px] uppercase font-bold tracking-wider text-slate-400">
                    Recomendaciones de {pillarMeta[selectedCategory].label}
                  </span>
                  <div className="text-2xl font-black text-slate-800 dark:text-white font-heading leading-tight mt-0.5">
                    {filteredList.length}{" "}
                    <span className="text-xs font-normal text-slate-500">pendientes</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Alto: {activePillarSummary?.highImpactCount || 0} | Medio: {activePillarSummary?.mediumImpactCount || 0} | Bajo: {activePillarSummary?.lowImpactCount || 0}
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 text-[#0078D4] bg-transparent">
                  <IconLayersLinked className="w-8 h-8" stroke={1.5} />
                </div>
                <div>
                  <span className="text-[11px] uppercase font-bold tracking-wider text-slate-400">
                    Recursos Evaluados / Activos
                  </span>
                  <div className="text-2xl font-black text-slate-800 dark:text-white font-heading leading-tight mt-0.5">
                    {activePillarSummary?.activeResourcesCount || filteredList.length}{" "}
                    <span className="text-xs font-normal text-slate-500">recursos vinculados</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Monitoreo automático con Azure Advisor REST API
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 4. FILTROS Y TABLA DE RECOMENDACIONES (ESTÁNDAR CMP) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden flex flex-col">
            {/* Barra de Filtros Inmediata */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-wrap flex-1 min-w-[280px]">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                  <IconFilter className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                  <span>Filtros:</span>
                </div>

                {/* Filtro Impacto */}
                <select
                  value={impactFilter}
                  onChange={(e) => setImpactFilter(e.target.value)}
                  className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
                >
                  <option value="ALL">Impacto: Todos</option>
                  <option value="HIGH">Impacto: Alto</option>
                  <option value="MEDIUM">Impacto: Medio</option>
                  <option value="LOW">Impacto: Bajo</option>
                </select>

                {/* Filtro Servicio */}
                <select
                  value={serviceFilter}
                  onChange={(e) => setServiceFilter(e.target.value)}
                  className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer max-w-[180px] truncate"
                >
                  <option value="ALL">Servicio: Todos</option>
                  {filterOptions.services.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                {/* Filtro Grupo de Recursos */}
                <select
                  value={rgFilter}
                  onChange={(e) => setRgFilter(e.target.value)}
                  className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer max-w-[180px] truncate"
                >
                  <option value="ALL">Grupo: Todos</option>
                  {filterOptions.rgs.map((rg) => (
                    <option key={rg} value={rg}>
                      {rg}
                    </option>
                  ))}
                </select>

                {/* Búsqueda rápida */}
                <input
                  type="text"
                  placeholder="Buscar recurso o recomendación..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none flex-1 min-w-[160px]"
                />
              </div>

              {/* Selector de Paginación */}
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Mostrar:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="text-xs font-bold px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size} por pág.
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Contenedor de Tabla con Scroll Horizontal y Columnas Redimensionables */}
            <div className="w-full overflow-x-auto">
              {pageItems.length === 0 ? (
                <div className="p-12 text-center text-slate-500 text-xs">
                  No se encontraron recomendaciones con los filtros seleccionados. 🎉
                </div>
              ) : (
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr>
                      <ResizableTh minWidth={280}>Recomendación Formal</ResizableTh>
                      <ResizableTh minWidth={220}>Recurso Afectado</ResizableTh>
                      <ResizableTh minWidth={110}>Impacto</ResizableTh>
                      <ResizableTh minWidth={180}>Opción de Compromiso</ResizableTh>
                      <ResizableTh minWidth={150}>Ahorro Estimado</ResizableTh>
                      <ResizableTh minWidth={150}>Acción Resolutiva</ResizableTh>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {pageItems.map((rec) => {
                      const impactColor =
                        rec.impact === "High"
                          ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900"
                          : rec.impact === "Medium"
                          ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900"
                          : "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";

                      const isReservation = !!rec.reservationOptions && rec.reservationOptions.length > 0;
                      const selectedTerm = selectedTermsMap[rec.id] || rec.selectedTerm || "3 Years / 30 Days";

                      return (
                        <tr
                          key={rec.id}
                          className="hover:bg-blue-50/30 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          {/* Columna Recomendación */}
                          <td className="p-3.5 align-top">
                            <div className="flex items-start gap-2.5">
                              <span className="p-1 text-[#0078D4] bg-transparent mt-0.5">
                                {getServiceIcon(rec.serviceName)}
                              </span>
                              <div>
                                <div className="font-bold text-[#1B2A41] dark:text-white leading-snug">
                                  {rec.titleTranslated}
                                </div>
                                <div className="text-[11px] text-slate-500 line-clamp-2 mt-1">
                                  {rec.descriptionTranslated}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Columna Recurso */}
                          <td className="p-3.5 align-top">
                            <div className="font-semibold text-slate-800 dark:text-slate-200 font-mono text-[11.5px]">
                              {rec.resourceName}
                            </div>
                            <div className="text-[10.5px] text-slate-400 mt-0.5">
                              rg: <span className="font-mono text-slate-600 dark:text-slate-400">{rec.resourceGroup}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              sub: <span className="text-slate-500">{rec.subscriptionName}</span>
                            </div>
                          </td>

                          {/* Columna Impacto */}
                          <td className="p-3.5 align-top">
                            <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-md border ${impactColor}`}>
                              {rec.impact === "High" ? "Alto" : rec.impact === "Medium" ? "Medio" : "Bajo"}
                            </span>
                          </td>

                          {/* Columna Opción de Compromiso */}
                          <td className="p-3.5 align-top">
                            {isReservation ? (
                              <select
                                value={selectedTerm}
                                onChange={(e) => handleTermChange(rec.id, e.target.value, rec)}
                                className="text-[11px] font-bold px-2 py-1 rounded-md border border-blue-200 dark:border-slate-700 bg-blue-50/50 dark:bg-slate-800 text-[#0078D4] dark:text-blue-300 focus:outline-none cursor-pointer w-full max-w-[170px]"
                              >
                                {rec.reservationOptions!.map((opt) => {
                                  const label = `${opt.term} / ${opt.lookback}`;
                                  return (
                                    <option key={label} value={label}>
                                      {label} (${opt.annualSavingsUSD}/año)
                                    </option>
                                  );
                                })}
                              </select>
                            ) : rec.extendedProperties?.targetSku ? (
                              <span className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                                {rec.extendedProperties.targetSku}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[11px]">Estándar</span>
                            )}
                          </td>

                          {/* Columna Ahorro */}
                          <td className="p-3.5 align-top">
                            {rec.annualSavingsUSD > 0 ? (
                              <div>
                                <div className="font-black text-emerald-600 dark:text-emerald-400 font-heading">
                                  +{fmtUsd(rec.monthlySavingsUSD)} <span className="text-[10px] font-normal text-slate-500">/ mes</span>
                                </div>
                                <div className="text-[10.5px] text-slate-400 font-semibold">
                                  {fmtUsd(rec.annualSavingsUSD)} / año
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[11px]">—</span>
                            )}
                          </td>

                          {/* Columna Acción Resolutiva */}
                          <td className="p-3.5 align-top whitespace-nowrap">
                            <button
                              onClick={() => {
                                setSelectedRecForModal(rec);
                                setActiveCmdTab("cli");
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:border-blue-400 dark:text-blue-300 transition-all shadow-xs cursor-pointer"
                            >
                              <IconSparkles className="w-3.5 h-3.5" stroke={1.5} />
                              {rec.actionType === "PURCHASE_RESERVATION"
                                ? "Simular Reserva ✨"
                                : rec.actionType === "APPLY_AHUB"
                                ? "Activar AHUB ✨"
                                : "Optimizar ✨"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Paginador Inferior */}
            {pageCount > 1 && (
              <div className="p-3 px-5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 flex items-center justify-between text-xs text-slate-500">
                <span>
                  Mostrando {page * pageSize + 1} - {Math.min(filteredList.length, (page + 1) * pageSize)} de{" "}
                  {filteredList.length} recomendaciones
                </span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50 cursor-pointer shadow-xs"
                  >
                    <IconChevronLeft className="w-4 h-4" stroke={1.5} />
                  </button>
                  <span className="font-bold text-slate-700 dark:text-slate-200">
                    Página {page + 1} de {pageCount}
                  </span>
                  <button
                    disabled={page >= pageCount - 1}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50 cursor-pointer shadow-xs"
                  >
                    <IconChevronRight className="w-4 h-4" stroke={1.5} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* 5. MODAL RESOLUTIVO (CAPA Z-50 Y BACKDROP OSCURO) */}
      {selectedRecForModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in"
          onClick={() => setSelectedRecForModal(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col z-50"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Modal */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between bg-slate-50/60 dark:bg-slate-800/40">
              <div className="flex items-start gap-3">
                <span className="p-2 text-[#0078D4] bg-transparent">
                  <IconSparkles className="w-6 h-6" stroke={1.5} />
                </span>
                <div>
                  <h3 className="text-base font-bold text-[#1B2A41] dark:text-white">
                    {selectedRecForModal.titleTranslated}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Recurso:{" "}
                    <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                      {selectedRecForModal.resourceName}
                    </span>{" "}
                    (rg: {selectedRecForModal.resourceGroup})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedRecForModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 transition-colors cursor-pointer"
              >
                <IconX className="w-5 h-5" stroke={1.5} />
              </button>
            </div>

            {/* Contenido Modal */}
            <div className="p-5 flex flex-col gap-4 overflow-y-auto max-h-[70vh]">
              {/* Tarjeta de Ahorro / Amortización */}
              {selectedRecForModal.annualSavingsUSD > 0 && (
                <div className="p-4 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/50 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                      Impacto Económico Estimado
                    </span>
                    <div className="text-xl font-black text-emerald-700 dark:text-emerald-300 font-heading mt-0.5">
                      +{fmtUsd(selectedRecForModal.monthlySavingsUSD)} / mes
                    </div>
                    <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
                      Ahorro anual proyectado: {fmtUsd(selectedRecForModal.annualSavingsUSD)} USD/año
                    </div>
                  </div>
                  {selectedRecForModal.selectedTerm && (
                    <div className="text-right">
                      <span className="text-[11px] text-slate-400">Compromiso:</span>
                      <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        {selectedRecForModal.selectedTerm}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Explicación Técnica */}
              <div>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Descripción y Alcance:</span>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                  {selectedRecForModal.descriptionTranslated}
                </p>
              </div>

              {/* Pestañas de Comandos de Remediación */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setActiveCmdTab("cli")}
                      className={`text-xs font-bold px-3 py-1 rounded-lg border transition-all cursor-pointer ${
                        activeCmdTab === "cli"
                          ? "bg-[#0078D4] text-white border-[#0078D4]"
                          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600"
                      }`}
                    >
                      Azure CLI
                    </button>
                    <button
                      onClick={() => setActiveCmdTab("powershell")}
                      className={`text-xs font-bold px-3 py-1 rounded-lg border transition-all cursor-pointer ${
                        activeCmdTab === "powershell"
                          ? "bg-[#0078D4] text-white border-[#0078D4]"
                          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600"
                      }`}
                    >
                      PowerShell
                    </button>
                  </div>
                  <button
                    onClick={() =>
                      handleCopyCmd(
                        activeCmdTab === "cli"
                          ? selectedRecForModal.remediationCommand || ""
                          : selectedRecForModal.powerShellCommand || ""
                      )
                    }
                    className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0054A6] hover:bg-slate-50 cursor-pointer transition-all"
                  >
                    {copiedCmd ? (
                      <>
                        <IconCheck className="w-3.5 h-3.5 text-emerald-500" stroke={1.5} />
                        Copiado
                      </>
                    ) : (
                      <>
                        <IconCopy className="w-3.5 h-3.5" stroke={1.5} />
                        Copiar comando
                      </>
                    )}
                  </button>
                </div>

                {/* Bloque de Código */}
                <div className="p-3.5 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11.5px] overflow-x-auto border border-slate-800 leading-relaxed shadow-inner">
                  <pre>
                    {activeCmdTab === "cli"
                      ? selectedRecForModal.remediationCommand
                      : selectedRecForModal.powerShellCommand}
                  </pre>
                </div>
              </div>

              {snoozeMsg && (
                <div className="p-3 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold text-center">
                  {snoozeMsg}
                </div>
              )}
            </div>

            {/* Footer Modal con Acciones */}
            <div className="p-4 px-5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Posponer:</span>
                <button
                  onClick={() => handleSnooze(30)}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 cursor-pointer shadow-xs"
                >
                  30 días
                </button>
                <button
                  onClick={() => handleSnooze(90)}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 cursor-pointer shadow-xs"
                >
                  90 días
                </button>
              </div>

              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => setSelectedRecForModal(null)}
                  className="px-4 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 cursor-pointer shadow-xs"
                >
                  Cerrar
                </button>
                <button
                  onClick={() => {
                    handleCopyCmd(selectedRecForModal.remediationCommand || "");
                    alert("Comando copiado al portapapeles. Ejecútalo en Azure Cloud Shell o tu terminal.");
                  }}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 shadow-xs cursor-pointer transition-all"
                >
                  <IconSparkles className="w-3.5 h-3.5" stroke={1.5} />
                  Ejecutar Remediación
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
