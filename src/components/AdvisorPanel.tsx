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
  IconTrophy,
  IconClockPause,
  IconTool,
  IconDisc,
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

/**
 * Icono por tipo ARM real (`Microsoft.Compute/virtualMachines`), no por el nombre
 * comercial adivinado: el tipo llega parseado del Resource ID.
 */
function getResourceTypeIcon(resourceType?: string) {
  const t = (resourceType || "").toLowerCase();
  if (t.includes("virtualmachine") || t.includes("compute") || t.includes("scalesets")) {
    return <IconServer className="w-4 h-4 text-[#0078D4] dark:text-[#38BDF8] shrink-0" stroke={1.5} />;
  }
  if (t.includes("sql") || t.includes("database") || t.includes("cache") || t.includes("redis") || t.includes("cosmos") || t.includes("servers")) {
    return <IconDatabase className="w-4 h-4 text-[#0284C7] dark:text-sky-300 shrink-0" stroke={1.5} />;
  }
  if (t.includes("disk") || t.includes("snapshot")) {
    return <IconDisc className="w-4 h-4 text-[#2563EB] dark:text-blue-300 shrink-0" stroke={1.5} />;
  }
  if (t.includes("storage") || t.includes("blob") || t.includes("fileshare")) {
    return <IconFolder className="w-4 h-4 text-[#2563EB] dark:text-blue-300 shrink-0" stroke={1.5} />;
  }
  return <IconCloud className="w-4 h-4 text-[#0078D4] dark:text-[#38BDF8] shrink-0" stroke={1.5} />;
}

function getServiceIcon(serviceName?: string) {
  const s = (serviceName || "").toLowerCase();
  if (s.includes("virtual machine") || s.includes("vm") || s.includes("compute")) {
    return <IconServer className="w-4 h-4 text-[#0078D4] dark:text-[#38BDF8] shrink-0" stroke={1.5} />;
  }
  if (s.includes("database") || s.includes("sql") || s.includes("redis") || s.includes("cosmos")) {
    return <IconDatabase className="w-4 h-4 text-[#0284C7] dark:text-sky-300 shrink-0" stroke={1.5} />;
  }
  if (s.includes("storage") || s.includes("disk") || s.includes("blob")) {
    return <IconFolder className="w-4 h-4 text-[#2563EB] dark:text-blue-300 shrink-0" stroke={1.5} />;
  }
  return <IconCloud className="w-4 h-4 text-[#0078D4] dark:text-[#38BDF8] shrink-0" stroke={1.5} />;
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
  const [copiedGuid, setCopiedGuid] = useState<boolean>(false);
  const [copiedArmId, setCopiedArmId] = useState<string | null>(null);

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

  const fetchAdvisor = async (bustCache = false) => {
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
        `/api/advisor?tenantId=${selectedTenant.id}&locale=${encodeURIComponent(locale)}${subQuery}${bustCache ? "&bust=1" : ""}`,
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
      label: "Costos",
      icon: <IconCash className="w-4 h-4 text-[#0078D4] dark:text-[#38BDF8]" stroke={1.5} />,
      colorClass: "text-[#0078D4] dark:text-[#38BDF8]",
      borderActiveClass: "border-[#0078D4] dark:border-[#38BDF8] text-[#0078D4] dark:text-[#38BDF8]",
    },
    Security: {
      label: "Seguridad",
      icon: <IconShieldCheck className="w-4 h-4 text-[#2563EB] dark:text-blue-300" stroke={1.5} />,
      colorClass: "text-[#2563EB] dark:text-blue-300",
      borderActiveClass: "border-[#2563EB] dark:border-blue-400 text-[#2563EB] dark:text-blue-300",
    },
    HighAvailability: {
      label: "Alta Disponibilidad",
      icon: <IconWorldCheck className="w-4 h-4 text-[#0284C7] dark:text-sky-300" stroke={1.5} />,
      colorClass: "text-[#0284C7] dark:text-sky-300",
      borderActiveClass: "border-[#0284C7] dark:border-sky-400 text-[#0284C7] dark:text-sky-300",
    },
    Performance: {
      // En claro se usa el sky-700 corporativo: el #38BDF8 original daba 2.2:1
      // sobre blanco. En oscuro sí es el cian claro de alto contraste.
      icon: <IconGauge className="w-4 h-4 text-[#0369A1] dark:text-[#38BDF8]" stroke={1.5} />,
      label: "Rendimiento",
      colorClass: "text-[#0369A1] dark:text-[#38BDF8]",
      borderActiveClass: "border-[#0369A1] dark:border-[#38BDF8] text-[#0369A1] dark:text-[#38BDF8]",
    },
    OperationalExcellence: {
      label: "Excelencia Operativa",
      icon: <IconAdjustmentsCheck className="w-4 h-4 text-slate-600 dark:text-slate-300" stroke={1.5} />,
      colorClass: "text-slate-600 dark:text-slate-300",
      borderActiveClass: "border-slate-500 dark:border-slate-400 text-slate-700 dark:text-slate-200",
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

  const handleCopyTenantGuid = (guid: string) => {
    navigator.clipboard.writeText(guid);
    setCopiedGuid(true);
    setTimeout(() => setCopiedGuid(false), 2000);
  };

  const handleCopyArmId = (armId: string) => {
    navigator.clipboard.writeText(armId);
    setCopiedArmId(armId);
    setTimeout(() => setCopiedArmId(null), 2000);
  };

  const handleCopyCmd = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  /**
   * Quita la recomendación del estado local y descuenta su aporte a los KPIs del
   * pilar, para que el conteo y el ahorro se actualicen sin esperar el refetch.
   */
  const removeRecommendationLocally = (rec: AdvisorRecommendation) => {
    setAdvisorData((prev) => {
      if (!prev) return prev;
      const cat = rec.category;
      const remaining = (prev.recommendations[cat] || []).filter((r) => r.id !== rec.id);
      const pillar = prev.pillars[cat];
      return {
        ...prev,
        snoozedRecommendationsCount: (prev.snoozedRecommendationsCount || 0) + 1,
        recommendations: { ...prev.recommendations, [cat]: remaining },
        pillars: {
          ...prev.pillars,
          [cat]: {
            ...pillar,
            recommendationsCount: Math.max(0, (pillar?.recommendationsCount || 0) - 1),
            totalSavingsUSD: Number(
              Math.max(0, (pillar?.totalSavingsUSD || 0) - (rec.annualSavingsUSD || 0)).toFixed(2)
            ),
            totalMonthlySavingsUSD: Number(
              Math.max(0, (pillar?.totalMonthlySavingsUSD || 0) - (rec.monthlySavingsUSD || 0)).toFixed(2)
            ),
            highImpactCount: Math.max(0, (pillar?.highImpactCount || 0) - (rec.impact === "High" ? 1 : 0)),
            mediumImpactCount: Math.max(0, (pillar?.mediumImpactCount || 0) - (rec.impact === "Medium" ? 1 : 0)),
            lowImpactCount: Math.max(0, (pillar?.lowImpactCount || 0) - (rec.impact === "Low" ? 1 : 0)),
            activeResourcesCount: Math.max(0, (pillar?.activeResourcesCount || 0) - (rec.activeResources || 1)),
          },
        },
      };
    });
  };

  const handleSnooze = async (days: 30 | 90) => {
    const rec = selectedRecForModal;
    if (!rec) return;
    // Optimistic UI: se cierra el modal y la fila desaparece ya; si el backend
    // falla se revierte con un refetch y se avisa del error.
    setSelectedRecForModal(null);
    removeRecommendationLocally(rec);
    const until = new Date(Date.now() + days * 86400000);
    setSnoozeMsg(
      `Recomendación pospuesta por ${days} días. No se mostrará hasta el ${until.toLocaleDateString(locale)}.`
    );
    setTimeout(() => setSnoozeMsg(null), 6000);

    // Demo: la posposición se refleja en la sesión (no hay tenant real donde
    // persistirla) y no se llama al endpoint, que exige rol Admin/Owner.
    if (isMockTenant(selectedTenant?.id || "")) return;

    try {
      // El endpoint exige rol Admin/Owner del tenant: sin el Bearer devolvía 401
      // y la posposición nunca se persistía.
      const idToken = accounts.length ? await getFreshIdToken(instance, accounts[0]) : "";
      const res = await fetch("/api/advisor/suppress", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          tenantId: selectedTenant.id,
          // dedupKey es estable entre consultas; el id crudo de Advisor cambia
          // por suscripción y hacía que el filtro de posposición no matcheara.
          recommendationId: rec.dedupKey || rec.id,
          category: rec.category,
          resourceId: rec.resource?.rawId || rec.resourceId,
          snoozeDurationDays: days,
          reason: "Pospuesto desde el portal FinOps",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSnoozeMsg(
          json.error === "FORBIDDEN" || res.status === 403
            ? "No se pudo posponer: se requiere rol Admin u Owner del tenant."
            : `No se pudo posponer la recomendación: ${json.error || res.status}`
        );
        setTimeout(() => setSnoozeMsg(null), 6000);
        fetchAdvisor(true);
      }
    } catch (e) {
      console.error(e);
      setSnoozeMsg("No se pudo posponer la recomendación (fallo de red).");
      setTimeout(() => setSnoozeMsg(null), 6000);
      fetchAdvisor(true);
    }
  };

  const handleDismiss = async () => {
    const rec = selectedRecForModal;
    if (!rec) return;
    setSelectedRecForModal(null);
    removeRecommendationLocally(rec);
    setSnoozeMsg("Recomendación descartada permanentemente. No se mostrará en las recomendaciones activas.");
    setTimeout(() => setSnoozeMsg(null), 6000);

    if (isMockTenant(selectedTenant?.id || "")) return;

    try {
      const idToken = accounts.length ? await getFreshIdToken(instance, accounts[0]) : "";
      const res = await fetch("/api/advisor/suppress", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          tenantId: selectedTenant.id,
          recommendationId: rec.dedupKey || rec.id,
          category: rec.category,
          resourceId: rec.resource?.rawId || rec.resourceId,
          snoozeDurationDays: null,
          reason: "Descartado permanentemente desde el portal FinOps",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSnoozeMsg(
          json.error === "FORBIDDEN" || res.status === 403
            ? "No se pudo descartar: se requiere rol Admin u Owner del tenant."
            : `No se pudo descartar la recomendación: ${json.error || res.status}`
        );
        setTimeout(() => setSnoozeMsg(null), 6000);
        fetchAdvisor(true);
      }
    } catch (e) {
      console.error(e);
      setSnoozeMsg("No se pudo descartar la recomendación (fallo de red).");
      setTimeout(() => setSnoozeMsg(null), 6000);
      fetchAdvisor(true);
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
    return <div className="p-8 text-center text-slate-500 dark:text-slate-400">{tCommon("loading")}</div>;
  }

  const overallScore = advisorData?.overallScore ?? 64.6;
  // Nunca mostrar el GUID como nombre: si el backend no resolvió razón social se
  // usa el nombre del tenant del contexto activo.
  const tenantGuid = advisorData?.tenantGuid || selectedTenant.id;
  const looksLikeGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rawName = advisorData?.tenantName || "";
  const organizationName =
    rawName && !looksLikeGuid.test(rawName) ? rawName : selectedTenant.name || "Organización";

  return (
    <div className="w-full flex flex-col gap-6 animate-in fade-in">
      {/* 1. HEADER CORPORATIVO */}
      <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 text-[#0078D4] dark:text-[#38BDF8] bg-transparent">
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
          {/* El servicio devolvía `tenantName: tenantId`, así que acá se renderizaba
              el GUID de Entra ID. Ahora llega el nombre comercial y el GUID queda
              en un micro-badge con copiado rápido. */}
          <span className="inline-flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-50/80 dark:bg-slate-800 text-[#0078D4] dark:text-[#38BDF8] border border-blue-200 dark:border-slate-700 max-w-full">
            <span className="truncate max-w-[220px]" title={organizationName}>
              {organizationName}
            </span>
            {tenantGuid && (
              <button
                type="button"
                onClick={() => handleCopyTenantGuid(tenantGuid)}
                title={`Tenant ID de Entra ID: ${tenantGuid}`}
                aria-label="Copiar Tenant ID de Entra ID"
                className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-blue-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:text-[#0078D4] dark:hover:text-[#38BDF8] cursor-pointer transition-colors"
              >
                {copiedGuid ? <IconCheck size={13} stroke={1.5} className="text-emerald-500" /> : <IconCopy size={13} stroke={1.5} />}
                {tenantGuid.slice(0, 8)}…
              </button>
            )}
          </span>

          {/* Badge Advisor Score */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xs">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1B2A41] dark:text-white">
              <IconTrophy size={15} stroke={1.5} className="text-[#0078D4] dark:text-[#38BDF8]" />
              Advisor Score: <span className="text-[#0078D4] dark:text-[#38BDF8] font-black">{overallScore}%</span>
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
            <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Alcance:</span>
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
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-300 hover:bg-blue-50/50 dark:hover:bg-slate-800 shadow-xs cursor-pointer transition-all"
          >
            <IconDownload className="w-4 h-4" stroke={1.5} />
            Descargar como CSV
          </button>

          <button
            onClick={() => fetchAdvisor(true)}
            title="Refrescar datos"
            className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-300 hover:bg-blue-50/50 dark:hover:bg-slate-800 shadow-xs cursor-pointer transition-all"
          >
            <IconRotateClockwise className="w-4 h-4" stroke={1.5} />
          </button>
        </div>
      </div>

      {error === "MISSING_RBAC_ROLE" ? (
        <RoleAssignmentBanner />
      ) : error ? (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900 rounded-xl text-sm">{error}</div>
      ) : loading && !advisorData ? (
        <div className="p-12 text-center text-slate-500 dark:text-slate-400 animate-pulse text-sm">{tCommon("loading")}</div>
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
              // categoryDisplayName llega ya localizado desde el backend
              // (advisorI18n): evita mantener dos listas de etiquetas.
              const catLabel =
                (advisorData?.recommendations?.[cat] || [])[0]?.categoryDisplayName || meta.label;

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
                      <span>{catLabel}</span>
                    </div>
                    <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {count}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] mt-1 text-slate-500 dark:text-slate-400">
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
                  <div className="p-3 text-[#0078D4] dark:text-[#38BDF8] bg-transparent">
                    <IconPigMoney className="w-8 h-8" stroke={1.5} />
                  </div>
                  <div>
                    <span className="text-[11px] uppercase font-bold tracking-wider text-slate-400">
                      Ahorro Potencial Total (Costo)
                    </span>
                    <div className="text-2xl font-black text-[#0078D4] dark:text-[#38BDF8] font-heading leading-tight mt-0.5">
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
                <div className="p-3 bg-transparent">
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
                <div className="p-3 text-[#0078D4] dark:text-[#38BDF8] bg-transparent">
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
                  <IconFilter className="w-4 h-4 text-[#0078D4] dark:text-[#38BDF8]" stroke={1.5} />
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
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
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
                <div className="p-12 text-center text-slate-500 dark:text-slate-400 text-xs">
                  <IconCheck size={20} stroke={1.5} className="inline mr-1.5 text-emerald-500" />
                  No se encontraron recomendaciones con los filtros seleccionados.
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

                      const armId = rec.resource?.rawId || rec.resourceId || "";
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
                              <span className="p-1 bg-transparent mt-0.5">
                                {getServiceIcon(rec.serviceName)}
                              </span>
                              <div>
                                <div className="font-bold text-[#1B2A41] dark:text-white leading-snug">
                                  {rec.titleTranslated}
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-1">
                                  {rec.descriptionTranslated}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Columna Recurso — nombre legible + grupo real; el ARM ID
                              completo vive en el tooltip con botón de copiado. */}
                          <td className="p-3.5 align-top">
                            <div className="flex items-center gap-1.5">
                              {getResourceTypeIcon(rec.resource?.resourceType || rec.serviceName)}
                              <span className="font-bold text-slate-900 dark:text-white font-mono text-[11.5px] truncate max-w-[220px]">
                                {rec.resourceName || "—"}
                              </span>
                              {armId && (
                                <button
                                  type="button"
                                  onClick={() => handleCopyArmId(armId)}
                                  title={armId}
                                  aria-label="Copiar Resource ID completo de Azure"
                                  className="shrink-0 p-0.5 rounded text-slate-400 hover:text-[#0078D4] dark:hover:text-[#38BDF8] cursor-pointer transition-colors"
                                >
                                  {copiedArmId === armId ? (
                                    <IconCheck size={12} stroke={1.5} className="text-emerald-500" />
                                  ) : (
                                    <IconCopy size={12} stroke={1.5} />
                                  )}
                                </button>
                              )}
                            </div>
                            <div className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                              rg:{" "}
                              <span className="font-mono text-slate-700 dark:text-slate-300">
                                {rec.resource?.resourceGroup || rec.resourceGroup || "—"}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                              sub: <span className="text-slate-500 dark:text-slate-400">{rec.subscriptionName}</span>
                            </div>
                          </td>

                          {/* Columna Impacto */}
                          <td className="p-3.5 align-top">
                            <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-md border ${impactColor}`}>
                              {rec.impactDisplayName ||
                                (rec.impact === "High" ? "Alto" : rec.impact === "Medium" ? "Medio" : "Bajo")}
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
                              <span className="text-slate-400 dark:text-slate-500 text-[11px]">Estándar</span>
                            )}
                          </td>

                          {/* Columna Ahorro */}
                          <td className="p-3.5 align-top">
                            {rec.annualSavingsUSD > 0 ? (
                              <div>
                                <div className="font-black text-emerald-600 dark:text-emerald-400 font-heading">
                                  +{fmtUsd(rec.monthlySavingsUSD)} <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400">/ mes</span>
                                </div>
                                <div className="text-[10.5px] text-slate-500 dark:text-slate-400 font-semibold">
                                  {fmtUsd(rec.annualSavingsUSD)} / año
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500 text-[11px]">—</span>
                            )}
                          </td>

                          {/* Columna Acción Resolutiva */}
                          <td className="p-3.5 align-top whitespace-nowrap">
                            <button
                              onClick={() => {
                                setSelectedRecForModal(rec);
                                setActiveCmdTab("cli");
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-slate-800 transition-all shadow-xs cursor-pointer"
                            >
                              <IconSparkles className="w-3.5 h-3.5" stroke={1.5} />
                              {rec.actionType === "PURCHASE_RESERVATION"
                                ? "Simular Reserva"
                                : rec.actionType === "APPLY_AHUB"
                                ? "Activar AHUB"
                                : "Optimizar"}
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

      {/* Toast de posposición (z-[100]: por encima del modal y del copiloto) */}
      {snoozeMsg && (
        <div className="fixed bottom-6 right-6 z-[100] max-w-sm p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-blue-200 dark:border-slate-700 shadow-2xl text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-start gap-2 animate-in fade-in slide-in-from-bottom-2">
          <IconClockPause size={16} stroke={1.5} className="text-[#0078D4] dark:text-[#38BDF8] shrink-0 mt-0.5" />
          <span>{snoozeMsg}</span>
        </div>
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
                <span className="p-2 text-[#0078D4] dark:text-[#38BDF8] bg-transparent">
                  <IconSparkles className="w-6 h-6" stroke={1.5} />
                </span>
                <div>
                  <h3 className="text-base font-bold text-[#1B2A41] dark:text-white">
                    {selectedRecForModal.titleTranslated}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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
                className="p-1 rounded-lg text-slate-400 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-slate-700/60 transition-colors cursor-pointer"
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
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">Compromiso:</span>
                      <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        {selectedRecForModal.selectedTerm}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Acción sintetizada para ESTE recurso (antes las recomendaciones
                  sin rama propia mostraban "gestión de etiquetas"). */}
              {selectedRecForModal.aiSuggestedAction && (
                <div className="p-4 rounded-xl border border-blue-200 dark:border-slate-700 bg-blue-50/50 dark:bg-slate-800/60">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <IconTool size={18} stroke={1.5} className="text-[#0078D4] dark:text-[#38BDF8] shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#1B2A41] dark:text-white">
                          {selectedRecForModal.aiSuggestedAction.actionTitle}
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                          {selectedRecForModal.aiSuggestedAction.actionDescription}
                        </p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-blue-200 dark:border-slate-700 text-[#0078D4] dark:text-[#38BDF8]">
                            {selectedRecForModal.aiSuggestedAction.actionType}
                          </span>
                          {selectedRecForModal.aiSuggestedAction.targetSku && (
                            <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                              SKU destino: {selectedRecForModal.aiSuggestedAction.targetSku}
                            </span>
                          )}
                          {selectedRecForModal.resource?.resourceType && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                              {selectedRecForModal.resource.resourceType}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveCmdTab("cli");
                        handleCopyCmd(selectedRecForModal.remediationCommand || "");
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-[#0078D4] text-white border border-[#0078D4] hover:bg-[#0060AA] dark:text-white shadow-xs cursor-pointer transition-all shrink-0"
                    >
                      <IconTool size={14} stroke={1.5} className="text-white" />
                      Aplicar Optimización
                    </button>
                  </div>
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
                          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200"
                      }`}
                    >
                      Azure CLI
                    </button>
                    <button
                      onClick={() => setActiveCmdTab("powershell")}
                      className={`text-xs font-bold px-3 py-1 rounded-lg border transition-all cursor-pointer ${
                        activeCmdTab === "powershell"
                          ? "bg-[#0078D4] text-white border-[#0078D4]"
                          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200"
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
                    className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0054A6] dark:text-blue-300 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition-all"
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

            </div>

            {/* Footer Modal con Acciones */}
            <div className="p-4 px-5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">Posponer:</span>
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
                <span className="text-slate-300 dark:text-slate-700 mx-0.5">|</span>
                <button
                  onClick={handleDismiss}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer shadow-xs"
                >
                  Descartar
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
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] dark:border-blue-400 text-[#0054A6] dark:text-blue-300 hover:bg-blue-50/50 dark:hover:bg-slate-800 shadow-xs cursor-pointer transition-all"
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
