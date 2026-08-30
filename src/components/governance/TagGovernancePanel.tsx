"use client";

import React, { useState, useEffect, useMemo } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useMsal } from "@azure/msal-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import { csvEscape } from "@/lib/csvExport";
import { toast } from "sonner";
import ResizableTh from "@/components/ResizableTh";
import InfoTooltip from "@/components/InfoTooltip";
import Pagination from "@/components/Pagination";
import {
  IconShieldCheck,
  IconTagOff,
  IconFolderOff,
  IconSparkles,
  IconDownload,
  IconColumns,
  IconEdit,
  IconArrowDownRight,
  IconShare,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconFilter,
  IconFolder,
  IconTag,
  IconServer,
  IconDatabase,
  IconDeviceFloppy,
  IconX,
  IconCheck,
  IconAlertCircle,
  IconAdjustmentsHorizontal,
} from "@tabler/icons-react";
import {
  TagGovernanceSummaryMetrics,
  ResourceTagAuditItem,
  ResourceGroupTagAuditItem,
  TableColumnConfig,
  TagPolicyRule,
} from "@/types/azureTagGovernance.types";

const fetcher = async ([url, token]: [string, string]) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${res.status}`);
  }
  return res.json();
};

const DEFAULT_RESOURCE_COLUMNS: TableColumnConfig[] = [
  { id: "resource", label: "Recurso", visible: true, width: 260, minWidth: 160, maxWidth: 450 },
  { id: "type", label: "Tipo", visible: true, width: 180, minWidth: 120, maxWidth: 280 },
  { id: "subscription", label: "Suscripción", visible: true, width: 170, minWidth: 130, maxWidth: 280 },
  { id: "resourceGroup", label: "Grupo de Recursos", visible: true, width: 180, minWidth: 130, maxWidth: 280 },
  { id: "status", label: "Estado de Cumplimiento", visible: true, width: 160, minWidth: 130, maxWidth: 220 },
  { id: "missingTags", label: "Etiquetas Faltantes", visible: true, width: 220, minWidth: 150, maxWidth: 350 },
  { id: "actions", label: "Acciones", visible: true, width: 240, minWidth: 200, maxWidth: 350 },
];

const DEFAULT_RG_COLUMNS: TableColumnConfig[] = [
  { id: "resourceGroup", label: "Grupo de Recursos", visible: true, width: 260, minWidth: 160, maxWidth: 450 },
  { id: "subscription", label: "Suscripción", visible: true, width: 180, minWidth: 130, maxWidth: 280 },
  { id: "location", label: "Región", visible: true, width: 140, minWidth: 100, maxWidth: 200 },
  { id: "status", label: "Estado de Cumplimiento", visible: true, width: 160, minWidth: 130, maxWidth: 220 },
  { id: "missingTags", label: "Etiquetas Faltantes", visible: true, width: 220, minWidth: 150, maxWidth: 350 },
  { id: "childCount", label: "Recursos Contenidos", visible: true, width: 150, minWidth: 120, maxWidth: 220 },
  { id: "actions", label: "Acciones", visible: true, width: 240, minWidth: 200, maxWidth: 350 },
];

export default function TagGovernancePanel() {
  const { selectedTenant } = useTenant();
  const { selectedSubscription } = useSubscription();
  const { instance, accounts } = useMsal();

  const tenantId = selectedTenant?.id || "default";
  const isDemo = isMockTenant(tenantId);

  const [token, setToken] = useState<string>("");

  useEffect(() => {
    let isMounted = true;
    if (isDemo) {
      setToken("mock-token");
      return;
    }
    if (accounts.length > 0) {
      getFreshIdToken(instance, accounts[0])
        .then((t) => {
          if (isMounted && t) setToken(t);
        })
        .catch(() => {
          if (isMounted) setToken("");
        });
    }
    return () => {
      isMounted = false;
    };
  }, [instance, accounts, isDemo, tenantId]);

  const canFetch = isDemo || Boolean(token && accounts.length > 0);
  const subQuery = selectedSubscription && selectedSubscription !== "All" ? `&subscriptionId=${encodeURIComponent(selectedSubscription)}` : "";
  const apiUrl = `/api/governance/tags?tenantId=${encodeURIComponent(tenantId)}${subQuery}`;

  const { data, error, isLoading, mutate } = useSWR<TagGovernanceSummaryMetrics>(
    canFetch ? [apiUrl, token] : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );

  // Estados locales optimistas de datos
  const [localResources, setLocalResources] = useState<ResourceTagAuditItem[]>([]);
  const [localRgs, setLocalRgs] = useState<ResourceGroupTagAuditItem[]>([]);

  useEffect(() => {
    if (data?.resources) {
      setLocalResources(data.resources);
    }
    if (data?.resourceGroups) {
      setLocalRgs(data.resourceGroups);
    }
  }, [data]);

  // Preferencias de Columnas Persistentes
  const resStorageKey = `table_columns_config_resource_tags_${tenantId}`;
  const rgStorageKey = `table_columns_config_rg_tags_${tenantId}`;

  const [resColumns, setResColumns] = useState<TableColumnConfig[]>(DEFAULT_RESOURCE_COLUMNS);
  const [rgColumns, setRgColumns] = useState<TableColumnConfig[]>(DEFAULT_RG_COLUMNS);
  const [showResColDropdown, setShowResColDropdown] = useState(false);
  const [showRgColDropdown, setShowRgColDropdown] = useState(false);

  useEffect(() => {
    try {
      const savedRes = localStorage.getItem(resStorageKey);
      if (savedRes) {
        const parsed = JSON.parse(savedRes);
        if (Array.isArray(parsed)) {
          setResColumns(DEFAULT_RESOURCE_COLUMNS.map((col) => {
            const match = parsed.find((p: any) => p.id === col.id);
            return match ? { ...col, visible: match.visible, width: match.width || col.width } : col;
          }));
        }
      }
      const savedRg = localStorage.getItem(rgStorageKey);
      if (savedRg) {
        const parsed = JSON.parse(savedRg);
        if (Array.isArray(parsed)) {
          setRgColumns(DEFAULT_RG_COLUMNS.map((col) => {
            const match = parsed.find((p: any) => p.id === col.id);
            return match ? { ...col, visible: match.visible, width: match.width || col.width } : col;
          }));
        }
      }
    } catch {
      // Ignore localStorage read errors
    }
  }, [resStorageKey, rgStorageKey]);

  const handleResizeResColumn = (columnId: string, newWidth: number) => {
    setResColumns((prev) => {
      const updated = prev.map((col) => (col.id === columnId ? { ...col, width: newWidth } : col));
      try {
        localStorage.setItem(resStorageKey, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const handleToggleResColumn = (columnId: string) => {
    setResColumns((prev) => {
      const updated = prev.map((col) => (col.id === columnId ? { ...col, visible: !col.visible } : col));
      try {
        localStorage.setItem(resStorageKey, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const handleResizeRgColumn = (columnId: string, newWidth: number) => {
    setRgColumns((prev) => {
      const updated = prev.map((col) => (col.id === columnId ? { ...col, width: newWidth } : col));
      try {
        localStorage.setItem(rgStorageKey, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const handleToggleRgColumn = (columnId: string) => {
    setRgColumns((prev) => {
      const updated = prev.map((col) => (col.id === columnId ? { ...col, visible: !col.visible } : col));
      try {
        localStorage.setItem(rgStorageKey, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  // Filtros de Recursos
  const [resSearch, setResSearch] = useState("");
  const [resComplianceFilter, setResComplianceFilter] = useState("ALL");
  const [resTypeFilter, setResTypeFilter] = useState("ALL");
  const [resRgFilter, setResRgFilter] = useState("ALL");
  const [resSort, setResSort] = useState<"AZ" | "ZA" | "NON_COMPLIANT_FIRST">("NON_COMPLIANT_FIRST");
  const [resPage, setResPage] = useState(1);
  const [resPageSize, setResPageSize] = useState(15);

  // Filtros de Resource Groups
  const [rgSearch, setRgSearch] = useState("");
  const [rgComplianceFilter, setRgComplianceFilter] = useState("ALL");
  const [rgSort, setRgSort] = useState<"AZ" | "ZA" | "NON_COMPLIANT_FIRST">("NON_COMPLIANT_FIRST");
  const [rgPage, setRgPage] = useState(1);
  const [rgPageSize, setRgPageSize] = useState(15);

  // Modales y Drawers
  const [editingItem, setEditingItem] = useState<{
    id: string;
    name: string;
    type: "resource" | "rg";
    resourceGroup?: string;
    resourceType?: string;
    currentTags: Record<string, string>;
  } | null>(null);

  const [tagForm, setTagForm] = useState<{
    Environment: string;
    Role: string;
    CostCenter: string;
    Department: string;
    customTags: { key: string; value: string }[];
  }>({
    Environment: "",
    Role: "",
    CostCenter: "",
    Department: "",
    customTags: [],
  });

  const [isSuggestingAi, setIsSuggestingAi] = useState(false);
  const [isSavingTags, setIsSavingTags] = useState(false);

  // Modal de herencia de RG
  const [inheritingRg, setInheritingRg] = useState<ResourceGroupTagAuditItem | null>(null);
  const [isInheriting, setIsInheriting] = useState(false);
  // Sobrescribir el valor que ya tiene un recurso hijo es destructivo: arranca
  // apagado siempre y se reinicia al cerrar el modal, para que no quede
  // encendido de una propagación anterior sin que el usuario lo note.
  const [inheritOverwrite, setInheritOverwrite] = useState(false);

  // Modal de gestión de políticas
  const [showPolicyModal, setShowPolicyModal] = useState(false);

  // Abrir modal de edición
  const handleOpenEdit = (item: ResourceTagAuditItem | ResourceGroupTagAuditItem, type: "resource" | "rg") => {
    const rawTags = { ...item.currentTags };
    const env = rawTags.Environment || rawTags.environment || "";
    const role = rawTags.Role || rawTags.role || "";
    const cc = rawTags.CostCenter || rawTags.costCenter || rawTags.costcenter || "";
    const dept = rawTags.Department || rawTags.department || rawTags.Owner || rawTags.owner || "";

    const custom: { key: string; value: string }[] = [];
    for (const [k, v] of Object.entries(rawTags)) {
      const kLower = k.toLowerCase();
      if (!["environment", "role", "costcenter", "department", "owner"].includes(kLower)) {
        custom.push({ key: k, value: String(v) });
      }
    }

    setEditingItem({
      id: item.id,
      name: "resourceName" in item ? item.resourceName : item.resourceGroupName,
      type,
      resourceGroup: "resourceGroup" in item ? item.resourceGroup : ("resourceGroupName" in item ? item.resourceGroupName : undefined),
      resourceType: "resourceType" in item ? item.resourceType : undefined,
      currentTags: rawTags,
    });

    setTagForm({
      Environment: env,
      Role: role,
      CostCenter: cc,
      Department: dept,
      customTags: custom,
    });
  };

  // Autocompletar con IA
  const handleAiSuggest = async () => {
    if (!editingItem) return;
    setIsSuggestingAi(true);
    try {
      const res = await fetch(`/api/governance/tags/suggest?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token && !isDemo ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          resourceName: editingItem.name,
          resourceType: editingItem.resourceType || "Microsoft.Resources/resourceGroups",
          resourceGroup: editingItem.resourceGroup || "",
        }),
      });
      const json = await res.json();
      if (json.success && json.suggestedTags) {
        setTagForm((prev) => ({
          ...prev,
          Environment: json.suggestedTags.Environment || prev.Environment || "prod",
          Role: json.suggestedTags.Role || prev.Role || "worker",
          CostCenter: json.suggestedTags.CostCenter || prev.CostCenter || "Engineering",
          Department: json.suggestedTags.Department || prev.Department || "CloudOps",
        }));
        toast.success("Etiquetas inferidas con Inteligencia Artificial");
      }
    } catch (err) {
      toast.error("Error al sugerir etiquetas con IA");
    } finally {
      setIsSuggestingAi(false);
    }
  };

  // Copiar del Resource Group
  const handleCopyFromRg = () => {
    if (!editingItem || !editingItem.resourceGroup) return;
    const matchRg = localRgs.find(
      (rg) => rg.resourceGroupName.toLowerCase() === editingItem.resourceGroup?.toLowerCase()
    );
    if (!matchRg) {
      toast.error(`No se encontraron etiquetas registradas en el Resource Group '${editingItem.resourceGroup}'`);
      return;
    }
    const rgTags = matchRg.currentTags || {};
    setTagForm((prev) => ({
      ...prev,
      Environment: rgTags.Environment || rgTags.environment || prev.Environment,
      CostCenter: rgTags.CostCenter || rgTags.costCenter || prev.CostCenter,
      Department: rgTags.Department || rgTags.department || prev.Department,
    }));
    toast.success("Valores heredados del Resource Group correctamente");
  };

  // Guardar Etiquetas con Actualización Optimista
  const handleSaveTags = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    const consolidatedTags: Record<string, string> = {};
    if (tagForm.Environment.trim()) consolidatedTags["Environment"] = tagForm.Environment.trim();
    if (tagForm.Role.trim()) consolidatedTags["Role"] = tagForm.Role.trim();
    if (tagForm.CostCenter.trim()) consolidatedTags["CostCenter"] = tagForm.CostCenter.trim();
    if (tagForm.Department.trim()) consolidatedTags["Department"] = tagForm.Department.trim();

    for (const c of tagForm.customTags) {
      if (c.key.trim() && c.value.trim()) {
        consolidatedTags[c.key.trim()] = c.value.trim();
      }
    }

    // Actualización Optimista en Estado Local
    const mandatoryList = ["Environment", "Role", "CostCenter", "Department"];
    const missing = mandatoryList.filter((m) => !consolidatedTags[m] || consolidatedTags[m].trim() === "");
    const isCompliant = missing.length === 0;

    if (editingItem.type === "resource") {
      setLocalResources((prev) =>
        prev.map((r) =>
          r.id.toLowerCase() === editingItem.id.toLowerCase()
            ? {
                ...r,
                currentTags: consolidatedTags,
                missingTags: missing,
                complianceStatus: isCompliant ? "COMPLIANT" : "NON_COMPLIANT",
              }
            : r
        )
      );
    } else {
      setLocalRgs((prev) =>
        prev.map((rg) =>
          rg.id.toLowerCase() === editingItem.id.toLowerCase()
            ? {
                ...rg,
                currentTags: consolidatedTags,
                missingTags: missing,
                complianceStatus: isCompliant ? "COMPLIANT" : "NON_COMPLIANT",
              }
            : rg
        )
      );
    }

    setIsSavingTags(true);
    try {
      const res = await fetch(`/api/governance/tags?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token && !isDemo ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          resourceIds: [editingItem.id],
          tags: consolidatedTags,
        }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        throw new Error(json.details ? `${json.error} ${json.details}` : json.error || "Error al persistir etiquetas");
      }
      // El mensaje lo manda el servidor con el conteo real aplicado en Azure.
      // Antes era un literal fijo, así que decía "aplicadas exitosamente"
      // incluso cuando no se había etiquetado nada.
      if (json.failedCount > 0) {
        toast.warning(json.message, { description: json.failures?.[0]?.error });
      } else {
        toast.success(json.message || "Etiquetas aplicadas en Azure");
      }
      setEditingItem(null);
      mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsSavingTags(false);
    }
  };

  // Cerrar el modal apaga siempre la sobrescritura: dejarla encendida de una
  // propagación anterior convertiría la siguiente en destructiva sin aviso.
  const closeInheritModal = () => {
    setInheritingRg(null);
    setInheritOverwrite(false);
  };

  // Propagar Tags de RG a Recursos Hijos
  const handleConfirmInherit = async () => {
    if (!inheritingRg) return;
    setIsInheriting(true);
    try {
      const res = await fetch(`/api/governance/tags/inherit-rg?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token && !isDemo ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          resourceGroupId: inheritingRg.id,
          rgTags: inheritingRg.currentTags,
          overwriteExisting: inheritOverwrite,
        }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        throw new Error(json.details ? `${json.error} ${json.details}` : json.error || "Error al heredar etiquetas");
      }
      if (json.failedCount > 0) {
        toast.warning(json.message, { description: json.failures?.[0]?.error });
      } else {
        toast.success(json.message || "Etiquetas propagadas en Azure a los recursos hijos");
      }
      closeInheritModal();
      mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsInheriting(false);
    }
  };

  // Filtrado y Ordenación de Recursos
  const filteredResources = useMemo(() => {
    return localResources
      .filter((r) => {
        if (resSearch) {
          const s = resSearch.toLowerCase();
          const matches =
            r.resourceName.toLowerCase().includes(s) ||
            r.resourceGroup.toLowerCase().includes(s) ||
            r.subscriptionName.toLowerCase().includes(s) ||
            r.resourceTypeDisplay.toLowerCase().includes(s);
          if (!matches) return false;
        }
        if (resComplianceFilter === "COMPLIANT" && r.complianceStatus !== "COMPLIANT") return false;
        if (resComplianceFilter === "NON_COMPLIANT" && r.complianceStatus !== "NON_COMPLIANT") return false;
        if (resTypeFilter !== "ALL" && r.resourceTypeDisplay !== resTypeFilter) return false;
        if (resRgFilter !== "ALL" && r.resourceGroup.toLowerCase() !== resRgFilter.toLowerCase()) return false;
        return true;
      })
      .sort((a, b) => {
        if (resSort === "AZ") return a.resourceName.localeCompare(b.resourceName);
        if (resSort === "ZA") return b.resourceName.localeCompare(a.resourceName);
        if (resSort === "NON_COMPLIANT_FIRST") {
          if (a.complianceStatus === "NON_COMPLIANT" && b.complianceStatus === "COMPLIANT") return -1;
          if (a.complianceStatus === "COMPLIANT" && b.complianceStatus === "NON_COMPLIANT") return 1;
          return a.resourceName.localeCompare(b.resourceName);
        }
        return 0;
      });
  }, [localResources, resSearch, resComplianceFilter, resTypeFilter, resRgFilter, resSort]);

  // Filtrado y Ordenación de RGs
  const filteredRgs = useMemo(() => {
    return localRgs
      .filter((rg) => {
        if (rgSearch) {
          const s = rgSearch.toLowerCase();
          const matches =
            rg.resourceGroupName.toLowerCase().includes(s) ||
            rg.subscriptionName.toLowerCase().includes(s) ||
            rg.location.toLowerCase().includes(s);
          if (!matches) return false;
        }
        if (rgComplianceFilter === "COMPLIANT" && rg.complianceStatus !== "COMPLIANT") return false;
        if (rgComplianceFilter === "NON_COMPLIANT" && rg.complianceStatus !== "NON_COMPLIANT") return false;
        return true;
      })
      .sort((a, b) => {
        if (rgSort === "AZ") return a.resourceGroupName.localeCompare(b.resourceGroupName);
        if (rgSort === "ZA") return b.resourceGroupName.localeCompare(a.resourceGroupName);
        if (rgSort === "NON_COMPLIANT_FIRST") {
          if (a.complianceStatus === "NON_COMPLIANT" && b.complianceStatus === "COMPLIANT") return -1;
          if (a.complianceStatus === "COMPLIANT" && b.complianceStatus === "NON_COMPLIANT") return 1;
          return a.resourceGroupName.localeCompare(b.resourceGroupName);
        }
        return 0;
      });
  }, [localRgs, rgSearch, rgComplianceFilter, rgSort]);

  // Paginación
  const pagedResources = useMemo(() => {
    const start = (resPage - 1) * resPageSize;
    return filteredResources.slice(start, start + resPageSize);
  }, [filteredResources, resPage, resPageSize]);

  const pagedRgs = useMemo(() => {
    const start = (rgPage - 1) * rgPageSize;
    return filteredRgs.slice(start, start + rgPageSize);
  }, [filteredRgs, rgPage, rgPageSize]);

  // Opciones de Filtros
  const uniqueTypes = useMemo(() => {
    const s = new Set<string>();
    localResources.forEach((r) => s.add(r.resourceTypeDisplay));
    return Array.from(s).sort();
  }, [localResources]);

  const uniqueRgs = useMemo(() => {
    const s = new Set<string>();
    localResources.forEach((r) => s.add(r.resourceGroup));
    return Array.from(s).sort();
  }, [localResources]);

  // Exportar CSV
  const handleExportCsv = () => {
    const headers = ["Recurso", "Tipo", "Suscripción", "Grupo de Recursos", "Región", "Estado Cumplimiento", "Tags Faltantes", "Tags Actuales"];
    const rows = filteredResources.map((r) => [
      csvEscape(r.resourceName),
      csvEscape(r.resourceTypeDisplay),
      csvEscape(r.subscriptionName),
      csvEscape(r.resourceGroup),
      csvEscape(r.location),
      csvEscape(r.complianceStatus),
      csvEscape(r.missingTags.join("; ")),
      csvEscape(Object.entries(r.currentTags).map(([k, v]) => `${k}=${v}`).join("; ")),
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `reporte_gobernanza_etiquetas_${tenantId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isResColVisible = (id: string) => resColumns.find((c) => c.id === id)?.visible ?? true;
  const getResColWidth = (id: string) => resColumns.find((c) => c.id === id)?.width;
  const isRgColVisible = (id: string) => rgColumns.find((c) => c.id === id)?.visible ?? true;
  const getRgColWidth = (id: string) => rgColumns.find((c) => c.id === id)?.width;

  const summary = data || {
    overallCompliancePercentage: 83.0,
    nonCompliantResourcesCount: localResources.filter((r) => r.complianceStatus === "NON_COMPLIANT").length,
    nonCompliantResourceGroupsCount: localRgs.filter((rg) => rg.complianceStatus === "NON_COMPLIANT").length,
    totalScannedResources: localResources.length,
    totalScannedResourceGroups: localRgs.length,
    mostFrequentMissingTag: "CostCenter & Role",
    mandatoryPolicies: [],
    resources: [],
    resourceGroups: [],
  };

  return (
    <div className="w-full max-w-full space-y-6">
      {/* 4 KPI Cards Superiores (100% Ancho - Escala de Azules Estricta - CERO Naranja en números) */}
      <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Cumplimiento Global de Tags
              </span>
              <InfoTooltip content="Porcentaje ponderado de recursos y grupos de recursos que cumplen con las 4 etiquetas obligatorias." />
            </div>
            <div className="text-2xl font-bold text-[#0078D4] dark:text-blue-400 font-['Montserrat']">
              {summary.overallCompliancePercentage.toFixed(1)}%
            </div>
            <div className="text-[11px] text-slate-400">Total de infraestructura auditada</div>
          </div>
          <IconShieldCheck size={32} stroke={1.5} className="text-[#0078D4] bg-transparent" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Recursos No Conformes
              </span>
              <InfoTooltip content="Recursos individuales a los que les falta al menos una de las etiquetas requeridas." />
            </div>
            <div className="text-2xl font-bold text-[#2563EB] dark:text-blue-300 font-['Montserrat']">
              {summary.nonCompliantResourcesCount}
            </div>
            <div className="text-[11px] text-slate-400">Recursos con omisión de metadatos</div>
          </div>
          <IconTagOff size={32} stroke={1.5} className="text-[#0078D4] bg-transparent" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Grupos de Recursos No Conformes
              </span>
              <InfoTooltip content="Resource Groups que no poseen la totalidad de etiquetas base para propagación hereditaria." />
            </div>
            <div className="text-2xl font-bold text-[#0284C7] dark:text-sky-300 font-['Montserrat']">
              {summary.nonCompliantResourceGroupsCount}
            </div>
            <div className="text-[11px] text-slate-400">Contenedores de recursos incompletos</div>
          </div>
          <IconFolderOff size={32} stroke={1.5} className="text-[#0078D4] bg-transparent" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Tags Faltantes Frecuentes
              </span>
              <InfoTooltip content="Etiquetas obligatorias con mayor tasa de incumplimiento en el inventario actual." />
            </div>
            <div className="text-2xl font-bold text-[#0054A6] dark:text-blue-400 font-['Montserrat']">
              {summary.mostFrequentMissingTag}
            </div>
            <div className="text-[11px] text-slate-400">Mayor foco de remediación</div>
          </div>
          <IconSparkles size={32} stroke={1.5} className="text-[#0078D4] bg-transparent" />
        </div>
      </div>

      {/* Sección 1: Tarjeta "Políticas de Etiquetado Globales Activas" (Ancho 100%) */}
      <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <IconShieldCheck size={20} className="text-[#0078D4]" stroke={1.5} />
            <h2 className="text-base font-bold text-[#1B2A41] dark:text-white font-['Montserrat']">
              Políticas de Etiquetado Globales Activas
            </h2>
            <InfoTooltip content="Etiquetas corporativas requeridas para la correcta imputación de centros de costo, gobernanza de seguridad y reporte FinOps." />
          </div>
          <button
            onClick={() => setShowPolicyModal(true)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 transition-colors shadow-2xs"
          >
            <IconPlus size={15} stroke={1.5} />
            Gestionar Políticas
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-[#1B2A41] dark:text-white">Environment</div>
              <div className="text-[11px] text-slate-500">prod, stg, dev, qa, sandbox</div>
            </div>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 dark:bg-blue-950/40 text-[#0078D4] border border-blue-200 dark:border-blue-800">
              REQUERIDO
            </span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-[#1B2A41] dark:text-white">Role</div>
              <div className="text-[11px] text-slate-500">database, api, frontend, worker</div>
            </div>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 dark:bg-blue-950/40 text-[#0078D4] border border-blue-200 dark:border-blue-800">
              REQUERIDO
            </span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-[#1B2A41] dark:text-white">CostCenter</div>
              <div className="text-[11px] text-slate-500">FinOps, Engineering, CorePlatform</div>
            </div>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 dark:bg-blue-950/40 text-[#0078D4] border border-blue-200 dark:border-blue-800">
              REQUERIDO
            </span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-[#1B2A41] dark:text-white">Department</div>
              <div className="text-[11px] text-slate-500">CloudOps, DataTeam, SecurityOps</div>
            </div>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 dark:bg-blue-950/40 text-[#0078D4] border border-blue-200 dark:border-blue-800">
              REQUERIDO
            </span>
          </div>
        </div>
      </div>

      {/* Sección 2: Tabla "Auditoría de Etiquetas de Recursos" (Estándar CMP - Ancho 100%, Redimensionable & macOS Scroll) */}
      <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <IconTag size={20} className="text-[#0078D4]" stroke={1.5} />
            <h2 className="text-base font-bold text-[#1B2A41] dark:text-white font-['Montserrat']">
              Auditoría de Etiquetas de Recursos
            </h2>
            <InfoTooltip content="Inventario detallado de recursos individuales y estado de conformidad frente a las políticas de etiquetado activas." />
            <span className="text-xs text-slate-400">({filteredResources.length} recursos)</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleExportCsv}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <IconDownload size={15} stroke={1.5} />
              Descargar Reporte (CSV)
            </button>

            {/* Selector de Columnas en z-[100] */}
            <div className="relative">
              <button
                onClick={() => setShowResColDropdown(!showResColDropdown)}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 transition-colors shadow-2xs"
              >
                <IconColumns size={15} stroke={1.5} />
                Personalizar Columnas
              </button>

              {showResColDropdown && (
                <>
                  <div className="fixed inset-0 z-50" onClick={() => setShowResColDropdown(false)} />
                  <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-3 z-[100] space-y-2">
                    <div className="text-xs font-bold text-[#1B2A41] dark:text-white border-b border-slate-100 dark:border-slate-800 pb-1.5">
                      Columnas Visibles
                    </div>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {resColumns.map((col) => (
                        <label
                          key={col.id}
                          className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 p-1.5 rounded-md cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={col.visible}
                            onChange={() => handleToggleResColumn(col.id)}
                            className="rounded text-[#0054A6] focus:ring-[#0054A6]"
                          />
                          <span>{col.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Barra de Filtros de Recursos */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar recurso, RG, tipo..."
              value={resSearch}
              onChange={(e) => {
                setResSearch(e.target.value);
                setResPage(1);
              }}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0054A6]"
            />
          </div>

          <div>
            <select
              value={resComplianceFilter}
              onChange={(e) => {
                setResComplianceFilter(e.target.value);
                setResPage(1);
              }}
              className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0054A6]"
            >
              <option value="ALL">Estado: Todos</option>
              <option value="NON_COMPLIANT">No Conforme (Faltan Tags)</option>
              <option value="COMPLIANT">100% Conforme</option>
            </select>
          </div>

          <div>
            <select
              value={resTypeFilter}
              onChange={(e) => {
                setResTypeFilter(e.target.value);
                setResPage(1);
              }}
              className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0054A6]"
            >
              <option value="ALL">Tipo: Todos</option>
              {uniqueTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={resRgFilter}
              onChange={(e) => {
                setResRgFilter(e.target.value);
                setResPage(1);
              }}
              className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0054A6]"
            >
              <option value="ALL">Grupo de Recursos: Todos</option>
              {uniqueRgs.map((rg) => (
                <option key={rg} value={rg}>
                  {rg}
                </option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={resSort}
              onChange={(e) => setResSort(e.target.value as any)}
              className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0054A6]"
            >
              <option value="NON_COMPLIANT_FIRST">Priorizar No Conformes</option>
              <option value="AZ">Nombre: A-Z</option>
              <option value="ZA">Nombre: Z-A</option>
            </select>
          </div>
        </div>

        {/* Tabla con Columnas Redimensionables & macOS Scroll */}
        <div className="w-full overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 select-none">
              <tr>
                {isResColVisible("resource") && (
                  <ResizableTh minWidth={160} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Recurso
                  </ResizableTh>
                )}
                {isResColVisible("type") && (
                  <ResizableTh minWidth={120} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Tipo
                  </ResizableTh>
                )}
                {isResColVisible("subscription") && (
                  <ResizableTh minWidth={130} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Suscripción
                  </ResizableTh>
                )}
                {isResColVisible("resourceGroup") && (
                  <ResizableTh minWidth={130} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Grupo de Recursos
                  </ResizableTh>
                )}
                {isResColVisible("status") && (
                  <ResizableTh minWidth={130} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Estado de Cumplimiento
                  </ResizableTh>
                )}
                {isResColVisible("missingTags") && (
                  <ResizableTh minWidth={150} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Etiquetas Faltantes
                  </ResizableTh>
                )}
                {isResColVisible("actions") && (
                  <th className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-200 text-right">
                    Acciones
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {pagedResources.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No se encontraron recursos que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                pagedResources.map((res) => (
                  <tr key={res.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                    {isResColVisible("resource") && (
                      <td className="py-3 px-4 font-medium text-[#1B2A41] dark:text-white break-words">
                        <div className="flex items-center gap-1.5">
                          <IconServer size={15} className="text-[#0078D4] shrink-0" stroke={1.5} />
                          <span>{res.resourceName}</span>
                        </div>
                      </td>
                    )}

                    {isResColVisible("type") && (
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          {res.resourceTypeDisplay}
                        </span>
                      </td>
                    )}

                    {isResColVisible("subscription") && (
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300 break-words">
                        {res.subscriptionName}
                      </td>
                    )}

                    {isResColVisible("resourceGroup") && (
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300 break-words">
                        {res.resourceGroup}
                      </td>
                    )}

                    {isResColVisible("status") && (
                      <td className="py-3 px-4">
                        {res.complianceStatus === "COMPLIANT" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            <IconCheck size={13} stroke={2} />
                            100% Compliant
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                            <IconAlertCircle size={13} stroke={2} />
                            No Conforme
                          </span>
                        )}
                      </td>
                    )}

                    {isResColVisible("missingTags") && (
                      <td className="py-3 px-4">
                        {res.missingTags.length === 0 ? (
                          <span className="text-[11px] text-slate-400">Todas presentes</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {res.missingTags.map((t) => (
                              <span
                                key={t}
                                className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                              >
                                {t.toUpperCase()}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    )}

                    {isResColVisible("actions") && (
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <button
                            onClick={() => handleOpenEdit(res, "resource")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 transition-colors shadow-2xs"
                          >
                            <IconEdit size={13} stroke={1.5} />
                            Editar
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación de Recursos */}
        <Pagination
          page={resPage}
          setPage={setResPage}
          pageSize={resPageSize}
          setPageSize={setResPageSize}
          total={filteredResources.length}
          totalPages={Math.max(1, Math.ceil(filteredResources.length / resPageSize))}
          pageSizes={[15, 30, 45, 60]}
        />
      </div>

      {/* Sección 3: Tabla "Auditoría de Etiquetas de Grupos de Recursos" (Ancho 100%, Redimensionable & macOS Scroll) */}
      <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <IconFolder size={20} className="text-[#0078D4]" stroke={1.5} />
            <h2 className="text-base font-bold text-[#1B2A41] dark:text-white font-['Montserrat']">
              Auditoría de Etiquetas de Grupos de Recursos
            </h2>
            <InfoTooltip content="Gobernanza de metadatos a nivel de contenedor de recursos para permitir la herencia automática a todos los componentes contenidos." />
            <span className="text-xs text-slate-400">({filteredRgs.length} grupos de recursos)</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Selector de Columnas de RG en z-[100] */}
            <div className="relative">
              <button
                onClick={() => setShowRgColDropdown(!showRgColDropdown)}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 transition-colors shadow-2xs"
              >
                <IconColumns size={15} stroke={1.5} />
                Personalizar Columnas
              </button>

              {showRgColDropdown && (
                <>
                  <div className="fixed inset-0 z-50" onClick={() => setShowRgColDropdown(false)} />
                  <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-3 z-[100] space-y-2">
                    <div className="text-xs font-bold text-[#1B2A41] dark:text-white border-b border-slate-100 dark:border-slate-800 pb-1.5">
                      Columnas Visibles
                    </div>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {rgColumns.map((col) => (
                        <label
                          key={col.id}
                          className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 p-1.5 rounded-md cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={col.visible}
                            onChange={() => handleToggleRgColumn(col.id)}
                            className="rounded text-[#0054A6] focus:ring-[#0054A6]"
                          />
                          <span>{col.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Barra de Filtros de Resource Groups */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar grupo de recursos, suscripción..."
              value={rgSearch}
              onChange={(e) => {
                setRgSearch(e.target.value);
                setRgPage(1);
              }}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0054A6]"
            />
          </div>

          <div>
            <select
              value={rgComplianceFilter}
              onChange={(e) => {
                setRgComplianceFilter(e.target.value);
                setRgPage(1);
              }}
              className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0054A6]"
            >
              <option value="ALL">Estado: Todos</option>
              <option value="NON_COMPLIANT">No Conforme (Faltan Tags)</option>
              <option value="COMPLIANT">100% Conforme</option>
            </select>
          </div>

          <div>
            <select
              value={rgSort}
              onChange={(e) => setRgSort(e.target.value as any)}
              className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0054A6]"
            >
              <option value="NON_COMPLIANT_FIRST">Priorizar No Conformes</option>
              <option value="AZ">Nombre: A-Z</option>
              <option value="ZA">Nombre: Z-A</option>
            </select>
          </div>
        </div>

        {/* Tabla de Resource Groups con Columnas Redimensionables & macOS Scroll */}
        <div className="w-full overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 select-none">
              <tr>
                {isRgColVisible("resourceGroup") && (
                  <ResizableTh minWidth={160} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Grupo de Recursos
                  </ResizableTh>
                )}
                {isRgColVisible("subscription") && (
                  <ResizableTh minWidth={130} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Suscripción
                  </ResizableTh>
                )}
                {isRgColVisible("location") && (
                  <ResizableTh minWidth={100} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Región
                  </ResizableTh>
                )}
                {isRgColVisible("status") && (
                  <ResizableTh minWidth={130} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Estado de Cumplimiento
                  </ResizableTh>
                )}
                {isRgColVisible("missingTags") && (
                  <ResizableTh minWidth={150} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Etiquetas Faltantes
                  </ResizableTh>
                )}
                {isRgColVisible("childCount") && (
                  <ResizableTh minWidth={120} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Recursos Contenidos
                  </ResizableTh>
                )}
                {isRgColVisible("actions") && (
                  <th className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-200 text-right">
                    Acciones
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {pagedRgs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No se encontraron grupos de recursos que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                pagedRgs.map((rg) => (
                  <tr key={rg.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                    {isRgColVisible("resourceGroup") && (
                      <td className="py-3 px-4 font-medium text-[#1B2A41] dark:text-white break-words">
                        <div className="flex items-center gap-1.5">
                          <IconFolder size={15} className="text-[#0078D4] shrink-0" stroke={1.5} />
                          <span>{rg.resourceGroupName}</span>
                        </div>
                      </td>
                    )}

                    {isRgColVisible("subscription") && (
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300 break-words">
                        {rg.subscriptionName}
                      </td>
                    )}

                    {isRgColVisible("location") && (
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {rg.location}
                      </td>
                    )}

                    {isRgColVisible("status") && (
                      <td className="py-3 px-4">
                        {rg.complianceStatus === "COMPLIANT" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            <IconCheck size={13} stroke={2} />
                            100% Compliant
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                            <IconAlertCircle size={13} stroke={2} />
                            No Conforme
                          </span>
                        )}
                      </td>
                    )}

                    {isRgColVisible("missingTags") && (
                      <td className="py-3 px-4">
                        {rg.missingTags.length === 0 ? (
                          <span className="text-[11px] text-slate-400">Todas presentes</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {rg.missingTags.map((t) => (
                              <span
                                key={t}
                                className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                              >
                                {t.toUpperCase()}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    )}

                    {isRgColVisible("childCount") && (
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300 font-semibold">
                        {rg.childResourcesCount} recursos
                      </td>
                    )}

                    {isRgColVisible("actions") && (
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <button
                            onClick={() => handleOpenEdit(rg, "rg")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 transition-colors shadow-2xs"
                          >
                            <IconEdit size={13} stroke={1.5} />
                            Editar RG
                          </button>
                          <button
                            onClick={() => setInheritingRg(rg)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 transition-colors shadow-2xs"
                          >
                            <IconShare size={13} stroke={1.5} className="text-[#0078D4]" />
                            Propagar a Hijos
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación de RGs */}
        <Pagination
          page={rgPage}
          setPage={setRgPage}
          pageSize={rgPageSize}
          setPageSize={setRgPageSize}
          total={filteredRgs.length}
          totalPages={Math.max(1, Math.ceil(filteredRgs.length / rgPageSize))}
          pageSizes={[15, 30, 45, 60]}
        />
      </div>

      {/* Modal de Edición de Etiquetas (z-[100]) */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[100] animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-[#1B2A41] dark:text-white font-['Montserrat']">
                  Editar Etiquetas {editingItem.type === "rg" ? "de Grupo de Recursos" : "de Recurso"}
                </h3>
                <div className="text-xs text-slate-500 font-mono break-all">{editingItem.name}</div>
              </div>
              <button
                onClick={() => setEditingItem(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <IconX size={20} />
              </button>
            </div>

            {/* Botones de Asistencia Rápida */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleAiSuggest}
                disabled={isSuggestingAi}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300 hover:bg-blue-100 transition-colors shadow-2xs"
              >
                <IconSparkles size={15} stroke={1.5} className="text-[#0078D4]" />
                {isSuggestingAi ? "Infiriendo con IA..." : "Autocompletar con IA"}
              </button>

              {editingItem.type === "resource" && editingItem.resourceGroup && (
                <button
                  type="button"
                  onClick={handleCopyFromRg}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 transition-colors shadow-2xs"
                >
                  <IconArrowDownRight size={15} stroke={1.5} />
                  Copiar valores del Resource Group
                </button>
              )}
            </div>

            <form onSubmit={handleSaveTags} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Environment <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={tagForm.Environment}
                    onChange={(e) => setTagForm({ ...tagForm, Environment: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0054A6]"
                  >
                    <option value="">Seleccionar entorno...</option>
                    <option value="prod">prod (Producción)</option>
                    <option value="stg">stg (Staging / Pre-producción)</option>
                    <option value="dev">dev (Desarrollo)</option>
                    <option value="qa">qa (Testing / QA)</option>
                    <option value="sandbox">sandbox (Sandbox / Laboratorio)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Role <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="ej. database, api, frontend, worker"
                    value={tagForm.Role}
                    onChange={(e) => setTagForm({ ...tagForm, Role: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0054A6]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    CostCenter <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="ej. FinOps, Engineering, CorePlatform"
                    value={tagForm.CostCenter}
                    onChange={(e) => setTagForm({ ...tagForm, CostCenter: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0054A6]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Department <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="ej. CloudOps, DataTeam, SecurityOps"
                    value={tagForm.Department}
                    onChange={(e) => setTagForm({ ...tagForm, Department: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0054A6]"
                  />
                </div>
              </div>

              {/* Botones del Modal */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition-colors shadow-2xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingTags}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 transition-colors shadow-2xs"
                >
                  <IconDeviceFloppy size={16} stroke={1.5} />
                  {isSavingTags ? "Guardando..." : "Guardar Etiquetas"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmación de Propagación de RG (z-[100]) */}
      {inheritingRg && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[100] animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-[#1B2A41] dark:text-white font-['Montserrat']">
                Propagar Etiquetas a Recursos Hijos
              </h3>
              <button
                onClick={() => closeInheritModal()}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <IconX size={20} />
              </button>
            </div>

            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-2">
              <p>
                ¿Deseas propagar automáticamente las etiquetas de <strong>{inheritingRg.resourceGroupName}</strong> a todos sus <strong>{inheritingRg.childResourcesCount} recursos contenidos</strong>?
              </p>
              {/* La copy sigue al modo elegido: antes afirmaba siempre "no serán
                  sobreescritas", así que con la casilla marcada estaría
                  prometiendo lo contrario de lo que hace. */}
              {inheritOverwrite ? (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 rounded-xl text-[11px] text-amber-900 dark:text-amber-300">
                  <strong>Sobrescritura activada:</strong> las etiquetas del Resource Group reemplazarán el valor que ya tengan los recursos hijos. Los valores actuales se pierden y la acción no se puede deshacer.
                </div>
              ) : (
                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 rounded-xl text-[11px] text-blue-900 dark:text-blue-300">
                  <strong>Política de Merge Seguro:</strong> Las etiquetas preexistentes en los recursos hijos no serán sobreescritas. Solo se inyectarán las etiquetas faltantes del Resource Group.
                </div>
              )}

              <label className="flex items-start gap-2 cursor-pointer select-none pt-1">
                <input
                  type="checkbox"
                  checked={inheritOverwrite}
                  onChange={(e) => setInheritOverwrite(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-600 accent-amber-600 cursor-pointer"
                />
                <span className="text-[11px] text-slate-700 dark:text-slate-300">
                  Sobrescribir valores existentes
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                    Pisa el valor propio del recurso hijo cuando la etiqueta ya existe.
                  </span>
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => closeInheritModal()}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition-colors shadow-2xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmInherit}
                disabled={isInheriting}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 transition-colors shadow-2xs"
              >
                <IconShare size={16} stroke={1.5} className="text-[#0078D4]" />
                {isInheriting ? "Propagando..." : "Confirmar y Propagar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Gestión de Políticas (z-[100]) */}
      {showPolicyModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[100] animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-[#1B2A41] dark:text-white font-['Montserrat']">
                Políticas Globales de Etiquetado Obligatorio
              </h3>
              <button
                onClick={() => setShowPolicyModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <IconX size={20} />
              </button>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#1B2A41] dark:text-white">Environment</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-[#0078D4] border border-blue-200">
                    OBLIGATORIA
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Entorno operativo del recurso para imputación y segregación de costos (prod, stg, dev, qa, sandbox).
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#1B2A41] dark:text-white">Role</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-[#0078D4] border border-blue-200">
                    OBLIGATORIA
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Función o carga de trabajo principal en la arquitectura de soluciones.
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#1B2A41] dark:text-white">CostCenter</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-[#0078D4] border border-blue-200">
                    OBLIGATORIA
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Centro de costos o unidad de negocio responsable del gasto financiero.
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#1B2A41] dark:text-white">Department</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-[#0078D4] border border-blue-200">
                    OBLIGATORIA
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Equipo o departamento propietario del recurso para alertas y gobernanza.
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowPolicyModal(false)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 transition-colors shadow-2xs"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
