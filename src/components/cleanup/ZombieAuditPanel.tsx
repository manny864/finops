"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useSearchParams } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { toast } from "sonner";
import { errorMessage } from "@/lib/apiErrors";
import { useAIContext } from "@/hooks/useAIContext";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import {
  IconTrash,
  IconGhost,
  IconTag,
  IconShieldCheck,
  IconSearch,
  IconSparkles,
  IconRotateClockwise,
  IconAlertTriangle,
  IconCheck,
  IconX,
  IconDisc,
  IconServer,
  IconWorld,
  IconNetwork,
  IconCloud,
  IconCamera,
  IconShield,
  IconInfoCircle,
  IconColumns,
} from "@tabler/icons-react";
import {
  ZombieCategory,
  ZombieIssueType,
  ZombieResourceItem,
  ZombieAuditPayload,
} from "@/types/azureZombieAudit.types";

const VISIBLE_SCROLLBAR =
  "scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800";

function buildFetcher(instance: any, accounts: any[], isMock: boolean) {
  return async (url: string) => {
    if (isMock) {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Error cargando auditoría zombi demo");
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

/**
 * Un `fetch` sin comprobar `res.ok` reporta éxito ante un 401/403/500: la
 * respuesta llega, la promesa resuelve y el `catch` nunca se ejecuta. Como
 * estas mutaciones van precedidas de un `mutate(..., false)` optimista, el
 * fallo silencioso dejaba la tabla mostrando un estado que el servidor nunca
 * guardó (finding OPS-01, docs/security/audit-2026-08-21.md).
 */
async function postZombieAction(
  tenantId: string,
  token: string,
  body: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`/api/cleanup/zombies?tenantId=${encodeURIComponent(tenantId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

function money(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

function formatSubscriptionDisplay(name?: string, id?: string): string {
  const val = (name || id || "").trim();
  if (val.toLowerCase() === "ec03e8ce-ceee-4638-b303-64ae431d5b1e") return "CSCS-LandingZone";
  if (val === "demo-sub-01") return "CSCS-LandingZone-Production";
  if (val === "demo-sub-02") return "CSCS-DataPlatform-Analytics";
  return val || "Suscripción Azure";
}

function getResourceIcon(type: string) {
  const t = type.toLowerCase();
  if (t.includes("disk")) return <IconDisc className="w-4 h-4 text-[#0078D4]" stroke={1.5} />;
  if (t.includes("virtualmachine")) return <IconServer className="w-4 h-4 text-[#0078D4]" stroke={1.5} />;
  if (t.includes("publicip")) return <IconWorld className="w-4 h-4 text-[#0078D4]" stroke={1.5} />;
  if (t.includes("networkinterface")) return <IconNetwork className="w-4 h-4 text-[#0078D4]" stroke={1.5} />;
  if (t.includes("serverfarm") || t.includes("appservice")) return <IconCloud className="w-4 h-4 text-[#0078D4]" stroke={1.5} />;
  if (t.includes("snapshot")) return <IconCamera className="w-4 h-4 text-[#0078D4]" stroke={1.5} />;
  return <IconGhost className="w-4 h-4 text-[#0078D4]" stroke={1.5} />;
}

// ─── Modal de Etiquetado Masivo y Sugerencia con IA ───
interface TagModalProps {
  isOpen: boolean;
  onClose: () => void;
  resources: ZombieResourceItem[];
  onApplyTags: (tags: Record<string, string>) => Promise<void>;
}

function TaggingModal({ isOpen, onClose, resources, onApplyTags }: TagModalProps) {
  const [environment, setEnvironment] = useState<string>("Production");
  const [costCenter, setCostCenter] = useState<string>("FinOps-Core");
  const [owner, setOwner] = useState<string>("CloudOps");
  const [isSuggesting, setIsSuggesting] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [aiAnalysisReady, setAiAnalysisReady] = useState<boolean>(false);
  const triggerCopilotWithPrompt = useAIContext((state) => state.triggerCopilotWithPrompt);

  const handleAiSuggest = () => {
    setIsSuggesting(true);
    if (resources.length > 0) {
      const first = resources[0];
      const rg = (first.resourceGroup || "").toLowerCase();
      const rName = (first.name || "").toLowerCase();
      const detectedEnv = rg.includes("prod") || rName.includes("prod") ? "Production" : rg.includes("stg") || rName.includes("stg") || rg.includes("qa") ? "Staging" : "Development";
      const detectedCc = rg.includes("data") || rName.includes("data") || rName.includes("sql") ? "Data-Platform" : rg.includes("net") || rName.includes("vnet") || rName.includes("pip") ? "Networking" : "Core-Infrastructure";
      const detectedOwner = rg.includes("data") ? "DataEngineering@company.com" : rg.includes("net") ? "SecOps@company.com" : "CloudOps@company.com";
      
      setEnvironment(detectedEnv);
      setCostCenter(detectedCc);
      setOwner(detectedOwner);
      setAiAnalysisReady(true);

      const resList = resources.slice(0, 5).map(r => `• **${r.name}** (${r.typeDisplayName || r.resourceType} en RG \`${r.resourceGroup}\` - Región: ${r.location})`).join("\n");
      const prompt = `Analiza y sugiere etiquetas FinOps de asignación y gobernanza para ${resources.length === 1 ? `el recurso zombi **${resources[0].name}**` : `${resources.length} recursos zombis seleccionados`}:\n\n${resList}${resources.length > 5 ? `\n• ...y ${resources.length - 5} recursos más` : ""}\n\n**Etiquetas autocompletadas en el modal:**\n- **Environment**: \`${detectedEnv}\`\n- **CostCenter**: \`${detectedCc}\`\n- **Owner**: \`${detectedOwner}\`\n\nPor favor, valida la idoneidad de estos valores según las directivas FinOps Foundation, showback financiero y prevención de gasto huérfano.`;

      // Si FinOps Copilot está minimizado, se abre automáticamente y muestra el resultado del análisis
      triggerCopilotWithPrompt(prompt);
    }
    setTimeout(() => {
      setIsSuggesting(false);
    }, 300);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onApplyTags({
        Environment: environment,
        CostCenter: costCenter,
        Owner: owner,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl z-[100] space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <IconTag className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">
              Etiquetar Recursos FinOps ({resources.length})
            </h3>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
            <IconX className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-blue-50/50 dark:bg-blue-950/20 p-3 rounded-xl border border-blue-200 dark:border-blue-900 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                Autocompletar y consultar FinOps Copilot
              </span>
              <button
                type="button"
                onClick={handleAiSuggest}
                disabled={isSuggesting}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 transition inline-flex items-center cursor-pointer shadow-xs"
              >
                <IconSparkles size={16} stroke={1.5} className="inline mr-1.5 text-[#0078D4]" />
                <span>{isSuggesting ? "Analizando..." : "Sugerir con IA"}</span>
              </button>
            </div>
            {aiAnalysisReady && (
              <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 pt-1 border-t border-blue-200/50 dark:border-blue-800/50">
                <IconCheck className="w-3.5 h-3.5" />
                <span>Etiquetas autocompletadas y análisis desplegado en FinOps Copilot.</span>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-200">Environment</label>
            <input
              type="text"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-200">CostCenter</label>
            <input
              type="text"
              value={costCenter}
              onChange={(e) => setCostCenter(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-200">Owner</label>
            <input
              type="text"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 text-slate-600 bg-white hover:bg-slate-50 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-[#0054A6] text-white hover:bg-[#004080] transition cursor-pointer shadow-xs disabled:opacity-60"
            >
              {isSubmitting ? "Aplicando..." : "Guardar Etiquetas"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal / Drawer de Exención con Justificación ───
interface ExemptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  resource: ZombieResourceItem | null;
  onConfirmExemption: (reason: string, durationDays: number) => Promise<void>;
}

function ExemptionModal({ isOpen, onClose, resource, onConfirmExemption }: ExemptionModalProps) {
  const [reason, setReason] = useState<string>("Ambiente DR de Contingencia y Replicación Fría");
  const [durationDays, setDurationDays] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen || !resource) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onConfirmExemption(reason, durationDays);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl z-[100] space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <IconShieldCheck className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">
              Eximir Recurso de la Auditoría
            </h3>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
            <IconX className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs">
            <span className="font-bold text-[#1B2A41] dark:text-slate-100 block">{resource.name}</span>
            <span className="text-slate-400 font-mono text-[11px] block truncate">{resource.id}</span>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-200">
              Motivo o Justificación Técnica de la Exención
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-200">
              Plazo de Supresión de Alerta
            </label>
            <select
              value={durationDays}
              onChange={(e) => setDurationDays(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
            >
              <option value={0}>Indefinido (Hasta revocación manual)</option>
              <option value={30}>30 Días (Prueba temporal autorizada)</option>
              <option value={90}>90 Días (Proyecto de migración en curso)</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 text-slate-600 bg-white hover:bg-slate-50 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-[#0054A6] text-white hover:bg-[#004080] transition cursor-pointer shadow-xs disabled:opacity-60"
            >
              {isSubmitting ? "Guardando..." : "Confirmar Exención"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function ZombieAuditPanel() {
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || "";
  const searchParams = useSearchParams();
  const { instance, accounts } = useMsal();
  const triggerCopilotWithPrompt = useAIContext((state) => state.triggerCopilotWithPrompt);

  const isMock = useMemo(
    () =>
      isMockTenant(tenantId) ||
      searchParams.get("mock") === "true" ||
      tenantId.startsWith("demo-") ||
      tenantId.startsWith("mock-"),
    [tenantId, searchParams]
  );

  const fetcher = useMemo(() => buildFetcher(instance, accounts, isMock), [instance, accounts, isMock]);
  const apiUrl = `/api/cleanup/zombies?tenantId=${encodeURIComponent(tenantId)}`;
  const { data, error, isValidating, mutate } = useSWR<ZombieAuditPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  // Filtros
  const [searchName, setSearchName] = useState<string>("");
  const [filterSubscription, setFilterSubscription] = useState<string>("ALL");
  const [filterIssue, setFilterIssue] = useState<string>("ALL");
  const [filterRegion, setFilterRegion] = useState<string>("ALL");
  const [filterResourceGroup, setFilterResourceGroup] = useState<string>("ALL");
  const [filterSeverity, setFilterSeverity] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<"ACTIVE" | "EXEMPTED" | "ALL">("ACTIVE");
  const [sortBy, setSortBy] = useState<"SAVINGS_DESC" | "SAVINGS_ASC" | "NAME_ASC" | "NAME_DESC" | "SEVERITY">("SAVINGS_DESC");

  // Selección Múltiple
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Personalización de Columnas y Persistencia en LocalStorage
  const [columns, setColumns] = useState([
    { id: "resource", label: "Recurso", visible: true, minWidth: 200 },
    { id: "subscription", label: "Suscripción", visible: true, minWidth: 140 },
    { id: "region", label: "Región", visible: true, minWidth: 90 },
    { id: "type", label: "Tipo de Recurso", visible: true, minWidth: 130 },
    { id: "resourceGroup", label: "Grupo de Recursos", visible: true, minWidth: 130 },
    { id: "issue", label: "Problema Detectado", visible: true, minWidth: 180 },
    { id: "savings", label: "Ahorro Est.", visible: true, minWidth: 110 },
    { id: "actions", label: "Acciones", visible: true, minWidth: 220 },
  ]);
  const [showColumnMenu, setShowColumnMenu] = useState<boolean>(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || !tenantId) return;
    const key = `table_columns_config_zombies_${tenantId}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setColumns((prev) =>
            prev.map((col) => {
              const match = parsed.find((p: any) => p.id === col.id);
              return match ? { ...col, visible: match.visible } : col;
            })
          );
        }
      }
    } catch {}
  }, [tenantId]);

  const toggleColumn = (colId: string) => {
    setColumns((prev) => {
      const next = prev.map((col) => (col.id === colId ? { ...col, visible: !col.visible } : col));
      if (typeof window !== "undefined" && tenantId) {
        try {
          localStorage.setItem(`table_columns_config_zombies_${tenantId}`, JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  };

  const isColVisible = (id: string) => columns.find((c) => c.id === id)?.visible ?? true;

  // Modales
  const [tagModalItems, setTagModalItems] = useState<ZombieResourceItem[]>([]);
  const [exemptionModalItem, setExemptionModalItem] = useState<ZombieResourceItem | null>(null);

  const metrics = data?.metrics;
  const rawResources = useMemo(() => metrics?.resources || [], [metrics]);

  // Listas de valores únicos para dropdowns
  const uniqueSubscriptions = useMemo(
    () => Array.from(new Set(rawResources.map((r) => formatSubscriptionDisplay(r.subscriptionName, r.subscriptionId)).filter(Boolean))),
    [rawResources]
  );
  const uniqueRegions = useMemo(
    () => Array.from(new Set(rawResources.map((r) => r.location).filter(Boolean))),
    [rawResources]
  );
  const uniqueResourceGroups = useMemo(
    () => Array.from(new Set(rawResources.map((r) => r.resourceGroup).filter(Boolean))),
    [rawResources]
  );

  // Filtrado y Ordenamiento
  const filteredResources = useMemo(() => {
    return rawResources.filter((r) => {
      if (searchName && !r.name.toLowerCase().includes(searchName.toLowerCase())) return false;
      const subDisplay = formatSubscriptionDisplay(r.subscriptionName, r.subscriptionId);
      if (filterSubscription !== "ALL" && subDisplay !== filterSubscription) return false;
      if (filterIssue !== "ALL") {
        if (filterIssue === "HARD_WASTE" && r.category !== "HARD_WASTE") return false;
        if (filterIssue === "SOFT_WASTE" && r.hasTags) return false;
        if (filterIssue === "UNATTACHED_DISK" && r.issueType !== "UNATTACHED_DISK") return false;
        if (filterIssue === "DEALLOCATED_VM" && r.issueType !== "DEALLOCATED_VM_WITH_DISKS") return false;
        if (filterIssue === "ORPHAN_IP" && r.issueType !== "ORPHAN_PUBLIC_IP") return false;
      }
      if (filterRegion !== "ALL" && r.location !== filterRegion) return false;
      if (filterResourceGroup !== "ALL" && r.resourceGroup !== filterResourceGroup) return false;
      if (filterSeverity !== "ALL" && r.severity !== filterSeverity) return false;
      if (filterStatus === "ACTIVE" && r.isExempted) return false;
      if (filterStatus === "EXEMPTED" && !r.isExempted) return false;
      return true;
    }).sort((a, b) => {
      if (sortBy === "SAVINGS_DESC") return b.monthlySavingsUSD - a.monthlySavingsUSD;
      if (sortBy === "SAVINGS_ASC") return a.monthlySavingsUSD - b.monthlySavingsUSD;
      if (sortBy === "NAME_ASC") return a.name.localeCompare(b.name);
      if (sortBy === "NAME_DESC") return b.name.localeCompare(a.name);
      if (sortBy === "SEVERITY") {
        const order = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        return order[b.severity] - order[a.severity];
      }
      return 0;
    });
  }, [
    rawResources,
    searchName,
    filterSubscription,
    filterIssue,
    filterRegion,
    filterResourceGroup,
    filterSeverity,
    filterStatus,
    sortBy,
  ]);

  const { paged, page, totalPages, pageSize, setPage, setPageSize, total } = usePagination(
    filteredResources,
    15
  );

  // Selección
  const isAllPageSelected = useMemo(
    () => paged.length > 0 && paged.every((r) => selectedIds.has(r.id)),
    [paged, selectedIds]
  );

  const toggleSelectAllPage = () => {
    const next = new Set(selectedIds);
    if (isAllPageSelected) {
      paged.forEach((r) => next.delete(r.id));
    } else {
      paged.forEach((r) => next.add(r.id));
    }
    setSelectedIds(next);
  };

  const toggleSelectOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const selectedResources = useMemo(
    () => rawResources.filter((r) => selectedIds.has(r.id)),
    [rawResources, selectedIds]
  );

  const selectedPotentialSavings = useMemo(
    () => selectedResources.reduce((sum, r) => sum + r.monthlySavingsUSD, 0),
    [selectedResources]
  );

  // Operaciones Masivas y Optimistas
  const handleApplyTags = async (tags: Record<string, string>) => {
    const ids = tagModalItems.map((r) => r.id);
    if (ids.length === 0) return;

    // Actualización optimista local
    mutate(
      (current) => {
        if (!current) return current;
        const nextResources = current.metrics.resources.map((r) => {
          if (ids.includes(r.id)) {
            return {
              ...r,
              hasTags: true,
              currentTags: { ...r.currentTags, ...tags },
              category: r.category === "SOFT_WASTE_TAGS" ? "HARD_WASTE" : r.category,
            };
          }
          return r;
        });
        return {
          ...current,
          metrics: {
            ...current.metrics,
            resources: nextResources,
            untaggedResourcesCount: nextResources.filter((r) => !r.isExempted && !r.hasTags).length,
          },
        };
      },
      false
    );

    try {
      const token = isMock ? "demo" : await getFreshIdToken(instance, accounts[0], ["User.Read"]);
      await postZombieAction(tenantId, token, { action: "TAG", resourceIds: ids, tags });
      toast.success(`${ids.length} recurso(s) etiquetados`);
      setSelectedIds(new Set());
    } catch (e) {
      // Revalidar descarta la actualización optimista y devuelve la tabla al
      // estado real del servidor.
      toast.error(errorMessage(e) || "No se pudieron aplicar las etiquetas");
      mutate();
    }
  };

  const handleConfirmExemption = async (reason: string, durationDays: number) => {
    if (!exemptionModalItem) return;
    const res = exemptionModalItem;

    // Actualización optimista local
    mutate(
      (current) => {
        if (!current) return current;
        const nextResources = current.metrics.resources.map((r) => {
          if (r.id === res.id) {
            return { ...r, isExempted: true, exemptionReason: reason };
          }
          return r;
        });
        return {
          ...current,
          metrics: {
            ...current.metrics,
            resources: nextResources,
            exemptedResourcesCount: nextResources.filter((r) => r.isExempted).length,
            hardWasteZombiesCount: nextResources.filter((r) => !r.isExempted && r.category === "HARD_WASTE").length,
            totalPotentialSavingsUSD: nextResources
              .filter((r) => !r.isExempted && r.category === "HARD_WASTE")
              .reduce((sum, r) => sum + r.monthlySavingsUSD, 0),
          },
        };
      },
      false
    );

    try {
      const token = isMock ? "demo" : await getFreshIdToken(instance, accounts[0], ["User.Read"]);
      await postZombieAction(tenantId, token, {
        action: "EXEMPT",
        resourceId: res.id,
        resourceName: res.name,
        resourceType: res.resourceType,
        reason,
        durationDays,
      });
      toast.success("Recurso eximido de la auditoría");
    } catch (e) {
      toast.error(errorMessage(e) || "No se pudo guardar la exención");
      mutate();
    }
  };

  const handleRemoveExemption = async (res: ZombieResourceItem) => {
    mutate(
      (current) => {
        if (!current) return current;
        const nextResources = current.metrics.resources.map((r) => {
          if (r.id === res.id) {
            return { ...r, isExempted: false, exemptionReason: undefined };
          }
          return r;
        });
        return {
          ...current,
          metrics: {
            ...current.metrics,
            resources: nextResources,
            exemptedResourcesCount: nextResources.filter((r) => r.isExempted).length,
          },
        };
      },
      false
    );

    try {
      const token = isMock ? "demo" : await getFreshIdToken(instance, accounts[0], ["User.Read"]);
      await postZombieAction(tenantId, token, { action: "REMOVE_EXEMPTION", resourceId: res.id });
      toast.success("Exención removida");
    } catch (e) {
      toast.error(errorMessage(e) || "No se pudo remover la exención");
      mutate();
    }
  };

  const handleBulkRemediate = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    const targets = rawResources.filter((r) => ids.includes(r.id));
    if (targets.length === 0) return;

    if (
      !confirm(
        `Se eliminarán ${targets.length} recurso(s) de Azure de forma irreversible. Ahorro estimado: ${money(
          selectedPotentialSavings
        )}/mes. ¿Confirmás?`
      )
    ) {
      return;
    }

    const token = isMock ? "demo" : await getFreshIdToken(instance, accounts[0], ["User.Read"]);

    // El borrado real vive en /api/remediation (deleteResource + ActionLogs +
    // invalidación de caché). La acción REMEDIATE de /api/cleanup/zombies no
    // ejecuta nada: devolvía success y el recurso seguía facturando.
    // Secuencial y no en Promise.all: cada borrado es irreversible y hay que
    // poder decir exactamente cuál falló.
    const failed: string[] = [];
    for (const res of targets) {
      try {
        const r = await fetch(`/api/remediation`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            tenantId,
            domain: "zombies",
            resourceId: res.id,
            resourceType: res.resourceType,
            subscriptionId: res.subscriptionId,
            resourceGroup: res.resourceGroup,
            resourceName: res.name,
            action: "DELETE",
          }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${r.status}`);
        }
      } catch (e) {
        failed.push(`${res.name}: ${errorMessage(e)}`);
      }
    }

    const ok = targets.length - failed.length;
    if (ok > 0) toast.success(`${ok} recurso(s) eliminados`);
    if (failed.length > 0) toast.error(`${failed.length} fallaron — ${failed[0]}`);
    setSelectedIds(new Set());
    mutate();
  };

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado y Acciones ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconGhost className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>Auditoría de Recursos Zombis &amp; Limpieza Cloud</span>
            </h1>
            <InfoTooltip content="Detección continua mediante Azure Resource Graph (ARG) de recursos huérfanos con costo real (Hard Waste), falta de gobernanza de etiquetas (Soft Waste) y reglas de exención persistentes." />
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {isMock ? "Entorno Demo" : "Producción Live"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Motor Omni-Scan con soporte para 25 tipos de recursos, clasificación de desperdicio y actualización optimista de tags
          </p>
        </div>

        <button
          onClick={() => mutate()}
          disabled={isValidating}
          className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60 self-start md:self-auto"
          title="Escanear recursos zombis"
        >
          <IconRotateClockwise className={`w-4 h-4 text-[#0078D4] ${isValidating ? "animate-spin" : ""}`} stroke={1.5} />
          <span>Escanear Ahora</span>
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
            label: "Ahorro Mensual Inmediato (Hard Waste)",
            tip: "Gasto mensual directo evitable al eliminar recursos huérfanos sin carga activa.",
            value: money(metrics?.totalPotentialSavingsUSD ?? 0) + "/mes",
            sub: `${metrics?.hardWasteZombiesCount ?? 0} zombis activos con costo`,
            Icon: IconTrash,
          },
          {
            label: "Recursos Zombis Detectados",
            tip: "Total de recursos huérfanos identificados (discos, NICs, IPs, ASPs vacíos).",
            value: String(metrics?.hardWasteZombiesCount ?? 0),
            sub: "Pendientes de remediación",
            Icon: IconGhost,
          },
          {
            label: "Recursos sin Etiquetas FinOps",
            tip: "Componentes activos que no cuentan con las tags mínimas de gobernanza (Environment, CostCenter, Owner).",
            value: String(metrics?.untaggedResourcesCount ?? 0),
            sub: "Falta de higiene / Soft Waste",
            Icon: IconTag,
          },
          {
            label: "Recursos Eximidos / Whitelist",
            tip: "Recursos autorizados con justificación técnica persistida en base de datos.",
            value: String(metrics?.exemptedResourcesCount ?? 0),
            sub: "Exclusiones de auditoría",
            Icon: IconShieldCheck,
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

      {/* ─── Barra de Filtros y Búsqueda Superior ─── */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs">
          {/* Búsqueda por Nombre */}
          <div className="relative">
            <IconSearch className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              placeholder="Buscar por nombre..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
            />
          </div>

          {/* Filtro Suscripción */}
          <select
            value={filterSubscription}
            onChange={(e) => setFilterSubscription(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
          >
            <option value="ALL">Suscripción: Todas</option>
            {uniqueSubscriptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* Filtro Tipo de Problema */}
          <select
            value={filterIssue}
            onChange={(e) => setFilterIssue(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
          >
            <option value="ALL">Problema: Todos</option>
            <option value="HARD_WASTE">Hard Waste (Con Costo)</option>
            <option value="SOFT_WASTE">Soft Waste (Sin Tags)</option>
            <option value="UNATTACHED_DISK">Discos Huérfanos</option>
            <option value="DEALLOCATED_VM">VMs Apagadas</option>
            <option value="ORPHAN_IP">IPs Públicas Huérfanas</option>
          </select>

          {/* Filtro Región */}
          <select
            value={filterRegion}
            onChange={(e) => setFilterRegion(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
          >
            <option value="ALL">Región: Todas</option>
            {uniqueRegions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          {/* Filtro Grupo de Recursos */}
          <select
            value={filterResourceGroup}
            onChange={(e) => setFilterResourceGroup(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
          >
            <option value="ALL">Grupo: Todos</option>
            {uniqueResourceGroups.map((rg) => (
              <option key={rg} value={rg}>
                {rg}
              </option>
            ))}
          </select>

          {/* Filtro Estado */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
          >
            <option value="ACTIVE">Estado: Activos Pendientes</option>
            <option value="EXEMPTED">Estado: Eximidos / Whitelist</option>
            <option value="ALL">Estado: Todos</option>
          </select>

          {/* Ordenar */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
          >
            <option value="SAVINGS_DESC">Ahorro: Mayor a Menor</option>
            <option value="SAVINGS_ASC">Ahorro: Menor a Mayor</option>
            <option value="NAME_ASC">Nombre: A - Z</option>
            <option value="NAME_DESC">Nombre: Z - A</option>
            <option value="SEVERITY">Severidad: Crítica a Baja</option>
          </select>
        </div>
      </div>

      {/* ─── Banner de Selección Múltiple y Acciones Masivas ─── */}
      {selectedIds.size > 0 && (
        <div className="p-3.5 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-[#0054A6]">
              {selectedIds.size} recurso(s) seleccionado(s)
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-extrabold bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 text-[#0054A6]">
              Ahorro potencial: {money(selectedPotentialSavings)}/mes
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setTagModalItems(selectedResources)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 transition inline-flex items-center cursor-pointer shadow-xs"
            >
              <IconTag size={16} stroke={1.5} className="inline mr-1.5 text-[#0078D4]" />
              <span>Etiquetar seleccionados</span>
            </button>

            <button
              onClick={handleBulkRemediate}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 transition inline-flex items-center cursor-pointer shadow-xs"
            >
              <IconSparkles size={16} stroke={1.5} className="inline mr-1.5 text-[#0078D4]" />
              <span>Ejecutar Remediación Masiva</span>
            </button>

            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 transition cursor-pointer shadow-xs"
            >
              Limpiar selección
            </button>
          </div>
        </div>
      )}

      {/* ─── Tabla "Auditoría de Recursos Zombis" ─── */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <IconGhost className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
              Inventario de Recursos Huérfanos y Zombis
            </h2>
            <InfoTooltip content="Recursos cloud detectados con desperdicio financiero o sin cumplimiento de etiquetas FinOps requeridas." />
          </div>

          <div className="flex items-center gap-2 relative">
            <button
              onClick={() => setShowColumnMenu(!showColumnMenu)}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <IconColumns size={16} className="inline mr-1.5 text-[#0078D4]" />
              <span>Personalizar Columnas</span>
            </button>

            {showColumnMenu && (
              <div className="absolute right-0 top-9 w-52 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-[100] space-y-2 animate-in fade-in zoom-in-95">
                <div className="text-[11px] font-bold text-[#1B2A41] dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 pb-1 flex justify-between items-center">
                  <span>Columnas Visibles</span>
                  <button onClick={() => setShowColumnMenu(false)} className="text-slate-400 hover:text-slate-600">
                    <IconX size={14} />
                  </button>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {columns.map((col) => (
                    <label key={col.id} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={col.visible}
                        onChange={() => toggleColumn(col.id)}
                        className="rounded text-[#0054A6] cursor-pointer"
                      />
                      <span>{col.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-blue-200 dark:border-blue-800 text-[#0054A6] bg-white dark:bg-slate-900">
              {filteredResources.length} Recursos Listados
            </span>
          </div>
        </div>

        <div className={`overflow-x-auto ${VISIBLE_SCROLLBAR}`}>
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-800/30">
                <th className="py-3 px-3 w-8">
                  <input
                    type="checkbox"
                    checked={isAllPageSelected}
                    onChange={toggleSelectAllPage}
                    className="rounded text-[#0054A6] cursor-pointer"
                  />
                </th>
                {isColVisible("resource") && (
                  <ResizableTh minWidth={180} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Recurso
                  </ResizableTh>
                )}
                {isColVisible("subscription") && (
                  <ResizableTh minWidth={140} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Suscripción
                  </ResizableTh>
                )}
                {isColVisible("region") && (
                  <ResizableTh minWidth={90} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Región
                  </ResizableTh>
                )}
                {isColVisible("type") && (
                  <ResizableTh minWidth={130} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Tipo de Recurso
                  </ResizableTh>
                )}
                {isColVisible("resourceGroup") && (
                  <ResizableTh minWidth={130} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Grupo de Recursos
                  </ResizableTh>
                )}
                {isColVisible("issue") && (
                  <ResizableTh minWidth={180} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Problema Detectado
                  </ResizableTh>
                )}
                {isColVisible("savings") && (
                  <ResizableTh minWidth={110} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200">
                    Ahorro Est.
                  </ResizableTh>
                )}
                {isColVisible("actions") && (
                  <ResizableTh minWidth={220} className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 text-right">
                    Acciones
                  </ResizableTh>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={columns.filter((c) => c.visible).length + 1} className="py-8 text-center text-slate-400">
                    No se encontraron recursos zombis con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                paged.map((res) => {
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
                            {getResourceIcon(res.resourceType)}
                            <div className="min-w-0">
                              <div className="font-bold text-[#1B2A41] dark:text-slate-100 break-words whitespace-normal leading-snug" title={res.name}>
                                {res.name}
                              </div>
                            </div>
                          </div>
                        </td>
                      )}

                      {isColVisible("subscription") && (
                        <td className="py-3 px-4">
                          <span className="font-semibold text-slate-600 dark:text-slate-300 block break-words whitespace-normal" title={res.subscriptionName}>
                            {formatSubscriptionDisplay(res.subscriptionName, res.subscriptionId)}
                          </span>
                        </td>
                      )}

                      {isColVisible("region") && (
                        <td className="py-3 px-4 text-slate-500 font-mono text-[11px] whitespace-nowrap">{res.location}</td>
                      )}

                      {isColVisible("type") && (
                        <td className="py-3 px-4">
                          <span className="text-xs text-slate-700 dark:text-slate-300 font-medium break-words whitespace-normal">
                            {res.typeDisplayName}
                          </span>
                        </td>
                      )}

                      {isColVisible("resourceGroup") && (
                        <td className="py-3 px-4">
                          <span className="text-slate-600 dark:text-slate-300 block break-words whitespace-normal" title={res.resourceGroup}>
                            {res.resourceGroup}
                          </span>
                        </td>
                      )}

                      {isColVisible("issue") && (
                        <td className="py-3 px-4">
                          {res.isExempted ? (
                            <span className="px-2 py-0.5 text-[11px] font-bold rounded-lg border border-slate-300 text-slate-600 bg-white dark:bg-slate-900 inline-block" title={res.exemptionReason}>
                              Eximido / Whitelist
                            </span>
                          ) : res.category === "HARD_WASTE" ? (
                            <span className="px-2 py-0.5 text-[11px] font-bold rounded-lg border border-rose-200 text-rose-700 bg-white dark:bg-slate-900 inline-block">
                              {res.issueDisplayName}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-[11px] font-bold rounded-lg border border-blue-200 text-[#0078D4] bg-white dark:bg-slate-900 inline-block">
                              Sin Etiquetas FinOps
                            </span>
                          )}
                        </td>
                      )}

                      {isColVisible("savings") && (
                        <td className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-100">
                          {res.monthlySavingsUSD > 0 ? money(res.monthlySavingsUSD) + "/mes" : "—"}
                        </td>
                      )}

                      {isColVisible("actions") && (
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            {res.isExempted ? (
                              <button
                                onClick={() => handleRemoveExemption(res)}
                                className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-slate-300 text-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 transition inline-flex items-center gap-1 cursor-pointer shadow-xs"
                                title="Reincorporar a la auditoría activa"
                              >
                                <IconRotateClockwise size={14} className="inline text-slate-500" />
                                <span>Reincorporar</span>
                              </button>
                            ) : (
                              <>
                                {!res.hasTags && (
                                  <>
                                    <button
                                      onClick={() => setTagModalItems([res])}
                                      className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#0054A6] text-[#0054A6] bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition inline-flex items-center gap-1 cursor-pointer shadow-xs"
                                      title="Fijar etiquetas en formulario"
                                    >
                                      <IconTag size={14} className="inline text-[#0078D4]" />
                                      <span>Fijar Tags</span>
                                    </button>
                                    <button
                                      onClick={() => {
                                        setTagModalItems([res]);
                                        const rg = (res.resourceGroup || "").toLowerCase();
                                        const rName = (res.name || "").toLowerCase();
                                        const detectedEnv = rg.includes("prod") || rName.includes("prod") ? "Production" : rg.includes("stg") || rName.includes("stg") ? "Staging" : "Development";
                                        const detectedCc = rg.includes("data") || rName.includes("data") ? "Data-Platform" : rg.includes("net") || rName.includes("vnet") ? "Networking" : "Core-Infrastructure";
                                        const detectedOwner = rg.includes("data") ? "DataEngineering@company.com" : "CloudOps@company.com";
                                        const prompt = `Analiza y sugiere etiquetas FinOps para el recurso zombi **${res.name}** (${res.typeDisplayName || res.resourceType} en grupo de recursos \`${res.resourceGroup}\` - Región: ${res.location}). Valores recomendados: Environment=\`${detectedEnv}\`, CostCenter=\`${detectedCc}\`, Owner=\`${detectedOwner}\`.`;
                                        triggerCopilotWithPrompt(prompt);
                                      }}
                                      className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#00AEEF] text-[#00AEEF] bg-white dark:bg-slate-900 hover:bg-sky-50/50 transition inline-flex items-center gap-1 cursor-pointer shadow-xs"
                                      title="Sugerir etiquetas con IA y desplegar FinOps Copilot"
                                    >
                                      <IconSparkles size={14} stroke={1.5} className="inline text-[#00AEEF]" />
                                      <span>Sugerir IA</span>
                                    </button>
                                  </>
                                )}

                                {res.category === "HARD_WASTE" && (
                                  <button
                                    onClick={() => {
                                      if (confirm(`¿Eliminar o purgar recurso ${res.name}?`)) {
                                        handleBulkRemediate();
                                      }
                                    }}
                                    className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-rose-300 text-rose-700 bg-white dark:bg-slate-900 hover:bg-rose-50/50 transition inline-flex items-center gap-1 cursor-pointer shadow-xs"
                                  >
                                    <IconTrash size={14} className="inline text-rose-600" />
                                    <span>Remediar</span>
                                  </button>
                                )}

                                <button
                                  onClick={() => setExemptionModalItem(res)}
                                  className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-slate-300 text-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 transition inline-flex items-center gap-1 cursor-pointer shadow-xs"
                                  title="Eximir o silenciar alerta para este recurso"
                                >
                                  <IconShield size={14} className="inline text-slate-500" />
                                  <span>Eximir</span>
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

      {/* ─── Modales ─── */}
      <TaggingModal
        isOpen={tagModalItems.length > 0}
        onClose={() => setTagModalItems([])}
        resources={tagModalItems}
        onApplyTags={handleApplyTags}
      />

      <ExemptionModal
        isOpen={Boolean(exemptionModalItem)}
        onClose={() => setExemptionModalItem(null)}
        resource={exemptionModalItem}
        onConfirmExemption={handleConfirmExemption}
      />
    </div>
  );
}
