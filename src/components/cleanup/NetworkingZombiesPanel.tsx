"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import useSWR from "swr";
import {
  IconRoute,
  IconTrash,
  IconPigMoney,
  IconSearch,
  IconColumns,
  IconShieldCheck,
  IconShieldX,
  IconSparkles,
  IconInfoCircle,
  IconRefresh,
  IconServer,
  IconWorld,
  IconNetwork,
  IconShieldLock,
  IconPoint,
  IconCheck,
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import ResizableTh from "@/components/ResizableTh";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  NetworkZombieResourceItem,
  PrivateEndpointDetailItem,
  NetworkingZombiesSummary,
  TableColumnConfig,
} from "@/types/azureNetworkingZombies.types";
import { errorMessage } from "@/lib/apiErrors";

const DEFAULT_COLUMNS: TableColumnConfig[] = [
  { key: "resource", label: "Recurso de Red", isVisible: true, widthPx: 260 },
  { key: "subscription", label: "Suscripción", isVisible: true, widthPx: 200 },
  { key: "region", label: "Región", isVisible: true, widthPx: 120 },
  { key: "type", label: "Tipo de Recurso", isVisible: true, widthPx: 180 },
  { key: "resourceGroup", label: "Grupo de Recursos", isVisible: true, widthPx: 180 },
  { key: "reason", label: "Diagnóstico / Motivo", isVisible: true, widthPx: 280 },
  { key: "idleDays", label: "Inactividad", isVisible: true, widthPx: 110 },
  { key: "monthlyCost", label: "Costo Mensual", isVisible: true, widthPx: 130 },
  { key: "actions", label: "Acciones", isVisible: true, widthPx: 200 },
];

function getNetworkIcon(type: string) {
  const t = String(type).toLowerCase();
  if (t.includes("gateway") || t.includes("vpn") || t.includes("expressroute")) {
    return <IconRoute size={16} stroke={1.5} className="text-[#0078D4] shrink-0" />;
  }
  if (t.includes("publicip") || t.includes("ip")) {
    return <IconWorld size={16} stroke={1.5} className="text-[#0078D4] shrink-0" />;
  }
  if (t.includes("privateendpoint")) {
    return <IconPoint size={16} stroke={1.5} className="text-[#0078D4] shrink-0" />;
  }
  if (t.includes("natgateway")) {
    return <IconServer size={16} stroke={1.5} className="text-[#0078D4] shrink-0" />;
  }
  if (t.includes("firewall") || t.includes("waf")) {
    return <IconShieldLock size={16} stroke={1.5} className="text-[#0078D4] shrink-0" />;
  }
  return <IconNetwork size={16} stroke={1.5} className="text-[#0078D4] shrink-0" />;
}

export default function NetworkingZombiesPanel() {
  const t = useTranslations("NetworkingZombies");
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || "demo_tenant";
  const isMock = isMockTenant(tenantId);
  const { instance, accounts } = useMsal();

  // Sin este header toda petición cae en el 401 de `requireTenantAccess` /
  // `requireTenantRole`: los guards de `requestAuth` sólo leen
  // `Authorization: Bearer`, no hay cookie de sesión de respaldo. Los tenants
  // demo no lo necesitan porque la ruta corta antes del guard.
  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (isMock || accounts.length === 0) return {};
    try {
      const token = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }, [instance, accounts, isMock]);

  // Columnas con persistencia en localStorage
  const storageKey = `table_columns_config_networking_zombies_${tenantId}`;
  const [columns, setColumns] = useState<TableColumnConfig[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {
        // Ignorar error de parsing
      }
    }
    return DEFAULT_COLUMNS;
  });

  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(storageKey, JSON.stringify(columns));
      } catch {
        // Ignorar
      }
    }
  }, [columns, storageKey]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setShowColumnMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleColumnVisibility = (key: string) => {
    setColumns((prev) =>
      prev.map((c) => (c.key === key ? { ...c, isVisible: !c.isVisible } : c))
    );
  };

  const isColVisible = (key: string) => columns.find((c) => c.key === key)?.isVisible ?? true;

  // Filtros
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [rgFilter, setRgFilter] = useState("all");
  const [subFilter, setSubFilter] = useState("all");
  type NetZombieSort = "cost_desc" | "cost_asc" | "idle_desc" | "name_asc" | "name_desc";
  const [sortBy, setSortBy] = useState<NetZombieSort>("cost_desc");

  // Selección individual / masiva
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modales
  const [remediatingItem, setRemediatingItem] = useState<NetworkZombieResourceItem | null>(null);
  const [exemptingItem, setExemptingItem] = useState<NetworkZombieResourceItem | null>(null);
  const [exemptionReason, setExemptionReason] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showPrivateEndpointsSection, setShowPrivateEndpointsSection] = useState(true);

  // Fetcher SWR
  const apiUrl = `/api/cleanup/zombies/networking?tenantId=${encodeURIComponent(tenantId)}${
    isMock ? "&mock=true" : ""
  }`;

  const { data, isLoading, mutate } = useSWR<{
    success: boolean;
    metrics: NetworkingZombiesSummary;
  }>(apiUrl, async (url: string) => {
    const res = await fetch(url, { headers: await authHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }, {
    revalidateOnFocus: false,
  });

  const metrics = data?.metrics || {
    totalScannedCount: 0,
    totalWasteMonthlyUSD: 0,
    totalWasteAnnualUSD: 0,
    activePrivateEndpointsCount: 0,
    privateEndpointsMonthlyCostUSD: 0,
    zombies: [],
    privateEndpoints: [],
  };

  // Opciones de filtros derivados
  const regionOptions = useMemo(() => {
    const set = new Set<string>();
    metrics.zombies.forEach((z: NetworkZombieResourceItem) => {
      if (z.location) set.add(z.location);
    });
    return Array.from(set).sort();
  }, [metrics.zombies]);

  const rgOptions = useMemo(() => {
    const set = new Set<string>();
    metrics.zombies.forEach((z: NetworkZombieResourceItem) => {
      if (z.resourceGroup) set.add(z.resourceGroup);
    });
    return Array.from(set).sort();
  }, [metrics.zombies]);

  const subOptions = useMemo(() => {
    const map = new Map<string, string>();
    metrics.zombies.forEach((z: NetworkZombieResourceItem) => {
      if (z.subscriptionId) map.set(z.subscriptionId, z.subscriptionName || z.subscriptionId);
    });
    return Array.from(map.entries());
  }, [metrics.zombies]);

  // Filtrado y Ordenamiento
  const filteredZombies = useMemo(() => {
    let list = [...metrics.zombies];

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (z) =>
          z.name.toLowerCase().includes(q) ||
          z.id.toLowerCase().includes(q) ||
          z.detectionReason.toLowerCase().includes(q)
      );
    }

    if (typeFilter !== "all") {
      list = list.filter((z) => z.zombieType === typeFilter);
    }

    if (regionFilter !== "all") {
      list = list.filter((z) => z.location === regionFilter);
    }

    if (rgFilter !== "all") {
      list = list.filter((z) => z.resourceGroup === rgFilter);
    }

    if (subFilter !== "all") {
      list = list.filter((z) => z.subscriptionId === subFilter);
    }

    list.sort((a, b) => {
      if (sortBy === "cost_desc") return b.monthlyCostUSD - a.monthlyCostUSD;
      if (sortBy === "cost_asc") return a.monthlyCostUSD - b.monthlyCostUSD;
      if (sortBy === "idle_desc") return b.idleDays - a.idleDays;
      if (sortBy === "name_asc") return a.name.localeCompare(b.name);
      if (sortBy === "name_desc") return b.name.localeCompare(a.name);
      return 0;
    });

    return list;
  }, [metrics.zombies, search, typeFilter, regionFilter, rgFilter, subFilter, sortBy]);

  // Paginación
  const {
    page,
    pageSize,
    setPage,
    setPageSize,
    totalPages,
    total,
    paged: pagedZombies,
  } = usePagination(filteredZombies, 15);

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllPage = () => {
    const pageIds = pagedZombies.map((z: NetworkZombieResourceItem) => z.id);
    const allSelected = pageIds.every((id: string) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        pageIds.forEach((id: string) => next.delete(id));
      } else {
        pageIds.forEach((id: string) => next.add(id));
      }
      return next;
    });
  };

  // Acciones: Eximir
  const handleSaveExemption = async () => {
    if (!exemptingItem) return;
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/cleanup/zombies/networking?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          action: "exempt",
          resourceId: exemptingItem.id,
          resourceName: exemptingItem.name,
          reason: exemptionReason.trim() || t("defaultExemptReason"),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t("exemptSaveFailed"));
      }
      toast.success("Recurso eximido correctamente");
      setExemptingItem(null);
      setExemptionReason("");
      mutate();
    } catch (e) {
      toast.error(errorMessage(e) || "Error al eximir recurso");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemoveExemption = async (item: NetworkZombieResourceItem) => {
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/cleanup/zombies/networking?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          action: "remove_exemption",
          resourceId: item.id,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t("exemptRemoveFailed"));
      }
      toast.success(t("exemptRemovedOk"));
      mutate();
    } catch (e) {
      toast.error(errorMessage(e) || t("exemptRemoveError"));
    } finally {
      setIsProcessing(false);
    }
  };

  // Acciones: Remediar / Purgar
  const handleConfirmRemediation = async () => {
    if (!remediatingItem) return;
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/remediation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          tenantId,
          // `domain` es obligatorio y fail-closed en /api/remediation: sin él la
          // ruta no puede resolver el tier mínimo y rechaza con 400.
          domain: "networking",
          resourceId: remediatingItem.id,
          resourceType: remediatingItem.resourceType,
          // deleteResource usa el SDK tipado para discos, NICs e IPs públicas y
          // necesita estos tres por separado; el ARM ID solo alcanza para el
          // fallback REST genérico.
          subscriptionId: remediatingItem.subscriptionId,
          resourceGroup: remediatingItem.resourceGroup,
          resourceName: remediatingItem.name,
          action: "DELETE",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t("remediateFailed"));
      }
      toast.success(`Recurso ${remediatingItem.name} remediado exitosamente`);
      setRemediatingItem(null);
      mutate();
    } catch (e) {
      toast.error(errorMessage(e) || t("remediateError"));
    } finally {
      setIsProcessing(false);
    }
  };

  const money = (val: number) =>
    `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="w-full max-w-full space-y-6">
      {/* Banner Superior Informativo de Private Endpoints (100% Ancho) */}
      <div className="w-full bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition">
        <div className="flex items-start gap-3">
          <IconInfoCircle size={20} className="text-[#0078D4] shrink-0 mt-0.5" stroke={1.5} />
          <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
            <span className="font-bold text-[#1B2A41] dark:text-white">
              {t("peAccumulationLabel")}
            </span>{" "}
            Se detectaron{" "}
            <span className="font-semibold text-[#0054A6] dark:text-blue-400">
              {metrics.activePrivateEndpointsCount} Private Endpoints
            </span>{" "}
            activos en el tenant con un costo fijo acumulado de{" "}
            <span className="font-semibold text-[#0054A6] dark:text-blue-400">
              {money(metrics.privateEndpointsMonthlyCostUSD)}/mes
            </span>{" "}
            ($7.20/mes c/u). Consolide o desactive endpoints no utilizados para evitar gasto ocioso.
          </div>
        </div>
        <button
          onClick={() => setShowPrivateEndpointsSection((prev) => !prev)}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 font-semibold text-xs hover:bg-blue-50/50 transition cursor-pointer"
        >
          {showPrivateEndpointsSection ? (
            <>
              {t("hideDetail")} <IconChevronUp size={14} />
            </>
          ) : (
            <>
              Ver Detalle ({metrics.privateEndpoints.length}) <IconChevronDown size={14} />
            </>
          )}
        </button>
      </div>

      {/* Sección Plegable: Detalle de Private Endpoints (100% Ancho) */}
      {showPrivateEndpointsSection && metrics.privateEndpoints.length > 0 && (
        <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-6 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconPoint size={18} className="text-[#0078D4]" stroke={1.5} />
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                {t("peFullDetailTitle")}
              </h3>
              <InfoTooltip content={t("peFullDetailTip")} />
            </div>
            <span className="text-xs text-slate-500 font-medium">
              Total: {metrics.privateEndpoints.length} endpoints ({money(metrics.privateEndpointsMonthlyCostUSD)}/mes)
            </span>
          </div>

          <div className="w-full overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/75 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("peColEndpointName")}</th>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("peColResourceGroup")}</th>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("peColSubscription")}</th>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("peColState")}</th>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("peColCost")}</th>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200 text-right">{t("colAction")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {metrics.privateEndpoints.map((pe: PrivateEndpointDetailItem) => (
                  <tr key={pe.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition">
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <IconPoint size={14} className="text-[#0078D4] shrink-0" stroke={1.5} />
                        <span className="font-bold text-[#1B2A41] dark:text-slate-100 break-words" title={pe.name}>
                          {pe.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 break-words">{pe.resourceGroup}</td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 break-words">{pe.subscriptionName}</td>
                    <td className="py-2.5 px-3">
                      {pe.connectionStatus === "Connected" ? (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-[#0078D4] border border-blue-200 dark:bg-blue-950/40 dark:border-blue-800">
                          {t("peStateConnected")}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-800">
                          {pe.connectionStatus === "Rejected" ? t("peStateRejected") : t("peStateOrphan")}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-100">
                      {money(pe.monthlyCostUSD)}/mes
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {pe.connectionStatus !== "Connected" ? (
                        <button
                          onClick={() => {
                            setRemediatingItem({
                              id: pe.id,
                              name: pe.name,
                              resourceType: "microsoft.network/privateendpoints",
                              zombieType: "PRIVATE_ENDPOINT_ORPHAN",
                              location: "global",
                              resourceGroup: pe.resourceGroup,
                              subscriptionId: pe.subscriptionId,
                              subscriptionName: pe.subscriptionName,
                              idleDays: 30,
                              detectionReason: "Private Endpoint desconectado / rechazado",
                              monthlyCostUSD: pe.monthlyCostUSD,
                              isExempted: false,
                            });
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-rose-700 dark:text-rose-400 bg-white dark:bg-slate-900 border border-rose-300 hover:bg-rose-50/50 rounded-md transition cursor-pointer"
                        >
                          <IconTrash size={13} className="text-rose-600" /> {t("purge")}
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400">{t("inUse")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* KPI Cards Superiores (100% Ancho - 3 Tarjetas en Tonos de Azul) */}
      <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {t("kpiDetected")}
              </span>
              <InfoTooltip content={t("kpiDetectedTip")} />
            </div>
            <div className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
              {metrics.totalScannedCount}
            </div>
            <div className="text-[11px] text-slate-400">{t("kpiDetectedSubtext")}</div>
          </div>
          <IconRoute size={32} stroke={1.5} className="text-[#0078D4] bg-transparent" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {t("kpiWaste")}
              </span>
              <InfoTooltip content={t("kpiWasteTip")} />
            </div>
            <div className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
              {money(metrics.totalWasteMonthlyUSD)}
            </div>
            <div className="text-[11px] text-rose-600 font-semibold">{t("kpiWasteSubtext")}</div>
          </div>
          <IconTrash size={32} stroke={1.5} className="text-[#0078D4] bg-transparent" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {t("kpiSavings")}
              </span>
              <InfoTooltip content={t("kpiSavingsTip")} />
            </div>
            <div className="text-2xl font-bold text-[#0054A6] dark:text-blue-400 font-['Montserrat']">
              {money(metrics.totalWasteAnnualUSD)}
            </div>
            <div className="text-[11px] text-emerald-600 font-semibold">{t("kpiSavingsSubtext")}</div>
          </div>
          <IconPigMoney size={32} stroke={1.5} className="text-[#0078D4] bg-transparent" />
        </div>
      </div>

      {/* Barra de Herramientas, Búsqueda y Selector de Columnas (100% Ancho) */}
      <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Buscador */}
          <div className="relative flex-1 min-w-[240px]">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
            />
          </div>

          {/* Filtros */}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">{t("allTypes")}</option>
              <option value="VPN_GATEWAY">{t("typeVpnGw")}</option>
              <option value="EXPRESSROUTE_GATEWAY">{t("typeErGw")}</option>
              <option value="PUBLIC_IP_UNATTACHED">{t("typeOrphanIps")}</option>
              <option value="PRIVATE_ENDPOINT_ORPHAN">{t("typeOrphanPe")}</option>
              <option value="NAT_GATEWAY_EMPTY">{t("typeEmptyNat")}</option>
              <option value="APP_GATEWAY_EMPTY">{t("typeAppGwFw")}</option>
              <option value="PLATFORM_WATCHER">{t("typeWatchers")}</option>
            </select>

            {regionOptions.length > 0 && (
              <select
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none"
              >
                <option value="all">{t("allRegions")}</option>
                {regionOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}

            {rgOptions.length > 0 && (
              <select
                value={rgFilter}
                onChange={(e) => setRgFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none"
              >
                <option value="all">{t("allResourceGroups")}</option>
                {rgOptions.map((rg) => (
                  <option key={rg} value={rg}>
                    {rg}
                  </option>
                ))}
              </select>
            )}

            {subOptions.length > 0 && (
              <select
                value={subFilter}
                onChange={(e) => setSubFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none"
              >
                <option value="all">{t("allSubscriptions")}</option>
                {subOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            )}

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as NetZombieSort)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none font-medium"
            >
              <option value="cost_desc">{t("sortCostDesc")}</option>
              <option value="cost_asc">{t("sortCostAsc")}</option>
              <option value="idle_desc">{t("sortIdleDesc")}</option>
              <option value="name_asc">{t("sortNameAsc")}</option>
              <option value="name_desc">{t("sortNameDesc")}</option>
            </select>

            {/* Selector de Visibilidad de Columnas */}
            <div className="relative" ref={columnMenuRef}>
              <button
                onClick={() => setShowColumnMenu((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 font-semibold text-xs hover:bg-blue-50/50 transition cursor-pointer"
              >
                <IconColumns size={16} stroke={1.5} className="text-[#0078D4]" />
                {t("customizeColumns")}
              </button>

              {showColumnMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-[100] p-3 space-y-2">
                  <div className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-2">
                    {t("columnVisibility")}
                  </div>
                  <div className="space-y-1.5 max-h-60 overflow-y-auto">
                    {columns.map((col) => (
                      <label
                        key={col.key}
                        className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 p-1.5 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={col.isVisible}
                          onChange={() => toggleColumnVisibility(col.key)}
                          className="rounded text-[#0054A6] cursor-pointer"
                        />
                        <span>{t(`col_${col.key}`)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => mutate()}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 font-semibold text-xs hover:bg-slate-50 transition cursor-pointer"
              title={t("refreshTooltip")}
            >
              <IconRefresh size={16} className={isLoading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Banner de Selección Múltiple */}
        {selectedIds.size > 0 && (
          <div className="w-full bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-3 flex items-center justify-between text-xs">
            <span className="font-bold text-[#0078D4]">
              {selectedIds.size} recurso(s) de red seleccionado(s)
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 hover:underline cursor-pointer"
              >
                {t("clearSelection")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tabla "Recursos de Red Zombies" (100% Ancho, Redimensionable, macOS Scroll) */}
      <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
        <div className="w-full overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50/80 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-3 px-3 w-10">
                  <input
                    type="checkbox"
                    checked={pagedZombies.length > 0 && pagedZombies.every((z: NetworkZombieResourceItem) => selectedIds.has(z.id))}
                    onChange={toggleSelectAllPage}
                    className="rounded text-[#0054A6] cursor-pointer"
                  />
                </th>

                {isColVisible("resource") && (
                  <ResizableTh minWidth={200} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_resource")}
                  </ResizableTh>
                )}

                {isColVisible("subscription") && (
                  <ResizableTh minWidth={150} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_subscription")}
                  </ResizableTh>
                )}

                {isColVisible("region") && (
                  <ResizableTh minWidth={100} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_region")}
                  </ResizableTh>
                )}

                {isColVisible("type") && (
                  <ResizableTh minWidth={140} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_type")}
                  </ResizableTh>
                )}

                {isColVisible("resourceGroup") && (
                  <ResizableTh minWidth={140} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_resourceGroup")}
                  </ResizableTh>
                )}

                {isColVisible("reason") && (
                  <ResizableTh minWidth={220} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_reason")}
                  </ResizableTh>
                )}

                {isColVisible("idleDays") && (
                  <ResizableTh minWidth={100} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_idleDays")}
                  </ResizableTh>
                )}

                {isColVisible("monthlyCost") && (
                  <ResizableTh minWidth={120} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_monthlyCost")}
                  </ResizableTh>
                )}

                {isColVisible("actions") && (
                  <ResizableTh minWidth={180} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 text-right">
                    {t("col_actions")}
                  </ResizableTh>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading ? (
                <tr>
                  <td colSpan={columns.filter((c) => c.isVisible).length + 1} className="py-12 text-center text-slate-400">
                    <div className="flex items-center justify-center gap-2">
                      <IconRefresh className="animate-spin text-[#0078D4]" size={20} />
                      <span>{t("loadingScan")}</span>
                    </div>
                  </td>
                </tr>
              ) : pagedZombies.length === 0 ? (
                <tr>
                  <td colSpan={columns.filter((c) => c.isVisible).length + 1} className="py-12 text-center text-slate-400">
                    {t("emptyFiltered")}
                  </td>
                </tr>
              ) : (
                pagedZombies.map((res: NetworkZombieResourceItem) => {
                  const isChecked = selectedIds.has(res.id);

                  return (
                    <tr
                      key={res.id}
                      className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition ${
                        isChecked ? "bg-blue-50/30 dark:bg-blue-950/20" : ""
                      }`}
                    >
                      <td className="py-3 px-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectOne(res.id)}
                          className="rounded text-[#0054A6] cursor-pointer"
                        />
                      </td>

                      {isColVisible("resource") && (
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            {getNetworkIcon(res.zombieType)}
                            <div className="min-w-0">
                              <div
                                className="font-bold text-[#1B2A41] dark:text-slate-100 break-words whitespace-normal leading-snug"
                                title={res.name}
                              >
                                {res.name}
                              </div>
                            </div>
                          </div>
                        </td>
                      )}

                      {isColVisible("subscription") && (
                        <td className="py-3 px-4">
                          <span
                            className="font-semibold text-slate-600 dark:text-slate-300 block break-words whitespace-normal"
                            title={res.subscriptionName}
                          >
                            {res.subscriptionName?.toLowerCase() === "ec03e8ce-ceee-4638-b303-64ae431d5b1e"
                              ? "CSCS-LandingZone"
                              : (res.subscriptionName || "Azure")}
                          </span>
                        </td>
                      )}

                      {isColVisible("region") && (
                        <td className="py-3 px-4 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                          {res.location}
                        </td>
                      )}

                      {isColVisible("type") && (
                        <td className="py-3 px-4">
                          <span className="text-xs text-slate-700 dark:text-slate-300 font-medium break-words whitespace-normal">
                            {res.zombieType.replace(/_/g, " ")}
                          </span>
                        </td>
                      )}

                      {isColVisible("resourceGroup") && (
                        <td className="py-3 px-4">
                          <span
                            className="text-slate-600 dark:text-slate-300 block break-words whitespace-normal"
                            title={res.resourceGroup}
                          >
                            {res.resourceGroup}
                          </span>
                        </td>
                      )}

                      {isColVisible("reason") && (
                        <td className="py-3 px-4">
                          <span
                            className="text-slate-600 dark:text-slate-300 text-xs break-words whitespace-normal block"
                            title={res.detectionReason}
                          >
                            {res.detectionReason}
                          </span>
                        </td>
                      )}

                      {isColVisible("idleDays") && (
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300 font-mono text-xs whitespace-nowrap">
                          {res.idleDays > 0 ? `${res.idleDays}d` : "—"}
                        </td>
                      )}

                      {isColVisible("monthlyCost") && (
                        <td className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-100 whitespace-nowrap">
                          {res.monthlyCostUSD > 0 ? `${money(res.monthlyCostUSD)}/mes` : "$0.00"}
                        </td>
                      )}

                      {isColVisible("actions") && (
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            {res.isExempted ? (
                              <button
                                onClick={() => handleRemoveExemption(res)}
                                disabled={isProcessing}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 transition cursor-pointer"
                                title={t("removeExemptionTooltip")}
                              >
                                <IconShieldX size={13} className="text-slate-500" /> {t("removeExemption")}
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => setRemediatingItem(res)}
                                  disabled={isProcessing}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition cursor-pointer"
                                  title={t("remediateTooltip")}
                                >
                                  <IconSparkles size={14} stroke={1.5} className="text-[#0078D4]" />
                                  {t("remediate")}
                                </button>
                                <button
                                  onClick={() => {
                                    setExemptingItem(res);
                                    setExemptionReason("");
                                  }}
                                  disabled={isProcessing}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 transition cursor-pointer"
                                  title={t("exemptTooltip")}
                                >
                                  <IconShieldCheck size={13} />
                                  {t("exempt")}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación Estándar CMP */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <Pagination
            page={page}
            setPage={setPage}
            pageSize={pageSize}
            setPageSize={setPageSize}
            total={total}
            totalPages={totalPages}
            pageSizes={[15, 30, 45, 60]}
          />
        </div>
      </div>

      {/* Modal de Confirmación de Remediación (z-[100]) */}
      {remediatingItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[100]">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-[#1B2A41] dark:text-slate-100">
              <IconAlertTriangle size={22} className="text-amber-500" stroke={1.5} />
              <h3 className="text-base font-bold font-['Montserrat']">
                {t("remediateModalTitle")}
              </h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {t("remediateModalBody")}
            </p>

            <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl space-y-1.5 text-xs border border-slate-200 dark:border-slate-700">
              <div>
                <span className="font-semibold text-slate-500">{t("fieldResource")}</span>{" "}
                <span className="font-bold text-[#1B2A41] dark:text-slate-100 break-all">{remediatingItem.name}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-500">{t("fieldType")}</span>{" "}
                <span className="text-slate-700 dark:text-slate-300">{remediatingItem.zombieType}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-500">{t("fieldSubscription")}</span>{" "}
                <span className="text-slate-700 dark:text-slate-300">{remediatingItem.subscriptionName}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-500">{t("fieldMonthlySavings")}</span>{" "}
                <span className="font-bold text-emerald-600">{money(remediatingItem.monthlyCostUSD)}/mes</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setRemediatingItem(null)}
                disabled={isProcessing}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 cursor-pointer"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleConfirmRemediation}
                disabled={isProcessing}
                className="px-4 py-2 text-xs font-bold rounded-lg border border-rose-600 text-white bg-rose-600 hover:bg-rose-700 shadow-sm cursor-pointer inline-flex items-center gap-1.5"
              >
                {isProcessing ? <IconRefresh className="animate-spin" size={14} /> : <IconTrash size={14} />}
                {t("confirmDelete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Exención Persistente en MySQL (z-[100]) */}
      {exemptingItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[100]">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-[#1B2A41] dark:text-slate-100">
              <IconShieldCheck size={22} className="text-[#0078D4]" stroke={1.5} />
              <h3 className="text-base font-bold font-['Montserrat']">
                {t("exemptModalTitle")}
              </h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {t("exemptModalBody")}
            </p>

            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl text-xs space-y-1 border border-slate-200 dark:border-slate-700">
              <span className="font-semibold text-slate-500">{t("fieldResource")}</span>{" "}
              <span className="font-bold text-[#1B2A41] dark:text-slate-100 break-all">{exemptingItem.name}</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {t("exemptReasonLabel")}
              </label>
              <textarea
                value={exemptionReason}
                onChange={(e) => setExemptionReason(e.target.value)}
                placeholder={t("exemptReasonPlaceholder")}
                rows={3}
                className="w-full p-2.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setExemptingItem(null)}
                disabled={isProcessing}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 cursor-pointer"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleSaveExemption}
                disabled={isProcessing}
                className="px-4 py-2 text-xs font-bold rounded-lg border border-[#0054A6] text-white bg-[#0054A6] hover:bg-[#004182] shadow-sm cursor-pointer inline-flex items-center gap-1.5"
              >
                {isProcessing ? <IconRefresh className="animate-spin" size={14} /> : <IconCheck size={14} />}
                Guardar Exención
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
