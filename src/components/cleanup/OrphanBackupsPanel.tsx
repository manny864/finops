"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import useSWR from "swr";
import {
  IconCurrencyDollar,
  IconArchive,
  IconDatabaseExport,
  IconShieldCheck,
  IconSearch,
  IconColumns,
  IconRefresh,
  IconTrash,
  IconSparkles,
  IconInfoCircle,
  IconAlertTriangle,
  IconX,
  IconCheck,
  IconFileText,
  IconServer,
  IconDatabase,
  IconFolder,
  IconDisc,
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
  OrphanBackupItem,
  OrphanBackupsSummary,
  OrphanBackupType,
  TableColumnConfig,
} from "@/types/azureOrphanBackups.types";
import { errorMessage } from "@/lib/apiErrors";

const DEFAULT_COLUMNS: TableColumnConfig[] = [
  // `label` queda como documentacion del id; lo que se muestra sale de
  // `col_<key>` en el catalogo, que es lo unico que cambia de idioma.
  { key: "resource", label: "Ítem de Backup / Recurso", isVisible: true, widthPx: 260 },
  { key: "workloadType", label: "Tipo de Respaldo", isVisible: true, widthPx: 160 },
  { key: "vaultName", label: "Vault de Origen", isVisible: true, widthPx: 180 },
  { key: "subscription", label: "Suscripción", isVisible: true, widthPx: 200 },
  { key: "resourceGroup", label: "Grupo de Recursos", isVisible: true, widthPx: 170 },
  { key: "region", label: "Región", isVisible: true, widthPx: 120 },
  { key: "storage", label: "Almacenamiento", isVisible: true, widthPx: 140 },
  { key: "recoveryPoints", label: "Puntos de Rest.", isVisible: true, widthPx: 140 },
  { key: "lastBackup", label: "Último Respaldo", isVisible: true, widthPx: 150 },
  { key: "monthlyCost", label: "Costo Mensual", isVisible: true, widthPx: 130 },
  { key: "actions", label: "Acciones", isVisible: true, widthPx: 270 },
];

function formatSubscriptionDisplay(name?: string, id?: string): string {
  const val = (name || id || "").trim();
  if (val.toLowerCase() === "ec03e8ce-ceee-4638-b303-64ae431d5b1e") return "CSCS-LandingZone";
  if (val === "demo-sub-01") return "CSCS-LandingZone-Production";
  if (val === "demo-sub-02") return "CSCS-DataPlatform-Analytics";
  return val || "Azure";
}

function getWorkloadBadge(type: OrphanBackupType) {
  switch (type) {
    case "AzureIaasVM":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-[#0078D4] border border-blue-200 dark:bg-blue-950/40 dark:border-blue-800">
          <IconServer size={13} />
          AzureIaasVM
        </span>
      );
    case "AzureWorkload":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-900/40 dark:text-blue-300">
          <IconDatabase size={13} />
          AzureWorkload (SQL)
        </span>
      );
    case "AzureStorage":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/40 dark:text-sky-300">
          <IconFolder size={13} />
          AzureStorage
        </span>
      );
    case "AzureDisk":
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300">
          <IconDisc size={13} />
          AzureDisk
        </span>
      );
  }
}

export default function OrphanBackupsPanel() {
  const t = useTranslations("BackupOrphans");
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
  const storageKey = `table_columns_config_orphan_backups_${tenantId}`;
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
  const [typeFilter, setTypeFilter] = useState("all");
  const [vaultFilter, setVaultFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [rgFilter, setRgFilter] = useState("all");
  const [subFilter, setSubFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  type BackupSort = "cost_desc" | "cost_asc" | "storage_desc" | "name_asc" | "name_desc";
  const [sortBy, setSortBy] = useState<BackupSort>("cost_desc");

  // Selección
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modales & Drawers
  const [purgingItem, setPurgingItem] = useState<OrphanBackupItem | null>(null);
  const [purgeInputName, setPurgeInputName] = useState("");

  const [archivingItem, setArchivingItem] = useState<OrphanBackupItem | null>(null);

  const [exemptingDrawerItem, setExemptingDrawerItem] = useState<OrphanBackupItem | null>(null);
  const [exemptionForm, setExemptionForm] = useState({
    ticketNumber: "",
    complianceYears: 5,
    reason: "",
  });

  const [isProcessing, setIsProcessing] = useState(false);

  // Fetcher SWR
  const apiUrl = `/api/cleanup/backup-orphans?tenantId=${encodeURIComponent(tenantId)}${isMock ? "&mock=true" : ""}`;
  const { data, isLoading, mutate } = useSWR<{
    success: boolean;
    summary: OrphanBackupsSummary;
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

  const summary = data?.summary || {
    totalMonthlyWasteUSD: 0,
    orphanItemsCount: 0,
    totalStorageConsumedGB: 0,
    exemptedItemsCount: 0,
    backups: [],
  };

  // Opciones de Dropdowns
  const vaultOptions = useMemo(() => {
    const set = new Set<string>();
    summary.backups.forEach((b) => {
      if (b.vaultName) set.add(b.vaultName);
    });
    return Array.from(set).sort();
  }, [summary.backups]);

  const regionOptions = useMemo(() => {
    const set = new Set<string>();
    summary.backups.forEach((b) => {
      if (b.location) set.add(b.location);
    });
    return Array.from(set).sort();
  }, [summary.backups]);

  const rgOptions = useMemo(() => {
    const set = new Set<string>();
    summary.backups.forEach((b) => {
      if (b.resourceGroup) set.add(b.resourceGroup);
    });
    return Array.from(set).sort();
  }, [summary.backups]);

  const subOptions = useMemo(() => {
    const map = new Map<string, string>();
    summary.backups.forEach((b) => {
      const name = formatSubscriptionDisplay(b.subscriptionName, b.subscriptionId);
      map.set(name, name);
    });
    return Array.from(map.values()).sort();
  }, [summary.backups]);

  // Filtrado y Ordenamiento
  const filteredBackups = useMemo(() => {
    let list = [...summary.backups];

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.vaultName.toLowerCase().includes(q) ||
          b.resourceGroup.toLowerCase().includes(q)
      );
    }

    if (typeFilter !== "all") {
      list = list.filter((b) => b.workloadType === typeFilter);
    }

    if (vaultFilter !== "all") {
      list = list.filter((b) => b.vaultName === vaultFilter);
    }

    if (regionFilter !== "all") {
      list = list.filter((b) => b.location === regionFilter);
    }

    if (rgFilter !== "all") {
      list = list.filter((b) => b.resourceGroup === rgFilter);
    }

    if (subFilter !== "all") {
      list = list.filter((b) => formatSubscriptionDisplay(b.subscriptionName, b.subscriptionId) === subFilter);
    }

    if (statusFilter === "ACTIVE") {
      list = list.filter((b) => !b.isExempted);
    } else if (statusFilter === "EXEMPTED") {
      list = list.filter((b) => b.isExempted);
    }

    list.sort((a, b) => {
      if (sortBy === "cost_desc") return b.monthlyCostUSD - a.monthlyCostUSD;
      if (sortBy === "cost_asc") return a.monthlyCostUSD - b.monthlyCostUSD;
      if (sortBy === "storage_desc") return b.storageConsumedGB - a.storageConsumedGB;
      if (sortBy === "name_asc") return a.name.localeCompare(b.name);
      if (sortBy === "name_desc") return b.name.localeCompare(a.name);
      return 0;
    });

    return list;
  }, [summary.backups, search, typeFilter, vaultFilter, regionFilter, rgFilter, subFilter, statusFilter, sortBy]);

  // Paginación
  const {
    page,
    pageSize,
    setPage,
    setPageSize,
    totalPages,
    total,
    paged: pagedBackups,
  } = usePagination(filteredBackups, 15);

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllPage = () => {
    const pageIds = pagedBackups.map((b: OrphanBackupItem) => b.id);
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

  // Acciones: Purga
  const handleConfirmPurge = async () => {
    if (!purgingItem) return;
    if (purgeInputName.trim().toLowerCase() !== purgingItem.name.trim().toLowerCase()) {
      toast.error(t("purgeNameMismatch"));
      return;
    }
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/cleanup/backup-orphans?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          actionType: "DELETE_AND_PURGE",
          protectedItemId: purgingItem.id,
          resourceName: purgingItem.name,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t("purgeError"));
      }
      const json = await res.json();
      toast.success(json.message || t("purgeOk"));
      setPurgingItem(null);
      setPurgeInputName("");
      mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsProcessing(false);
    }
  };

  // Acciones: Mover a Archive
  const handleConfirmArchive = async () => {
    if (!archivingItem) return;
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/cleanup/backup-orphans?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          actionType: "MOVE_TO_ARCHIVE",
          protectedItemId: archivingItem.id,
          resourceName: archivingItem.name,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t("archiveError"));
      }
      const json = await res.json();
      toast.success(json.message || t("archiveOk"));
      setArchivingItem(null);
      mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsProcessing(false);
    }
  };

  // Acciones: Eximir Compliance
  const handleSaveExemption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exemptingDrawerItem) return;
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/cleanup/backup-orphans?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          actionType: "EXEMPT_COMPLIANCE",
          protectedItemId: exemptingDrawerItem.id,
          resourceName: exemptingDrawerItem.name,
          ticketNumber: exemptionForm.ticketNumber.trim(),
          complianceYears: exemptionForm.complianceYears,
          reason: exemptionForm.reason.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t("exemptError"));
      }
      toast.success(t("exemptOk"));
      setExemptingDrawerItem(null);
      setExemptionForm({ ticketNumber: "", complianceYears: 5, reason: "" });
      mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const money = (val: number) =>
    `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;

  return (
    <div className="w-full max-w-full space-y-6">
      {/* 4 KPI Cards Superiores (100% Ancho en Tonos de Azul) */}
      <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {t("kpiMonthlyCost")}
              </span>
              <InfoTooltip content={t("kpiMonthlyCostTip")} />
            </div>
            <div className="text-2xl font-bold text-[#0054A6] dark:text-blue-400 font-['Montserrat']">
              {money(summary.totalMonthlyWasteUSD)}
            </div>
            <div className="text-[11px] text-slate-400">{t("kpiMonthlyCostSub")}</div>
          </div>
          <IconCurrencyDollar size={32} stroke={1.5} className="text-[#0078D4] bg-transparent" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {t("kpiOrphanItems")}
              </span>
              <InfoTooltip content={t("kpiOrphanItemsTip")} />
            </div>
            <div className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
              {summary.orphanItemsCount}
            </div>
            <div className="text-[11px] text-slate-400">{t("kpiOrphanItemsSub")}</div>
          </div>
          <IconArchive size={32} stroke={1.5} className="text-[#0078D4] bg-transparent" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {t("kpiIdleStorage")}
              </span>
              <InfoTooltip content={t("kpiIdleStorageTip")} />
            </div>
            <div className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
              {summary.totalStorageConsumedGB >= 1024
                ? `${(summary.totalStorageConsumedGB / 1024).toFixed(2)} TB`
                : `${summary.totalStorageConsumedGB} GB`}
            </div>
            <div className="text-[11px] text-slate-400">{t("kpiIdleStorageSub")}</div>
          </div>
          <IconDatabaseExport size={32} stroke={1.5} className="text-[#0078D4] bg-transparent" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {t("kpiExempted")}
              </span>
              <InfoTooltip content={t("kpiExemptedTip")} />
            </div>
            <div className="text-2xl font-bold text-emerald-600 font-['Montserrat']">
              {summary.exemptedItemsCount}
            </div>
            <div className="text-[11px] text-emerald-600 font-semibold">{t("kpiExemptedSub")}</div>
          </div>
          <IconShieldCheck size={32} stroke={1.5} className="text-[#0078D4] bg-transparent" />
        </div>
      </div>

      {/* Banner Superior de Advertencia Legal / Compliance (100% Ancho) */}
      <div className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 flex items-start gap-3">
        <IconInfoCircle size={20} className="text-[#0078D4] shrink-0 mt-0.5" stroke={1.5} />
        <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          {t.rich("legalGovernanceNote", { b: (c) => <span className="font-bold text-[#1B2A41] dark:text-white">{c}</span> })}
        </div>
      </div>

      {/* Barra de Herramientas y Tabla Principal (100% Ancho) */}
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
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">{t("allTypes")}</option>
              <option value="AzureIaasVM">AzureIaasVM</option>
              <option value="AzureWorkload">AzureWorkload (SQL)</option>
              <option value="AzureStorage">AzureStorage</option>
              <option value="AzureDisk">AzureDisk</option>
            </select>

            {vaultOptions.length > 0 && (
              <select
                value={vaultFilter}
                onChange={(e) => setVaultFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none"
              >
                <option value="all">{t("allVaults")}</option>
                {vaultOptions.map((v) => (
                  <option key={v} value={v}>
                    {v}
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
                {subOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">{t("allStates")}</option>
              <option value="ACTIVE">{t("stateActive")}</option>
              <option value="EXEMPTED">{t("stateExempted")}</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as BackupSort)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none font-medium"
            >
              <option value="cost_desc">{t("sortCostDesc")}</option>
              <option value="cost_asc">{t("sortCostAsc")}</option>
              <option value="storage_desc">{t("sortStorageDesc")}</option>
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
                        <span>{col.label}</span>
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
                    checked={pagedBackups.length > 0 && pagedBackups.every((b: OrphanBackupItem) => selectedIds.has(b.id))}
                    onChange={toggleSelectAllPage}
                    className="rounded text-[#0054A6] cursor-pointer"
                  />
                </th>

                {isColVisible("resource") && (
                  <ResizableTh minWidth={220} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_resource")}
                  </ResizableTh>
                )}

                {isColVisible("workloadType") && (
                  <ResizableTh minWidth={150} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_workloadType")}
                  </ResizableTh>
                )}

                {isColVisible("vaultName") && (
                  <ResizableTh minWidth={150} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_vaultName")}
                  </ResizableTh>
                )}

                {isColVisible("subscription") && (
                  <ResizableTh minWidth={160} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_subscription")}
                  </ResizableTh>
                )}

                {isColVisible("resourceGroup") && (
                  <ResizableTh minWidth={140} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_resourceGroup")}
                  </ResizableTh>
                )}

                {isColVisible("region") && (
                  <ResizableTh minWidth={110} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_region")}
                  </ResizableTh>
                )}

                {isColVisible("storage") && (
                  <ResizableTh minWidth={120} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_storage")}
                  </ResizableTh>
                )}

                {isColVisible("recoveryPoints") && (
                  <ResizableTh minWidth={120} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_recoveryPoints")}
                  </ResizableTh>
                )}

                {isColVisible("lastBackup") && (
                  <ResizableTh minWidth={130} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_lastBackup")}
                  </ResizableTh>
                )}

                {isColVisible("monthlyCost") && (
                  <ResizableTh minWidth={120} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("col_monthlyCost")}
                  </ResizableTh>
                )}

                {isColVisible("actions") && (
                  <ResizableTh minWidth={260} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 text-right">
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
                      <span>{t("loadingAudit")}</span>
                    </div>
                  </td>
                </tr>
              ) : pagedBackups.length === 0 ? (
                <tr>
                  <td colSpan={columns.filter((c) => c.isVisible).length + 1} className="py-12 text-center text-slate-400">
                    {t("emptyFiltered")}
                  </td>
                </tr>
              ) : (
                pagedBackups.map((res: OrphanBackupItem) => {
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
                            <div className="font-bold text-[#1B2A41] dark:text-slate-100 break-words leading-snug" title={res.name}>
                              {res.name}
                            </div>
                            {res.isExempted && (
                              <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Eximido ({res.complianceYears || 5}a)
                              </span>
                            )}
                          </div>
                        </td>
                      )}

                      {isColVisible("workloadType") && (
                        <td className="py-3 px-4">{getWorkloadBadge(res.workloadType)}</td>
                      )}

                      {isColVisible("vaultName") && (
                        <td className="py-3 px-4">
                          <span className="font-semibold text-slate-700 dark:text-slate-200 block break-words" title={res.vaultName}>
                            {res.vaultName}
                          </span>
                        </td>
                      )}

                      {isColVisible("subscription") && (
                        <td className="py-3 px-4">
                          <span className="font-semibold text-slate-600 dark:text-slate-300 block break-words" title={res.subscriptionName}>
                            {formatSubscriptionDisplay(res.subscriptionName, res.subscriptionId)}
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

                      {isColVisible("region") && (
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-500">{res.location}</td>
                      )}

                      {isColVisible("storage") && (
                        <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-200">
                          {res.storageConsumedGB} GB
                        </td>
                      )}

                      {isColVisible("recoveryPoints") && (
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                          {res.recoveryPointsCount} pts
                        </td>
                      )}

                      {isColVisible("lastBackup") && (
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                          {res.formattedLastBackup || "N/D"}
                        </td>
                      )}

                      {isColVisible("monthlyCost") && (
                        <td className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-100">
                          {money(res.monthlyCostUSD)}
                        </td>
                      )}

                      {isColVisible("actions") && (
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <button
                              onClick={() => {
                                setArchivingItem(res);
                              }}
                              disabled={isProcessing}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition cursor-pointer"
                              title={t("archiveTooltip")}
                            >
                              <IconSparkles size={14} stroke={1.5} className="text-[#0078D4]" />
                              {t("moveToArchive")}
                            </button>

                            {!res.isExempted && (
                              <button
                                onClick={() => {
                                  setExemptingDrawerItem(res);
                                  setExemptionForm({ ticketNumber: "", complianceYears: 5, reason: "" });
                                }}
                                disabled={isProcessing}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 transition cursor-pointer"
                                title={t("exemptTooltip")}
                              >
                                <IconShieldCheck size={13} />
                                {t("exempt")}
                              </button>
                            )}

                            <button
                              onClick={() => {
                                setPurgingItem(res);
                                setPurgeInputName("");
                              }}
                              disabled={isProcessing}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg border border-rose-300 text-rose-700 dark:text-rose-400 bg-white dark:bg-slate-900 hover:bg-rose-50/50 transition cursor-pointer"
                              title={t("purgeTooltip")}
                            >
                              <IconTrash size={13} />
                              {t("purge")}
                            </button>
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

      {/* Modal: Confirmación de Purga (z-[100]) */}
      {purgingItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[100]">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-[#1B2A41] dark:text-slate-100">
              <IconAlertTriangle size={22} className="text-rose-500" stroke={1.5} />
              <h3 className="text-base font-bold font-['Montserrat']">
                {t("purgeModalTitle")}
              </h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {t.rich("purgeModalBody", {
                name: purgingItem.name,
                vault: purgingItem.vaultName,
                b: (c) => <span className="font-bold text-[#1B2A41] dark:text-white break-all">{c}</span>,
                v: (c) => <span className="font-semibold text-slate-800 dark:text-slate-200">{c}</span>,
              })}
            </p>

            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3.5 rounded-xl text-xs text-amber-800 dark:text-amber-300 space-y-1">
              <div className="font-bold flex items-center gap-1">
                <IconInfoCircle size={14} /> {t("softDeleteTitle")}
              </div>
              <div>
                {t("softDeleteBody")}
              </div>
            </div>

            <div className="space-y-1.5 text-xs">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                {t.rich("purgeConfirmLabel", {
                  name: purgingItem.name,
                  b: (c) => <span className="font-mono text-rose-600">{c}</span>,
                })}
              </label>
              <input
                type="text"
                value={purgeInputName}
                onChange={(e) => setPurgeInputName(e.target.value)}
                placeholder={t("purgeNamePlaceholder")}
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setPurgingItem(null)}
                disabled={isProcessing}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 cursor-pointer"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleConfirmPurge}
                disabled={
                  isProcessing ||
                  purgeInputName.trim().toLowerCase() !== purgingItem.name.trim().toLowerCase()
                }
                className="px-4 py-2 text-xs font-bold rounded-lg border border-rose-600 text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm cursor-pointer inline-flex items-center gap-1.5"
              >
                {isProcessing ? <IconRefresh className="animate-spin" size={14} /> : <IconTrash size={14} />}
                {t("confirmPurge")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Mover a Archive (z-[100]) */}
      {archivingItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[100]">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-2">
              <IconSparkles size={22} className="text-[#0078D4]" />
              <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                {t("archiveModalTitle")}
              </h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {t.rich("archiveModalBody", {
                name: archivingItem.name,
                gb: archivingItem.storageConsumedGB,
                b: (c) => <span className="font-bold text-[#1B2A41] dark:text-white break-all">{c}</span>,
              })}
            </p>

            <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 p-3 rounded-xl text-xs text-blue-900 dark:text-blue-200 space-y-1">
              <div className="font-bold">{t("archiveSavings")}</div>
              <div>{t("archiveSavingsNote")}</div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setArchivingItem(null)}
                disabled={isProcessing}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 cursor-pointer"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleConfirmArchive}
                disabled={isProcessing}
                className="px-4 py-2 text-xs font-bold rounded-lg border border-[#0054A6] text-white bg-[#0054A6] hover:bg-[#004182] shadow-sm cursor-pointer inline-flex items-center gap-1.5"
              >
                {isProcessing ? <IconRefresh className="animate-spin" size={14} /> : <IconCheck size={14} />}
                Confirmar Transferencia
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer Lateral: Exención por Cumplimiento Legal (z-[100]) */}
      {exemptingDrawerItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex justify-end z-[100]">
          <div className="bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 w-full max-w-md h-full p-6 shadow-2xl flex flex-col justify-between overflow-y-auto animate-in slide-in-from-right">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <IconShieldCheck size={22} className="text-[#0078D4]" />
                  <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                    {t("exemptDrawerTitle")}
                  </h3>
                </div>
                <button
                  onClick={() => setExemptingDrawerItem(null)}
                  className="text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <IconX size={18} />
                </button>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {t.rich("exemptDrawerBody", {
                  name: exemptingDrawerItem.name,
                  b: (c) => <span className="font-bold text-[#1B2A41] dark:text-white break-all">{c}</span>,
                })}
              </p>

              <form onSubmit={handleSaveExemption} className="space-y-4 text-xs">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    {t("ticketLabel")}
                  </label>
                  <input
                    type="text"
                    required
                    value={exemptionForm.ticketNumber}
                    onChange={(e) => setExemptionForm({ ...exemptionForm, ticketNumber: e.target.value })}
                    placeholder={t("ticketPlaceholder")}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    {t("retentionLabel")}
                  </label>
                  <select
                    value={exemptionForm.complianceYears}
                    onChange={(e) => setExemptionForm({ ...exemptionForm, complianceYears: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none"
                  >
                    <option value={1}>{t("retention1")}</option>
                    <option value={3}>{t("retention3")}</option>
                    <option value={5}>{t("retention5")}</option>
                    <option value={10}>{t("retention10")}</option>
                    <option value={99}>{t("retentionForever")}</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    {t("reasonLabel")}
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={exemptionForm.reason}
                    onChange={(e) => setExemptionForm({ ...exemptionForm, reason: e.target.value })}
                    placeholder={t("reasonPlaceholder")}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
                  />
                </div>

                <div className="pt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setExemptingDrawerItem(null)}
                    disabled={isProcessing}
                    className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 cursor-pointer"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={isProcessing}
                    className="px-4 py-2 text-xs font-bold rounded-lg border border-[#0054A6] text-white bg-[#0054A6] hover:bg-[#004182] shadow-sm cursor-pointer inline-flex items-center gap-1.5"
                  >
                    {isProcessing ? <IconRefresh className="animate-spin" size={14} /> : <IconCheck size={14} />}
                    {t("saveExemption")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
