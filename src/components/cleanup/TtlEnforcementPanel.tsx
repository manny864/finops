"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import useSWR from "swr";
import {
  IconClockX,
  IconClockExclamation,
  IconTrash,
  IconShieldCheck,
  IconPlus,
  IconTag,
  IconBellRinging,
  IconSparkles,
  IconSearch,
  IconColumns,
  IconRefresh,
  IconServer,
  IconClock,
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconCalendarPlus,
  IconShieldX,
  IconChevronRight,
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
  TtlPolicyItem,
  UntaggedTtlResourceItem,
  TtlTrackedResourceItem,
  TtlDeletionRecord,
  TtlSummaryMetrics,
  TableColumnConfig,
} from "@/types/azureTtlEnforcement.types";
import { errorMessage } from "@/lib/apiErrors";

const DEFAULT_COLUMNS: TableColumnConfig[] = [
  { key: "resource", label: "Recurso / Entorno", isVisible: true, widthPx: 260 },
  { key: "type", label: "Tipo de Recurso", isVisible: true, widthPx: 180 },
  { key: "resourceGroup", label: "Grupo de Recursos", isVisible: true, widthPx: 180 },
  { key: "subscription", label: "Suscripción", isVisible: true, widthPx: 200 },
  { key: "expiryDate", label: "Fecha de Expiración", isVisible: true, widthPx: 200 },
  { key: "status", label: "Estado", isVisible: true, widthPx: 140 },
  { key: "savings", label: "Ahorro Estimado", isVisible: true, widthPx: 130 },
  { key: "actions", label: "Acciones", isVisible: true, widthPx: 260 },
];

const RESOURCE_TYPES_CATALOG = [
  { value: "VIRTUALMACHINES", labelKey: "resType_VIRTUALMACHINES", typeStr: "microsoft.compute/virtualmachines" },
  { value: "MANAGEDCLUSTERS", labelKey: "resType_MANAGEDCLUSTERS", typeStr: "microsoft.containerservice/managedclusters" },
  { value: "FLEXIBLESERVERS", labelKey: "resType_FLEXIBLESERVERS", typeStr: "microsoft.dbforpostgresql/flexibleservers" },
  { value: "RESOURCEGROUPS", labelKey: "resType_RESOURCEGROUPS", typeStr: "microsoft.resources/subscriptions/resourcegroups" },
  { value: "STORAGEACCOUNTS", labelKey: "resType_STORAGEACCOUNTS", typeStr: "microsoft.storage/storageaccounts" },
];

export default function TtlEnforcementPanel() {
  const t = useTranslations("TTL");
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

  // Persistencia de Columnas
  const storageKey = `table_columns_config_ttl_${tenantId}`;
  const [columns, setColumns] = useState<TableColumnConfig[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {
        // Ignorar
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
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [rgFilter, setRgFilter] = useState("all");
  type TtlSort = "expiry_asc" | "expiry_desc" | "savings_desc" | "savings_asc" | "name_asc" | "name_desc";
  const [sortBy, setSortBy] = useState<TtlSort>("expiry_asc");

  // Selección
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modales
  const [showCreatePolicyModal, setShowCreatePolicyModal] = useState(false);
  const [policyForm, setPolicyForm] = useState({
    name: "",
    targetResourceType: "VIRTUALMACHINES",
    maxLifespanDays: 14,
    description: "",
    notifyDaysBefore: 3,
  });

  const [extendingItem, setExtendingItem] = useState<TtlTrackedResourceItem | null>(null);
  const [extensionDays, setExtensionDays] = useState<number>(7);

  const [deletingItem, setDeletingItem] = useState<TtlTrackedResourceItem | null>(null);
  const [exemptingItem, setExemptingItem] = useState<TtlTrackedResourceItem | null>(null);
  const [exemptionReason, setExemptionReason] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Fetcher SWR
  const apiUrl = `/api/cleanup/ttl?tenantId=${encodeURIComponent(tenantId)}${isMock ? "&mock=true" : ""}`;
  const { data, isLoading, mutate } = useSWR<{
    success: boolean;
    metrics: TtlSummaryMetrics;
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
    expiredResourcesCount: 0,
    warningResourcesCount: 0,
    potentialSavingsMonthlyUSD: 0,
    activePoliciesCount: 0,
    policies: [],
    untaggedResources: [],
    trackedResources: [],
    deletionHistory: [],
  };

  // Opciones de filtros
  const rgOptions = useMemo(() => {
    const set = new Set<string>();
    metrics.trackedResources.forEach((r) => {
      if (r.resourceGroup) set.add(r.resourceGroup);
    });
    return Array.from(set).sort();
  }, [metrics.trackedResources]);

  // Filtrado y Ordenamiento
  const filteredTracked = useMemo(() => {
    let list = [...metrics.trackedResources];

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          r.resourceGroup.toLowerCase().includes(q)
      );
    }

    if (statusFilter !== "all") {
      list = list.filter((r) => r.status === statusFilter);
    }

    if (typeFilter !== "all") {
      list = list.filter((r) => r.resourceType.toLowerCase().includes(typeFilter.toLowerCase()));
    }

    if (rgFilter !== "all") {
      list = list.filter((r) => r.resourceGroup === rgFilter);
    }

    list.sort((a, b) => {
      if (sortBy === "expiry_asc") return new Date(a.expirationDateIso).getTime() - new Date(b.expirationDateIso).getTime();
      if (sortBy === "expiry_desc") return new Date(b.expirationDateIso).getTime() - new Date(a.expirationDateIso).getTime();
      if (sortBy === "savings_desc") return b.monthlySavingsUSD - a.monthlySavingsUSD;
      if (sortBy === "savings_asc") return a.monthlySavingsUSD - b.monthlySavingsUSD;
      if (sortBy === "name_asc") return a.name.localeCompare(b.name);
      if (sortBy === "name_desc") return b.name.localeCompare(a.name);
      return 0;
    });

    return list;
  }, [metrics.trackedResources, search, statusFilter, typeFilter, rgFilter, sortBy]);

  // Paginación principal
  const {
    page,
    pageSize,
    setPage,
    setPageSize,
    totalPages,
    total,
    paged: pagedTracked,
  } = usePagination(filteredTracked, 15);

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllPage = () => {
    const pageIds = pagedTracked.map((r: TtlTrackedResourceItem) => r.id);
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

  // Crear Política TTL
  const handleCreatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!policyForm.name.trim()) {
      toast.error(t("policyNeedsName"));
      return;
    }
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/cleanup/ttl/policies?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          tenantId,
          name: policyForm.name.trim(),
          resourceType: RESOURCE_TYPES_CATALOG.find((c) => c.value === policyForm.targetResourceType)?.typeStr || "microsoft.compute/virtualmachines",
          daysToLive: policyForm.maxLifespanDays,
          description: policyForm.description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t("policyCreateError"));
      }
      toast.success(t("policyCreated"));
      setShowCreatePolicyModal(false);
      setPolicyForm({
        name: "",
        targetResourceType: "VIRTUALMACHINES",
        maxLifespanDays: 14,
        description: "",
        notifyDaysBefore: 3,
      });
      mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsProcessing(false);
    }
  };

  // Borrar Política TTL
  const handleDeletePolicy = async (policyId: string | number) => {
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/cleanup/ttl/policies?tenantId=${encodeURIComponent(tenantId)}&id=${policyId}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t("policyDeleteFailed"));
      }
      toast.success(t("policyDeleted"));
      mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsProcessing(false);
    }
  };

  // Etiquetar recurso pendiente
  const handleApplyTag = async (resource: UntaggedTtlResourceItem) => {
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/cleanup/ttl?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          actionType: "APPLY_TTL_TAG",
          resourceId: resource.id,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Error al aplicar tag");
      }
      toast.success(`Etiqueta ExpireOn aplicada a ${resource.name}`);
      mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsProcessing(false);
    }
  };

  // Prorrogar TTL
  const handleConfirmExtension = async () => {
    if (!extendingItem) return;
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/cleanup/ttl?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          actionType: "EXTEND_LIFESPAN",
          resourceId: extendingItem.id,
          additionalDays: extensionDays,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Error al prorrogar");
      }
      toast.success(`Prórroga de ${extensionDays} días aplicada a ${extendingItem.name}`);
      setExtendingItem(null);
      mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsProcessing(false);
    }
  };

  // Eliminar Recurso
  const handleConfirmDeletion = async () => {
    if (!deletingItem) return;
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/remediation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          tenantId,
          resourceId: deletingItem.id,
          resourceType: deletingItem.resourceType,
          // Sin estos tres, deleteResource llama al SDK con resourceGroup y
          // resourceName undefined en todo tipo que no caiga en el fallback REST.
          subscriptionId: deletingItem.subscriptionId,
          resourceGroup: deletingItem.resourceGroup,
          resourceName: deletingItem.name,
          expirationDate: deletingItem.expirationDateIso,
          action: "DELETE",
          domain: "ttl",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Error al desaprovisionar");
      }
      toast.success(`Entorno ${deletingItem.name} desaprovisionado correctamente`);
      setDeletingItem(null);
      mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsProcessing(false);
    }
  };

  // Eximir Recurso
  const handleSaveExemption = async () => {
    if (!exemptingItem) return;
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/cleanup/ttl?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          actionType: "EXEMPT",
          resourceId: exemptingItem.id,
          resourceName: exemptingItem.name,
          reason: exemptionReason.trim() || "Eximido por el usuario en TTL Enforcement",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Error al eximir");
      }
      toast.success(t("resourceExempted"));
      setExemptingItem(null);
      setExemptionReason("");
      mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const money = (val: number) =>
    `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="w-full max-w-full space-y-6">
      {/* 4 KPI Cards Superiores (100% Ancho en Tonos de Azul) */}
      <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {t("kpiExpired")}
              </span>
              <InfoTooltip content={t("kpiExpiredTip")} />
            </div>
            <div className="text-2xl font-bold text-rose-600 font-['Montserrat']">
              {metrics.expiredResourcesCount}
            </div>
            <div className="text-[11px] text-rose-600 font-semibold">{t("kpiExpiredSub")}</div>
          </div>
          <IconClockX size={32} stroke={1.5} className="text-rose-500 bg-transparent" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {t("kpiExpiringSoon")}
              </span>
              <InfoTooltip content={t("kpiExpiringSoonTip")} />
            </div>
            <div className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
              {metrics.warningResourcesCount}
            </div>
            <div className="text-[11px] text-slate-400">{t("kpiExpiringSoonSub")}</div>
          </div>
          <IconClockExclamation size={32} stroke={1.5} className="text-[#0078D4] bg-transparent" />
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
              {money(metrics.potentialSavingsMonthlyUSD)}
            </div>
            <div className="text-[11px] text-slate-400">{t("kpiSavingsSub")}</div>
          </div>
          <IconTrash size={32} stroke={1.5} className="text-[#0078D4] bg-transparent" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {t("kpiPolicies")}
              </span>
              <InfoTooltip content={t("kpiPoliciesTip")} />
            </div>
            <div className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
              {metrics.activePoliciesCount}
            </div>
            <div className="text-[11px] text-emerald-600 font-semibold">{t("kpiPoliciesSub")}</div>
          </div>
          <IconShieldCheck size={32} stroke={1.5} className="text-[#0078D4] bg-transparent" />
        </div>
      </div>

      {/* Sección 1: Tarjeta / Tabla "Políticas TTL" (100% Ancho) */}
      <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <IconShieldCheck size={20} className="text-[#0078D4]" stroke={1.5} />
            <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
              {t("policiesSectionTitle")}
            </h3>
            <InfoTooltip content={t("policiesSectionTip")} />
          </div>
          <button
            onClick={() => setShowCreatePolicyModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0078D4] hover:bg-[#0054A6] text-white text-xs font-bold shadow-xs transition cursor-pointer"
          >
            <IconPlus size={16} stroke={2} />
            {t("createPolicy")}
          </button>
        </div>

        <div className="w-full overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50/75 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("polColName")}</th>
                <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("polColType")}</th>
                <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("polColDays")}</th>
                <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("polColDescription")}</th>
                <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200 text-right">{t("polColActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {metrics.policies.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400">
                    {t("noPoliciesYet")}
                  </td>
                </tr>
              ) : (
                metrics.policies.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition">
                    <td className="py-2.5 px-3">
                      <span className="font-bold text-[#1B2A41] dark:text-slate-100 break-words">{p.name}</span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-[#0078D4] border border-blue-200 dark:bg-blue-950/40 dark:border-blue-800 uppercase">
                        {p.targetResourceType}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-200">
                      {p.maxLifespanDays} días
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 break-words">
                      {p.description || t("noDescription")}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => handleDeletePolicy(p.id)}
                        disabled={isProcessing}
                        className="text-slate-400 hover:text-rose-600 transition cursor-pointer p-1"
                        title={t("deletePolicyTooltip")}
                      >
                        <IconTrash size={15} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sección 2: Panel "Recursos sin etiquetar" (100% Ancho) */}
      {metrics.untaggedResources.length > 0 && (
        <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-6 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconTag size={18} className="text-[#0078D4]" stroke={1.5} />
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                {t("untaggedTitle", { count: metrics.untaggedResources.length })}
              </h3>
              <InfoTooltip content={t("untaggedTip")} />
            </div>
          </div>

          <div className="text-xs text-slate-500">
            {t("untaggedBody")}
          </div>

          <div className="w-full overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50/75 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("colResourceName")}</th>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("colTypeShort")}</th>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("colResourceGroup")}</th>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("colSuggestedExpiry")}</th>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200 text-right">{t("colActionShort")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {metrics.untaggedResources.map((res) => (
                  <tr key={res.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition">
                    <td className="py-2.5 px-3">
                      <span className="font-bold text-[#1B2A41] dark:text-slate-100 break-words">{res.name}</span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                        {res.resourceType.split("/").pop()}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 break-words">{res.resourceGroup}</td>
                    <td className="py-2.5 px-3 text-slate-700 dark:text-slate-200 font-mono">{res.suggestedExpiryDate}</td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => handleApplyTag(res)}
                        disabled={isProcessing}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-[#0078D4] hover:bg-[#0054A6] text-white text-[11px] font-bold shadow-xs transition cursor-pointer"
                      >
                        <IconTag size={13} /> {t("tagAction")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sección 3: Banner de Alertas Preventivas (100% Ancho) */}
      <div className="w-full bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconBellRinging size={22} className="text-[#0078D4] shrink-0" stroke={1.5} />
          <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-200">
            {t.rich("preventiveAlerts", { b: (c) => <span className="font-bold text-[#1B2A41] dark:text-white">{c}</span> })}
          </div>
        </div>
        <span className="shrink-0 text-xs font-bold text-[#0054A6] dark:text-blue-400">
          {t("activeHooks")}
        </span>
      </div>

      {/* Sección 4: Tabla Principal "Entornos de Desarrollo por Expiración" (100% Ancho) */}
      <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
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

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">{t("allStates")}</option>
              <option value="CRITICAL">{t("stateCritical")}</option>
              <option value="WARNING">{t("stateWarning")}</option>
              <option value="ACTIVE">{t("stateOk")}</option>
            </select>

            {rgOptions.length > 0 && (
              <select
                value={rgFilter}
                onChange={(e) => setRgFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none"
              >
                <option value="all">{t("allGroups")}</option>
                {rgOptions.map((rg) => (
                  <option key={rg} value={rg}>
                    {rg}
                  </option>
                ))}
              </select>
            )}

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as TtlSort)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none font-medium"
            >
              <option value="expiry_asc">{t("sortExpirySoon")}</option>
              <option value="expiry_desc">{t("sortExpiryFar")}</option>
              <option value="savings_desc">{t("sortSavingsDesc")}</option>
              <option value="savings_asc">{t("sortSavingsAsc")}</option>
              <option value="name_asc">{t("sortNameAsc")}</option>
              <option value="name_desc">{t("sortNameDesc")}</option>
            </select>

            {/* Selector de Columnas */}
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

        {/* Tabla */}
        <div className="w-full overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50/80 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-3 px-3 w-10">
                  <input
                    type="checkbox"
                    checked={pagedTracked.length > 0 && pagedTracked.every((r: TtlTrackedResourceItem) => selectedIds.has(r.id))}
                    onChange={toggleSelectAllPage}
                    className="rounded text-[#0054A6] cursor-pointer"
                  />
                </th>

                {isColVisible("resource") && (
                  <ResizableTh minWidth={200} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_resource")}
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

                {isColVisible("subscription") && (
                  <ResizableTh minWidth={150} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_subscription")}
                  </ResizableTh>
                )}

                {isColVisible("expiryDate") && (
                  <ResizableTh minWidth={160} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_expiryDate")}
                  </ResizableTh>
                )}

                {isColVisible("status") && (
                  <ResizableTh minWidth={130} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_status")}
                  </ResizableTh>
                )}

                {isColVisible("savings") && (
                  <ResizableTh minWidth={120} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_savings")}
                  </ResizableTh>
                )}

                {isColVisible("actions") && (
                  <ResizableTh minWidth={220} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 text-right">
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
              ) : pagedTracked.length === 0 ? (
                <tr>
                  <td colSpan={columns.filter((c) => c.isVisible).length + 1} className="py-12 text-center text-slate-400">
                    {t("emptyFiltered")}
                  </td>
                </tr>
              ) : (
                pagedTracked.map((res: TtlTrackedResourceItem) => {
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
                          <div className="min-w-0">
                            <div className="font-bold text-[#1B2A41] dark:text-slate-100 break-words" title={res.name}>
                              {res.name}
                            </div>
                          </div>
                        </td>
                      )}

                      {isColVisible("type") && (
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                            {res.resourceType.split("/").pop()}
                          </span>
                        </td>
                      )}

                      {isColVisible("resourceGroup") && (
                        <td className="py-3 px-4">
                          <span className="text-slate-600 dark:text-slate-300 block break-words" title={res.resourceGroup}>
                            {res.resourceGroup}
                          </span>
                        </td>
                      )}

                      {isColVisible("subscription") && (
                        <td className="py-3 px-4">
                          <span className="font-semibold text-slate-600 dark:text-slate-300 block break-words" title={res.subscriptionName}>
                            {res.subscriptionName?.toLowerCase() === "ec03e8ce-ceee-4638-b303-64ae431d5b1e"
                              ? "CSCS-LandingZone"
                              : (res.subscriptionName || "Azure")}
                          </span>
                        </td>
                      )}

                      {isColVisible("expiryDate") && (
                        <td className="py-3 px-4">
                          <div className="font-mono text-slate-700 dark:text-slate-200">{res.formattedExpirationDate}</div>
                          <div className="text-[11px] font-semibold text-slate-500">{res.relativeTimeText}</div>
                        </td>
                      )}

                      {isColVisible("status") && (
                        <td className="py-3 px-4">
                          {res.isExempted ? (
                            <span className="px-2 py-0.5 rounded-md text-[11px] font-bold border border-slate-300 text-slate-600 bg-white dark:bg-slate-900" title={res.exemptionReason}>
                              {t("badgeExempted")}
                            </span>
                          ) : res.status === "CRITICAL" ? (
                            <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              Vencido ({res.relativeTimeText})
                            </span>
                          ) : res.status === "WARNING" ? (
                            <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              Por Vencer ({res.relativeTimeText})
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-[#0078D4] border border-blue-200">
                              Activo ({res.relativeTimeText})
                            </span>
                          )}
                        </td>
                      )}

                      {isColVisible("savings") && (
                        <td className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-100">
                          {money(res.monthlySavingsUSD)}/mes
                        </td>
                      )}

                      {isColVisible("actions") && (
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <button
                              onClick={() => {
                                setExtendingItem(res);
                                setExtensionDays(7);
                              }}
                              disabled={isProcessing}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition cursor-pointer"
                              title={t("extendTooltip")}
                            >
                              <IconSparkles size={14} stroke={1.5} className="text-[#0078D4]" />
                              {t("extend7d")}
                            </button>

                            <button
                              onClick={() => setDeletingItem(res)}
                              disabled={isProcessing}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg border border-rose-300 text-rose-700 bg-white dark:bg-slate-900 hover:bg-rose-50/50 transition cursor-pointer"
                              title={t("deleteEnvTooltip")}
                            >
                              <IconTrash size={13} />
                              {t("delete")}
                            </button>

                            {!res.isExempted && (
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

        {/* Paginación */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
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

      {/* Sección 5: Tabla "Histórico de Eliminaciones" (100% Ancho) */}
      {metrics.deletionHistory.length > 0 && (
        <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-6 shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <IconClock size={18} className="text-[#0078D4]" stroke={1.5} />
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
              Histórico de Desaprovisionamiento TTL ({metrics.deletionHistory.length})
            </h3>
            <InfoTooltip content={t("historyTip")} />
          </div>

          <div className="w-full overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50/75 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("colResourceName")}</th>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("colTypeShort")}</th>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("colResourceGroup")}</th>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("colExpiredOn")}</th>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("colDeletedBy")}</th>
                  <th className="py-2.5 px-3 font-semibold text-[#1B2A41] dark:text-slate-200">{t("colDeletedOn")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {metrics.deletionHistory.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition">
                    <td className="py-2.5 px-3 font-bold text-[#1B2A41] dark:text-slate-100 break-words">{d.resourceName}</td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{d.resourceType.split("/").pop()}</td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{d.resourceGroup}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">{d.expiredAtDate}</td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{d.deletedBy}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">{d.deletedAtDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Crear Política TTL (z-[100]) */}
      {showCreatePolicyModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[100]">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <IconShieldCheck size={22} className="text-[#0078D4]" />
                <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                  {t("createPolicyModalTitle")}
                </h3>
              </div>
              <button onClick={() => setShowCreatePolicyModal(false)} className="text-slate-400 hover:text-slate-600">
                <IconX size={18} />
              </button>
            </div>

            <form onSubmit={handleCreatePolicy} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-slate-300">{t("fieldPolicyName")}</label>
                <input
                  type="text"
                  required
                  value={policyForm.name}
                  onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })}
                  placeholder={t("policyNamePlaceholder")}
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-slate-300">{t("fieldResourceType")}</label>
                <select
                  value={policyForm.targetResourceType}
                  onChange={(e) => setPolicyForm({ ...policyForm, targetResourceType: e.target.value })}
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none"
                >
                  {RESOURCE_TYPES_CATALOG.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {t(cat.labelKey)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-slate-300">{t("fieldMaxDays")}</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  required
                  value={policyForm.maxLifespanDays}
                  onChange={(e) => setPolicyForm({ ...policyForm, maxLifespanDays: Number(e.target.value) })}
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-slate-300">{t("fieldDescription")}</label>
                <textarea
                  value={policyForm.description}
                  onChange={(e) => setPolicyForm({ ...policyForm, description: e.target.value })}
                  placeholder={t("policyDescPlaceholder")}
                  rows={2}
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreatePolicyModal(false)}
                  disabled={isProcessing}
                  className="px-4 py-2 font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 cursor-pointer"
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={isProcessing}
                  className="px-4 py-2 font-bold rounded-lg border border-[#0054A6] text-white bg-[#0054A6] hover:bg-[#004182] shadow-sm cursor-pointer inline-flex items-center gap-1.5"
                >
                  {isProcessing ? <IconRefresh className="animate-spin" size={14} /> : <IconCheck size={14} />}
                  {t("savePolicy")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Prorrogar TTL (z-[100]) */}
      {extendingItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[100]">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-2">
              <IconCalendarPlus size={22} className="text-[#0078D4]" />
              <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                {t("extendModalTitle")}
              </h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {t.rich("extendModalBody", {
                name: extendingItem.name,
                b: (c) => <span className="font-bold text-[#1B2A41] dark:text-white break-all">{c}</span>,
              })}
            </p>

            <div className="grid grid-cols-3 gap-2">
              {[7, 14, 30].map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setExtensionDays(days)}
                  className={`py-2 px-3 text-xs font-bold rounded-lg border transition cursor-pointer ${
                    extensionDays === days
                      ? "border-[#0054A6] bg-blue-50/80 text-[#0054A6] dark:bg-blue-950/60 dark:text-blue-400"
                      : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50"
                  }`}
                >
                  {t("plusDays", { days })}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setExtendingItem(null)}
                disabled={isProcessing}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 cursor-pointer"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleConfirmExtension}
                disabled={isProcessing}
                className="px-4 py-2 text-xs font-bold rounded-lg border border-[#0054A6] text-white bg-[#0054A6] hover:bg-[#004182] shadow-sm cursor-pointer inline-flex items-center gap-1.5"
              >
                {isProcessing ? <IconRefresh className="animate-spin" size={14} /> : <IconCheck size={14} />}
                {t("applyExtension")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmación de Eliminación (z-[100]) */}
      {deletingItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[100]">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-[#1B2A41] dark:text-slate-100">
              <IconAlertTriangle size={22} className="text-rose-500" stroke={1.5} />
              <h3 className="text-base font-bold font-['Montserrat']">
                {t("deleteModalTitle")}
              </h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {t("deleteModalBody")}
            </p>

            <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl space-y-1 text-xs border border-slate-200 dark:border-slate-700">
              <div>
                <span className="font-semibold text-slate-500">{t("fieldResource")}</span>{" "}
                <span className="font-bold text-[#1B2A41] dark:text-slate-100 break-all">{deletingItem.name}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-500">{t("fieldTypeShort")}</span>{" "}
                <span className="text-slate-700 dark:text-slate-300">{deletingItem.resourceType}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-500">{t("fieldExpiredOn")}</span>{" "}
                <span className="font-mono text-rose-600 font-bold">{deletingItem.formattedExpirationDate}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-500">{t("fieldClaimedSavings")}</span>{" "}
                <span className="font-bold text-emerald-600">{money(deletingItem.monthlySavingsUSD)}/mes</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setDeletingItem(null)}
                disabled={isProcessing}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 cursor-pointer"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleConfirmDeletion}
                disabled={isProcessing}
                className="px-4 py-2 text-xs font-bold rounded-lg border border-rose-600 text-white bg-rose-600 hover:bg-rose-700 shadow-sm cursor-pointer inline-flex items-center gap-1.5"
              >
                {isProcessing ? <IconRefresh className="animate-spin" size={14} /> : <IconTrash size={14} />}
                Confirmar Eliminación
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Exención de TTL (z-[100]) */}
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
                {t("saveExemption")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
