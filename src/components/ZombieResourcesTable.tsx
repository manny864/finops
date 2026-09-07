"use client";
import React, { useEffect, useState, useMemo } from "react";
import { useMsal } from "@azure/msal-react";
import { useTenant } from "./TenantProvider";
import { useSubscription } from "./SubscriptionProvider";
import { useViewMode } from "../context/ViewModeContext";
import RoleAssignmentBanner from "./RoleAssignmentBanner";
import { toast } from "sonner";
import { useActionLogStore } from "@/store/actionLogStore";
import { useTranslations } from "next-intl";
import { useAIContext } from "@/hooks/useAIContext";
import { getMockDataForRoute, isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { GLOBAL_MANDATORY_TAGS, TAG_SUGGESTED_VALUES } from "@/lib/tagConfig";

/**
 * Un valor vacio por cada etiqueta obligatoria. El modal se arma sobre esta
 * lista, asi que agregar una etiqueta a la politica no requiere tocar el JSX.
 */
const ETIQUETAS_VACIAS: Record<string, string> = Object.fromEntries(
  GLOBAL_MANDATORY_TAGS.map((tag) => [tag, ""]),
);

/**
 * Adivina lo que se puede adivinar del nombre y del resource group.
 *
 * Solo `Environment`, y con el vocabulario que publica la tarjeta de politicas
 * (prod/stg/dev). Las otras quedan en blanco a proposito: la version anterior
 * rellenaba `Owner` con "CloudOps@company.com" y `CostCenter` con
 * "Core-Infrastructure" --valores inventados que no existen en ninguna politica
 * del cliente-- y el usuario los aplicaba sobre recursos reales de Azure sin
 * darse cuenta de que eran de relleno.
 */
function sugerirEtiquetas(resourceGroup?: string, resourceName?: string): Record<string, string> {
  const texto = `${resourceGroup || ""} ${resourceName || ""}`.toLowerCase();
  const entorno = /\bprod/.test(texto) ? "prod" : /\bstg|staging/.test(texto) ? "stg" : /\bqa\b/.test(texto) ? "qa" : /\bdev/.test(texto) ? "dev" : "";
  return { ...ETIQUETAS_VACIAS, ...(entorno && "Environment" in ETIQUETAS_VACIAS ? { Environment: entorno } : {}) };
}
import { canDeleteResources, canRemediateTags } from "@/lib/tierLogic";
import EnterpriseDeleteDisclaimer from "@/components/EnterpriseDeleteDisclaimer";
import { usePendingDeletionsStore } from "@/store/pendingDeletionsStore";
import ResizableTh from "@/components/ResizableTh";
import InfoTooltip from "@/components/InfoTooltip";
import { baselineForResourceType } from "@/lib/realizedSavings";
import { mapAuditToUnifiedZombieList } from "@/lib/zombieAuditCatalog";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  ColumnDef,
  SortingState,
} from "@tanstack/react-table";
import {
  IconDisc,
  IconServer,
  IconWorld,
  IconCloud,
  IconArrowsSplit,
  IconNetwork,
  IconFolder,
  IconTag,
  IconCamera,
  IconShieldCheck,
  IconShield,
  IconEdit,
  IconTrash,
  IconSparkles,
  IconSend,
  IconAlertTriangle,
  IconX,
  IconMessageDots,
  IconLoader2,
  IconLock,
  IconCheck,
  IconDatabase,
} from "@tabler/icons-react";
import { errorMessage } from '@/lib/apiErrors';

export default function ZombieResourcesTable({ forceFilterType }: { forceFilterType?: string }) {
  const { instance, accounts } = useMsal();
  const { selectedTenant, userRole, systemRole } = useTenant();
  const { viewMode } = useViewMode();
  const { addAction } = useActionLogStore();
  const { addPending, isPending } = usePendingDeletionsStore();
  const triggerCopilotWithPrompt = useAIContext((state) => state.triggerCopilotWithPrompt);
  const { selectedSubscription, setSelectedSubscription } = useSubscription();

  const t = useTranslations("Zombies");
  const [data, setData] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [selectedSub, setSelectedSub] = useState<string>("all");

  useEffect(() => {
    if (selectedSubscription) {
      setSelectedSub(selectedSubscription.toLowerCase() === "all" ? "all" : selectedSubscription);
    }
  }, [selectedSubscription]);

  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterRegion, setFilterRegion] = useState<string>("all");
  const [filterGroup, setFilterGroup] = useState<string>("all");
  const [filterIssue, setFilterIssue] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortMode, setSortMode] = useState<"name-asc" | "name-desc" | "cost-desc" | "cost-asc">("cost-desc");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [error, setError] = useState<string | null>(null);

  const [taggingItems, setTaggingItems] = useState<any[]>([]);
  const [tagValues, setTagValues] = useState<Record<string, string>>(ETIQUETAS_VACIAS);
  const [isTagging, setIsTagging] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkConfirmModalOpen, setBulkConfirmModalOpen] = useState(false);

  // Exemption Modal State
  const [exemptionModalResource, setExemptionModalResource] = useState<any | null>(null);
  const [reasonInput, setReasonInput] = useState("");
  const [commentInput, setCommentInput] = useState("");
  const [savingExemption, setSavingExemption] = useState(false);
  const [exemptionFilter, setExemptionFilter] = useState<"all" | "active" | "exempted">("all");

  // Poda ids seleccionados que ya no existen en `data`
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(data.map((d) => d.id));
      const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [data]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOpenExemptionModal = (item: any) => {
    setExemptionModalResource(item);
    setReasonInput(item.exemptionReason || "Eximida por decisión del usuario");
    setCommentInput(item.exemptionComment || "");
  };

  const handleSaveExemption = async () => {
    if (!exemptionModalResource) return;
    setSavingExemption(true);
    try {
      if (isMockTenant(selectedTenant.id)) {
        setData((prev) =>
          prev.map((v) =>
            v.id === exemptionModalResource.id
              ? {
                  ...v,
                  isExempted: true,
                  exemptionReason: reasonInput || "Eximida por el usuario",
                  exemptionComment: commentInput || null,
                }
              : v
          )
        );
        setExemptionModalResource(null);
        setSavingExemption(false);
        toast.success(t("exemptionSaved", { defaultMessage: "Exención guardada" }));
        return;
      }

      const account = accounts[0];
      const token = await getFreshIdToken(instance, account);

      const res = await fetch("/api/intelligence/zombies/exemptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-tenant-id": selectedTenant.id,
        },
        body: JSON.stringify({
          resourceId: exemptionModalResource.id,
          resourceName: exemptionModalResource.resourceName,
          recommendationType: "zombies",
          reason: reasonInput || "Eximida por el usuario",
          comment: commentInput || null,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setData((prev) =>
          prev.map((v) =>
            v.id === exemptionModalResource.id
              ? {
                  ...v,
                  isExempted: true,
                  exemptionReason: reasonInput || "Eximida por el usuario",
                  exemptionComment: commentInput || null,
                }
              : v
          )
        );
        setExemptionModalResource(null);
        toast.success(t("exemptionSaved", { defaultMessage: "Exención guardada" }));
      } else {
        toast.error(json.error || t("errorServer"));
      }
    } catch (e) {
      toast.error(errorMessage(e) || String(e));
    }
    setSavingExemption(false);
  };

  const handleRemoveExemption = async (item: any) => {
    if (!window.confirm(t("confirmRemoveExemptionShort"))) return;
    try {
      if (isMockTenant(selectedTenant.id)) {
        setData((prev) =>
          prev.map((v) =>
            v.id === item.id
              ? {
                  ...v,
                  isExempted: false,
                  exemptionReason: null,
                  exemptionComment: null,
                }
              : v
          )
        );
        toast.success(t("exemptionRemoved"));
        return;
      }

      const account = accounts[0];
      const token = await getFreshIdToken(instance, account);

      const res = await fetch(`/api/intelligence/zombies/exemptions?resourceId=${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-tenant-id": selectedTenant.id,
        },
      });
      const json = await res.json();
      if (json.success) {
        setData((prev) =>
          prev.map((v) =>
            v.id === item.id
              ? {
                  ...v,
                  isExempted: false,
                  exemptionReason: null,
                  exemptionComment: null,
                }
              : v
          )
        );
        toast.success(t("exemptionRemoved"));
      } else {
        toast.error(json.error || t("errorServer"));
      }
    } catch (e) {
      toast.error(errorMessage(e) || String(e));
    }
  };

  const deleteResourceItem = async (item: any): Promise<{ ok: boolean; error?: string }> => {
    try {
      const idToken = accounts[0] ? await getFreshIdToken(instance, accounts[0]) : "";
      const res = await fetch("/api/remediation", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenantId: selectedTenant.id,
          subscriptionId: item.subscriptionId,
          resourceGroup: item.resourceGroup,
          resourceName: item.resourceName,
          resourceType: item.armType,
          domain: "zombies",
        }),
      });
      const json = await res.json();
      if (!res.ok) return { ok: false, error: json.error || t("errorDeleteGeneric") };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  };

  const handleDelete = async (item: any) => {
    if (item.manualDelete) {
      toast.error(t("toastManualTitle"), { description: t("toastManualDesc", { type: item.type }) });
      return;
    }

    if (!window.confirm(t("confirmDeleteSingle", { name: item.resourceName }))) return;

    setDeletingId(item.id);
    const result = await deleteResourceItem(item);
    if (result.ok) {
      addPending({
        id: item.id,
        name: item.resourceName,
        type: item.type,
        tenantId: selectedTenant.id,
      });
      toast.success(t("toastDeletedTitle"), { description: t("toastDeletedDesc", { name: item.resourceName }) });
      addAction({ message: t("logDeleted", { name: item.resourceName }), status: "success" });
    } else if (result.error === "MISSING_CONTRIBUTOR_ROLE") {
      toast.error(t("toastDeniedTitle"), { description: t("toastDeniedDesc") });
      addAction({ message: t("logDeniedSingle", { name: item.resourceName }), status: "error" });
    } else {
      toast.error(t("toastDeleteErrorTitle"), { description: result.error });
      addAction({ message: t("logDeleteError", { name: item.resourceName, error: result.error || "" }), status: "error" });
    }
    setDeletingId(null);
  };

  const [requestingId, setRequestingId] = useState<string | null>(null);
  const requestDeletion = async (item: any) => {
    if (!window.confirm(t("confirmRequestSingle", { name: item.resourceName }))) return;
    setRequestingId(item.id);
    try {
      const idToken = accounts[0] ? await getFreshIdToken(instance, accounts[0]) : "";
      const res = await fetch("/api/remediation/workflow", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenantId: selectedTenant.id,
          resourceId: item.id,
          resourceName: item.resourceName,
          actionType: "Eliminación de recurso zombi",
          estimatedSavings: item.potentialSavings || 0,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("errorRequestFailed"));
      toast.success(t("toastRequestSentTitle"), { description: t("toastRequestSentDesc", { name: item.resourceName }) });
      addAction({ message: t("logRequestSent", { name: item.resourceName }), status: "success" });
    } catch (err) {
      toast.error(t("toastRequestErrorTitle"), { description: errorMessage(err) });
    }
    setRequestingId(null);
  };

  const handleBulkDelete = async () => {
    const items = filteredData.filter((i) => selectedIds.has(i.id) && !i.manualDelete);
    if (items.length === 0) return;

    setBulkDeleting(true);
    let ok = 0,
      missingRole = 0,
      failed = 0;
    for (const item of items) {
      setDeletingId(item.id);
      const result = await deleteResourceItem(item);
      if (result.ok) {
        ok++;
        addPending({
          id: item.id,
          name: item.resourceName,
          type: item.type,
          tenantId: selectedTenant.id,
        });
      } else if (result.error === "MISSING_CONTRIBUTOR_ROLE") {
        missingRole++;
      } else {
        failed++;
      }
    }
    setDeletingId(null);
    setBulkDeleting(false);
    setSelectedIds(new Set());
    setBulkConfirmModalOpen(false);

    if (ok > 0) {
      toast.success(t("toastBulkDeletedTitle", { count: ok }), { description: t("toastBulkDeletedDesc") });
      addAction({ message: t("logBulkDeleted", { count: ok }), status: "success" });
    }
    if (missingRole > 0) {
      toast.error(t("toastDeniedTitle"), { description: t("toastBulkDeniedDesc", { count: missingRole }) });
    }
    if (failed > 0) {
      toast.error(t("toastBulkDeleteErrorTitle"), { description: t("toastBulkDeleteErrorDesc", { count: failed }) });
    }
  };

  const handleBulkRequestDeletion = async () => {
    const items = filteredData.filter((i) => selectedIds.has(i.id) && !i.manualDelete);
    if (items.length === 0) return;

    setBulkDeleting(true);
    let ok = 0,
      failed = 0;
    for (const item of items) {
      setRequestingId(item.id);
      try {
        const idToken = accounts[0] ? await getFreshIdToken(instance, accounts[0]) : "";
        const res = await fetch("/api/remediation/workflow", {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: selectedTenant.id,
            resourceId: item.id,
            resourceName: item.resourceName,
            actionType: "Eliminación de recurso zombi",
            estimatedSavings: item.potentialSavings || 0,
          }),
        });
        if (res.ok) ok++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setRequestingId(null);
    setBulkDeleting(false);
    setSelectedIds(new Set());
    setBulkConfirmModalOpen(false);

    if (ok > 0) toast.success(t("toastBulkRequestSentTitle", { count: ok }), { description: t("toastBulkRequestSentDesc") });
    if (failed > 0) toast.error(t("toastBulkRequestErrorTitle"), { description: t("toastBulkRequestErrorDesc", { count: failed }) });
  };

  const handleTagSubmit = async () => {
    if (taggingItems.length === 0) return;
    setIsTagging(true);

    let ok = 0,
      failed = 0;
    for (const item of taggingItems) {
      try {
        const idToken = accounts[0] ? await getFreshIdToken(instance, accounts[0]) : "";
        const res = await fetch("/api/tags/apply", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId: selectedTenant.id,
            resourceId: item.id,
            tags: tagValues,
          }),
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json.details || json.error || t("errorTagFailed"));

        ok++;
        setData((prev) => prev.filter((r) => r.id !== item.id));
        addAction({ message: t("logTagged", { name: item.resourceName }), status: "success" });
      } catch (err) {
        console.error("Error tagging:", err);
        failed++;
        addAction({ message: t("logTagError", { name: item.resourceName, error: errorMessage(err) }), status: "error" });
      }
    }

    setIsTagging(false);
    setTaggingItems([]);
    setSelectedIds(new Set());

    if (ok > 0) toast.success(ok === 1 ? t("toastTaggedSingle") : t("toastTaggedMultiple", { count: ok }));
    if (failed > 0) toast.error(t("toastTagErrorCount", { count: failed }));
  };

  useEffect(() => {
    if ((accounts.length === 0 && !isMockTenant(selectedTenant.id)) || selectedTenant.id === "default") {
      setLoading(false);
      return;
    }

    const fetchResourcesAndSubs = async () => {
      try {
        setLoading(true);
        const tenantId = selectedTenant.id;

        const idToken = accounts[0] ? await getFreshIdToken(instance, accounts[0]) : "";
        const headers: Record<string, string> = idToken ? { Authorization: `Bearer ${idToken}` } : {};

        let resolvedSubscriptions = subscriptions;
        if (subscriptions.length === 0) {
          const subRes = await fetch(`/api/subscriptions?tenantId=${tenantId}`, { headers });
          if (subRes.ok) {
            const subJson = await subRes.json();
            resolvedSubscriptions = subJson.subscriptions || [];
            setSubscriptions(resolvedSubscriptions);
          }
        }

        let apiUrl = `/api/audit/full?tenantId=${tenantId}`;
        if (selectedSub !== "all") {
          apiUrl += `&subscriptionId=${selectedSub}`;
        }

        let json;
        if (isMockTenant(tenantId)) {
          json = getMockDataForRoute("audit_full", tenantId);
        } else {
          const res = await fetch(apiUrl, { headers });
          json = await res.json();

          if (!res.ok || json.error) {
            setError(json.error === "MISSING_RBAC_ROLE" ? "MISSING_RBAC_ROLE" : json.error || t("errorServer"));
            setLoading(false);
            return;
          }
        }

        const audit = json?.auditResults || {};
        let allMappedData = mapAuditToUnifiedZombieList(audit).map((r) => ({
          ...r,
          subscriptionName:
            resolvedSubscriptions.find((sub: any) => sub.id === (r.subscriptionId || selectedSub))?.name ||
            (r.subscriptionName || r.subscriptionId || selectedSub),
        }));

        if (forceFilterType) {
          allMappedData = allMappedData.filter((d) => d.type.toLowerCase() === forceFilterType.toLowerCase());
        }

        if (!isMockTenant(tenantId)) {
          const exemptionsRes = await fetch("/api/intelligence/zombies/exemptions", {
            headers: {
              ...headers,
              "x-tenant-id": tenantId,
            },
          });
          if (exemptionsRes.ok) {
            const exemptionsJson = await exemptionsRes.json();
            const exemptions = Array.isArray(exemptionsJson?.data) ? exemptionsJson.data : [];
            const exMap = new Map(
              exemptions
                .filter((e: any) => e.recommendationType === "zombies")
                .map((e: any) => [String(e.resourceId || "").toLowerCase(), e])
            );

            allMappedData = allMappedData.map((item) => {
              const ex = exMap.get(String(item.id || "").toLowerCase()) as any;
              if (!ex) {
                return { ...item, isExempted: false, exemptionReason: null, exemptionComment: null };
              }
              return {
                ...item,
                isExempted: true,
                exemptionReason: ex.reason || null,
                exemptionComment: ex.comment || null,
              };
            });
          }
        }

        setData(allMappedData);
        setError(null);
        setLoading(false);
      } catch (err) {
        console.error("Error obteniendo datos:", err);
        setError(t("errorNetwork"));
        setLoading(false);
      }
    };

    fetchResourcesAndSubs();
  }, [accounts, instance, selectedSub, selectedTenant, forceFilterType]);

  const filteredData = useMemo(() => {
    const filtered = data.filter((item) => {
      const matchName =
        !searchQuery || String(item.resourceName || "").toLowerCase().includes(searchQuery.toLowerCase());
      const matchType =
        !filterType || filterType === "all" || String(item.type || "").toLowerCase().includes(filterType.toLowerCase());
      const matchRegion =
        !filterRegion || filterRegion === "all" || String(item.region || "").toLowerCase().includes(filterRegion.toLowerCase());
      const matchGroup =
        !filterGroup || filterGroup === "all" || String(item.resourceGroup || "").toLowerCase().includes(filterGroup.toLowerCase());
      const matchIssue = filterIssue === "all" || item.issueType === filterIssue;
      const matchExemption =
        exemptionFilter === "all" ||
        (exemptionFilter === "active" && !item.isExempted) ||
        (exemptionFilter === "exempted" && item.isExempted);

      return matchName && matchType && matchRegion && matchGroup && matchIssue && matchExemption;
    });

    if (sortMode === "name-asc")
      filtered.sort((a, b) => String(a.resourceName || "").localeCompare(String(b.resourceName || "")));
    if (sortMode === "name-desc")
      filtered.sort((a, b) => String(b.resourceName || "").localeCompare(String(a.resourceName || "")));
    if (sortMode === "cost-desc")
      filtered.sort((a, b) => Number(b.potentialSavings || 0) - Number(a.potentialSavings || 0));
    if (sortMode === "cost-asc")
      filtered.sort((a, b) => Number(a.potentialSavings || 0) - Number(b.potentialSavings || 0));

    return filtered;
  }, [data, filterType, filterRegion, filterGroup, filterIssue, searchQuery, exemptionFilter, sortMode]);

  const hasLockedItems = useMemo(() => filteredData.some((item) => item.isLocked), [filteredData]);
  const canDelete = canDeleteResources(selectedTenant.tier, "zombies");
  const canTag = canRemediateTags(selectedTenant.tier);
  const canDeleteDirect = canDelete && (userRole === "Admin" || userRole === "Owner" || systemRole === "SUPERADMIN");
  const canRequestDelete = canDelete && !canDeleteDirect;

  const totalSelectedSavings = useMemo(() => {
    return filteredData
      .filter((i) => selectedIds.has(i.id) && !i.manualDelete)
      .reduce((s, i) => s + (Number(i.potentialSavings) || 0), 0);
  }, [filteredData, selectedIds]);

  const getResourceIcon = (type: string, armType: string) => {
    const tLower = (type || "").toLowerCase();
    const armLower = (armType || "").toLowerCase();
    if (tLower.includes("disk") || armLower.includes("disks")) return <IconDisc className="w-4 h-4 text-[#0078D4] stroke-[1.5] shrink-0" />;
    if (tLower.includes("vm") || armLower.includes("virtualmachines")) return <IconServer className="w-4 h-4 text-[#0078D4] stroke-[1.5] shrink-0" />;
    if (tLower.includes("ip") || armLower.includes("publicipaddresses")) return <IconWorld className="w-4 h-4 text-[#0078D4] stroke-[1.5] shrink-0" />;
    if (tLower.includes("snapshot") || armLower.includes("snapshots")) return <IconCamera className="w-4 h-4 text-[#0078D4] stroke-[1.5] shrink-0" />;
    if (tLower.includes("ttl")) return <IconAlertTriangle className="w-4 h-4 text-amber-500 stroke-[1.5] shrink-0" />;
    if (tLower.includes("app service") || tLower.includes("serverfarms") || armLower.includes("serverfarms")) return <IconCloud className="w-4 h-4 text-[#0078D4] stroke-[1.5] shrink-0" />;
    if (tLower.includes("load balancer") || armLower.includes("loadbalancers")) return <IconArrowsSplit className="w-4 h-4 text-[#0078D4] stroke-[1.5] shrink-0" />;
    if (tLower.includes("gateway") || armLower.includes("virtualnetworkgateways")) return <IconNetwork className="w-4 h-4 text-[#0078D4] stroke-[1.5] shrink-0" />;
    if (tLower.includes("dns") || armLower.includes("dns")) return <IconWorld className="w-4 h-4 text-[#0078D4] stroke-[1.5] shrink-0" />;
    if (tLower.includes("resource group") || armLower.includes("resourcegroups")) return <IconFolder className="w-4 h-4 text-[#0078D4] stroke-[1.5] shrink-0" />;
    if (tLower.includes("sql") || armLower.includes("sql")) return <IconDatabase className="w-4 h-4 text-[#0078D4] stroke-[1.5] shrink-0" />;
    if (tLower.includes("tag") || armLower.includes("tag")) return <IconTag className="w-4 h-4 text-[#0078D4] stroke-[1.5] shrink-0" />;
    return <IconServer className="w-4 h-4 text-[#0078D4] stroke-[1.5] shrink-0" />;
  };

  const columns = useMemo<ColumnDef<any>[]>(() => {
    const cols: ColumnDef<any>[] = [
      {
        id: "select",
        header: ({ table }) => {
          const rows = table.getRowModel().rows;
          const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.original.id));
          const someSelected = !allSelected && rows.some((r) => selectedIds.has(r.original.id));
          return (
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected;
              }}
              onChange={() => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (allSelected) rows.forEach((r) => next.delete(r.original.id));
                  else rows.forEach((r) => next.add(r.original.id));
                  return next;
                });
              }}
              className="rounded border-slate-300 text-[#0078D4] focus:ring-[#0078D4] cursor-pointer"
            />
          );
        },
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selectedIds.has(row.original.id)}
            onChange={() => toggleSelected(row.original.id)}
            disabled={isPending(row.original.id)}
            className={`rounded border-slate-300 text-[#0078D4] focus:ring-[#0078D4] cursor-pointer ${
              isPending(row.original.id) ? "opacity-50 cursor-not-allowed" : ""
            }`}
          />
        ),
        size: 40,
      },
      {
        accessorKey: "resourceName",
        header: t("colResource"),
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
                {getResourceIcon(item.type, item.armType)}
                <span
                  className={`break-words whitespace-normal leading-snug font-semibold text-xs text-slate-900 dark:text-slate-100 ${
                    item.isLocked ? "filter blur-xs select-none" : ""
                  }`}
                  title={item.resourceName}
                >
                  {item.resourceName}
                </span>
                {item.isLocked && <IconLock className="w-3.5 h-3.5 text-slate-400 shrink-0 stroke-[1.5]" />}
              </div>
              {item.isExempted && (
                <div className="mt-1 flex flex-col gap-0.5">
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 w-fit">
                    <IconShieldCheck className="w-3 h-3 stroke-[1.5]" />
                    {t("badge_exempted")}
                  </span>
                  {item.exemptionReason && (
                    <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 m-0 break-words whitespace-normal">
                      {item.exemptionReason}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        },
      },
    ];

    if (viewMode === "engineer") {
      cols.push({
        id: "armDetails",
        header: t("colArmDetails"),
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div
              className={`text-xs font-mono break-all whitespace-normal ${item.isLocked ? "filter blur-xs select-none" : ""}`}
              title={item.id}
            >
              <div className="text-slate-600 dark:text-slate-400 font-semibold break-all">{item.id?.split("/").pop()}</div>
              <div className="text-[10px] text-slate-400 mt-0.5 break-all">{item.armType}</div>
            </div>
          );
        },
      });
    }

    cols.push({
      accessorKey: "subscriptionName",
      header: t("colSubscription"),
      cell: ({ row }) => {
        const item = row.original;
        let label = item.subscriptionName || item.subscriptionId || "N/A";
        if (label.toLowerCase() === "ec03e8ce-ceee-4638-b303-64ae431d5b1e") {
          label = "CSCS-LandingZone";
        }
        return (
          <span
            className={`text-xs text-slate-600 dark:text-slate-400 font-medium break-words whitespace-normal block ${
              item.isLocked ? "filter blur-xs select-none" : ""
            }`}
            title={label}
          >
            {label}
          </span>
        );
      },
    });

    cols.push({
      accessorKey: "region",
      header: t("colRegion"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <span className={`text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap ${item.isLocked ? "filter blur-xs select-none" : ""}`}>
            {item.region || "-"}
          </span>
        );
      },
    });

    cols.push({
      accessorKey: "type",
      header: t("colType"),
      cell: (info) => (
        <span className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded text-[11px] font-medium border border-slate-200/60 dark:border-slate-700 break-words whitespace-normal inline-block">
          {info.getValue() as string}
        </span>
      ),
    });

    cols.push({
      accessorKey: "resourceGroup",
      header: t("colGroup"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <span
            className={`text-xs text-slate-600 dark:text-slate-400 font-medium break-words whitespace-normal block ${
              item.isLocked ? "filter blur-xs select-none" : ""
            }`}
            title={item.resourceGroup}
          >
            {item.resourceGroup || "N/A"}
          </span>
        );
      },
    });

    cols.push({
      accessorKey: "issue",
      header: t("colIssue"),
      cell: ({ row }) => {
        const item = row.original;
        const isGov = item.issueType === "governance";
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
              isGov
                ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/50"
                : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800/50"
            }`}
          >
            {item.issueKey ? t(`issues.${item.issueKey}`) : item.issue}
          </span>
        );
      },
    });

    cols.push({
      accessorKey: "potentialSavings",
      header: t("colSavings"),
      cell: ({ row }) => {
        const item = row.original;
        const val = Number(item.potentialSavings) || 0;
        const isEstimated = item.savingsSource === 'type_baseline';
        if (item.isHygiene || item.issueType === 'governance') {
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800/50">
              {t("hygiene")}
            </span>
          );
        }
        if (val <= 0) {
          return (
            <span className="text-slate-400 dark:text-slate-500 font-normal text-xs" title={t("no_measured_cost")}>
              —
            </span>
          );
        }
        return (
          <span
            className={`font-bold text-xs ${val > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}
            title={isEstimated ? t("baselineEstimated") : t("baselineMeasured")}
          >
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val)}{t("per_month_suffix")}
            {isEstimated && <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400 font-normal">(est.)</span>}
          </span>
        );
      },
    });

    cols.push({
      id: "actions",
      header: t("colActions"),
      cell: ({ row }) => {
        const item = row.original;
        // Las DOS claves del catalogo que muestran "Sin Etiquetas FinOps".
        // Mirando solo la primera, un recurso detectado como
        // `completelyUntaggedResources` --sin ninguna etiqueta-- salia marcado
        // en el tablero con Delete y Eximir como unicas acciones: el unico
        // problema del listado que se puede arreglar de verdad era, justamente,
        // el unico sin boton para arreglarlo.
        const isTagCompliance =
          item.issueKey === "taggingNonCompliance" || item.issueKey === "completelyUntaggedResources";
        return (
          <div className="text-right flex items-center justify-end gap-1.5">
            {isPending(item.id) ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                <IconLoader2 className="w-3.5 h-3.5 animate-spin text-slate-500 stroke-[2]" />
                {t("deleting")}
              </span>
            ) : (
              <>
                {item.issueType === "governance" && isTagCompliance && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setTaggingItems([item]);
                        setTagValues(ETIQUETAS_VACIAS);
                      }}
                      disabled={!canTag}
                      title={!canTag ? t("enterpriseTooltip") : ""}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 ${
                        !canTag
                          ? "bg-slate-50 text-slate-400 border border-slate-200 cursor-not-allowed"
                          : "bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 border border-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/30 cursor-pointer active:scale-95"
                      }`}
                    >
                      <IconTag className="w-3.5 h-3.5 stroke-[1.5]" />
                      {t("setTags")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTagValues(sugerirEtiquetas(item.resourceGroup, item.resourceName));
                        setTaggingItems([item]);
                        triggerCopilotWithPrompt(
                          t("suggestPrompt", {
                            name: item.resourceName,
                            type: item.type,
                            group: item.resourceGroup,
                          })
                        );
                      }}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold shadow-xs transition-all bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 border border-sky-400 hover:bg-sky-50/50 dark:hover:bg-sky-950/30 flex items-center gap-1 cursor-pointer active:scale-95"
                      title={t("autocompleteTagsTooltip")}
                    >
                      <IconSparkles className="w-3.5 h-3.5 stroke-[1.5]" />
                      {t("suggest")}
                    </button>
                  </>
                )}
                {canDeleteDirect ? (
                  <button
                    type="button"
                    onClick={() => handleDelete(item)}
                    disabled={deletingId === item.id || (item.issueType === "governance" && isTagCompliance)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 ${
                      deletingId === item.id
                        ? "bg-slate-50 text-slate-400 border border-slate-200 cursor-wait"
                        : item.issueType === "governance" && isTagCompliance
                        ? "bg-slate-50 text-slate-300 border border-slate-200 cursor-not-allowed"
                        // Rojo solido, el mismo estilo destructivo que ya usa el
                        // confirm de purga masiva mas abajo en este archivo: borrar un
                        // recurso es irreversible y el contorno lo hacia parecer una
                        // accion secundaria mas.
                        : "bg-rose-600 hover:bg-rose-700 text-white border border-rose-600 hover:border-rose-700 cursor-pointer active:scale-95"
                    }`}
                  >
                    {deletingId === item.id ? (
                      <IconLoader2 className="w-3.5 h-3.5 animate-spin stroke-[2]" />
                    ) : (
                      <IconTrash className="w-3.5 h-3.5 stroke-[1.5]" />
                    )}
                    {deletingId === item.id ? t("deleting") : t("delete")}
                  </button>
                ) : canRequestDelete ? (
                  <button
                    type="button"
                    onClick={() => requestDeletion(item)}
                    disabled={requestingId === item.id || (item.issueType === "governance" && isTagCompliance)}
                    title={t("requestDeleteRowTooltip")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 ${
                      requestingId === item.id
                        ? "bg-slate-50 text-slate-400 border border-slate-200 cursor-wait"
                        : item.issueType === "governance" && isTagCompliance
                        ? "bg-slate-50 text-slate-300 border border-slate-200 cursor-not-allowed"
                        : "bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700 hover:bg-amber-50/50 dark:hover:bg-amber-950/30 cursor-pointer active:scale-95"
                    }`}
                  >
                    <IconSend className="w-3.5 h-3.5 stroke-[1.5]" />
                    {requestingId === item.id ? t("sending") : t("requestDelete")}
                  </button>
                ) : (
                  <span
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 text-slate-400 border border-slate-200 dark:border-slate-700"
                    title={t("enterpriseTooltip")}
                  >
                    {t("enterprise")}
                  </span>
                )}
                {item.isExempted ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleOpenExemptionModal(item)}
                      className="px-2 py-1 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 border border-[#0054A6]/60 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 inline-flex items-center gap-1 shadow-xs cursor-pointer active:scale-95 transition-all"
                      title={t("btn_edit_exemption")}
                    >
                      <IconEdit className="w-3.5 h-3.5 stroke-[1.5]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveExemption(item)}
                      className="px-2 py-1 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 border border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/30 inline-flex items-center gap-1 shadow-xs cursor-pointer active:scale-95 transition-all"
                      title={t("btn_remove_exemption")}
                    >
                      <IconCheck className="w-3.5 h-3.5 stroke-[1.5]" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleOpenExemptionModal(item)}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 inline-flex items-center gap-1 shadow-xs cursor-pointer active:scale-95 transition-all"
                    title={t("btn_exempt")}
                  >
                    <IconShield className="w-3.5 h-3.5 text-slate-500 stroke-[1.5]" />
                    {t("btn_exempt")}
                  </button>
                )}
              </>
            )}
          </div>
        );
      },
    });

    return cols;
  }, [viewMode, deletingId, requestingId, canDeleteDirect, canRequestDelete, selectedIds, t, isPending, canTag]);

  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      sorting,
    },
    columnResizeMode: "onChange",
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: 15 },
    },
  });

  if ((accounts.length === 0 && !isMockTenant(selectedTenant.id)) || selectedTenant.id === "default") {
    return (
      <div className="bg-white dark:bg-slate-900 shadow-xs rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center flex flex-col items-center justify-center">
        <IconServer className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-3 stroke-[1.5]" />
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-1">{t("restrictedTitle")}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("restrictedDesc")}</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      {!canDelete && (
        <div className="mb-2">
          <EnterpriseDeleteDisclaimer domain="zombies" />
        </div>
      )}

      {/* Filters Bar: Placed immediately below header */}
      <div className="bg-slate-50/70 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-700/60 flex flex-wrap items-center gap-3">
        {/* Filter Subscription */}
        <div className="flex flex-col gap-1 min-w-[130px]">
          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {t("filterSubscription")}
          </label>
          <select
            value={selectedSub}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedSub(val);
              setSelectedSubscription(val === "all" ? "All" : val);
            }}
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-lg p-2 outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4]"
          >
            <option value="all">{t("filterAll")}</option>
            {subscriptions.map((sub: any) => (
              <option key={sub.id} value={sub.id}>
                {(sub.name || sub.id).substring(0, 24)}
              </option>
            ))}
          </select>
        </div>

        {/* Filter Name / Resource */}
        <div className="flex flex-col gap-1 min-w-[140px] flex-1 sm:flex-initial">
          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {t("filterName")}
          </label>
          <input
            type="text"
            placeholder={t("filterNamePlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-medium rounded-lg p-2 outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4]"
          />
        </div>

        {/* Filter Type */}
        <div className="flex flex-col gap-1 min-w-[120px]">
          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {t("filterType")}
          </label>
          <input
            type="text"
            list="type-list"
            placeholder={t("filterAllPlaceholder")}
            value={filterType === "all" ? "" : filterType}
            onChange={(e) => setFilterType(e.target.value || "all")}
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-medium rounded-lg p-2 outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4]"
          />
          <datalist id="type-list">
            {Array.from(new Set(data.map((d) => d.type)))
              .filter(Boolean)
              .sort()
              .map((opt: any) => (
                <option key={opt} value={opt} />
              ))}
          </datalist>
        </div>

        {/* Filter Region */}
        <div className="flex flex-col gap-1 min-w-[120px]">
          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {t("filterRegion")}
          </label>
          <input
            type="text"
            list="region-list"
            placeholder={t("filterAllPlaceholder")}
            value={filterRegion === "all" ? "" : filterRegion}
            onChange={(e) => setFilterRegion(e.target.value || "all")}
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-medium rounded-lg p-2 outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4]"
          />
          <datalist id="region-list">
            {Array.from(new Set(data.map((d) => d.region)))
              .filter(Boolean)
              .sort()
              .map((region: any) => (
                <option key={region} value={region} />
              ))}
          </datalist>
        </div>

        {/* Filter Resource Group */}
        <div className="flex flex-col gap-1 min-w-[130px]">
          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {t("filterGroup")}
          </label>
          <input
            type="text"
            list="group-list"
            placeholder={t("filterAllPlaceholder")}
            value={filterGroup === "all" ? "" : filterGroup}
            onChange={(e) => setFilterGroup(e.target.value || "all")}
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-medium rounded-lg p-2 outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4]"
          />
          <datalist id="group-list">
            {Array.from(new Set(data.map((d) => d.resourceGroup)))
              .filter(Boolean)
              .sort()
              .map((g: any) => (
                <option key={g} value={g} />
              ))}
          </datalist>
        </div>

        {/* Filter Severity / Category */}
        <div className="flex flex-col gap-1 min-w-[110px]">
          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {t("filterSeverity")}
          </label>
          <select
            value={filterIssue}
            onChange={(e) => setFilterIssue(e.target.value)}
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-lg p-2 outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4]"
          >
            <option value="all">{t("filterAll")}</option>
            <option value="cost">{t("severityCost")}</option>
            <option value="governance">{t("severityGovernance")}</option>
          </select>
        </div>

        {/* Filter Exemption Status */}
        <div className="flex flex-col gap-1 min-w-[110px]">
          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {t("filter_status")}
          </label>
          <select
            value={exemptionFilter}
            onChange={(e) => setExemptionFilter(e.target.value as any)}
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-lg p-2 outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4]"
          >
            <option value="all">{t("filter_all")}</option>
            <option value="active">{t("filter_active")}</option>
            <option value="exempted">{t("filter_exempted")}</option>
          </select>
        </div>

        {/* Sort By */}
        <div className="flex flex-col gap-1 min-w-[130px]">
          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {t("sortBy")}
          </label>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as any)}
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-lg p-2 outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4]"
          >
            <option value="cost-desc">{t("sortCostDesc")}</option>
            <option value="cost-asc">{t("sortCostAsc")}</option>
            <option value="name-asc">{t("sortAz")}</option>
            <option value="name-desc">{t("sortZa")}</option>
          </select>
        </div>
      </div>

      {/* Floating / Sticky Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="p-3 bg-blue-50/90 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-800/60 flex flex-wrap items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <IconCheck className="w-4 h-4 text-[#0078D4] stroke-[2]" />
            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
              {t("selectedCount", { count: selectedIds.size })}
            </span>
            {totalSelectedSavings > 0 && (
              <span className="text-xs bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-md font-bold border border-emerald-200 dark:border-emerald-800">
                {t("potential_savings_bar", { amount: totalSelectedSavings.toFixed(2) })}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTaggingItems(filteredData.filter((i) => selectedIds.has(i.id)));
                setTagValues(ETIQUETAS_VACIAS);
              }}
              disabled={!canTag}
              title={!canTag ? t("enterpriseTooltip") : ""}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 shadow-xs ${
                !canTag
                  ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                  : "bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 border border-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/30 cursor-pointer active:scale-95"
              }`}
            >
              <IconTag className="w-3.5 h-3.5 stroke-[1.5]" />
              {t("tagSelected")}
            </button>

            {canDeleteDirect ? (
              <button
                type="button"
                onClick={() => setBulkConfirmModalOpen(true)}
                disabled={bulkDeleting}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 border border-rose-400 hover:bg-rose-50/50 dark:hover:bg-rose-950/30 transition-all flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <IconTrash className="w-3.5 h-3.5 stroke-[1.5]" />
                {bulkDeleting ? t("deletingBulk") : (
                  <>
                    {t("bulk_remediate_btn", { amount: totalSelectedSavings.toFixed(2) })}
                    <IconSparkles size={14} stroke={1.5} className="inline ml-1 text-[#0078D4]" />
                  </>
                )}
              </button>
            ) : canRequestDelete ? (
              <button
                type="button"
                onClick={handleBulkRequestDeletion}
                disabled={bulkDeleting}
                title={t("requestDeleteSelectedTooltip")}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-400 border border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-950/30 transition-all flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <IconSend className="w-3.5 h-3.5 stroke-[1.5]" />
                {bulkDeleting ? t("sendingBulk") : t("requestDeleteSelected")}
              </button>
            ) : (
              <span
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 text-slate-400 border border-slate-200"
                title={t("enterpriseTooltip")}
              >
                {t("deleteRequiresEnterprise")}
              </span>
            )}

            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 font-semibold px-2 py-1 cursor-pointer"
            >
              {t("clearSelection")}
            </button>
          </div>
        </div>
      )}

      {error === "MISSING_RBAC_ROLE" ? (
        <RoleAssignmentBanner />
      ) : loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <IconLoader2 className="w-8 h-8 animate-spin text-[#0078D4] mb-3 stroke-[2]" />
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t("scanning")}</p>
        </div>
      ) : (
        <div className="flex flex-col border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs bg-white dark:bg-slate-900">
          <div className="overflow-x-auto w-full relative">
            {hasLockedItems && (
              <div className="absolute inset-x-0 bottom-0 top-12 z-10 flex flex-col items-center justify-center bg-white/40 dark:bg-slate-900/40 backdrop-blur-[1px]">
                <a
                  href="/upgrade"
                  className="px-6 py-2.5 bg-[#0078D4] text-white text-xs font-bold rounded-lg shadow-lg hover:bg-[#0054A6] transition-all hover:scale-105 inline-flex items-center gap-2"
                >
                  <IconSparkles className="w-4 h-4 stroke-[1.5]" />
                  {t("upgradeCta")}
                </a>
              </div>
            )}
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      if (header.id === "select") {
                        return (
                          <th key={header.id} className="py-3 px-3 text-left w-10">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </th>
                        );
                      }
                      return (
                        <ResizableTh
                          key={header.id}
                          minWidth={header.column.columnDef.size || 120}
                          className="py-3 px-3 text-left font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[11px]"
                        >
                          <div
                            className={header.column.getCanSort() ? "cursor-pointer select-none" : ""}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {{
                              asc: " 🔼",
                              desc: " 🔽",
                            }[header.column.getIsSorted() as string] ?? null}
                          </div>
                        </ResizableTh>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {table.getRowModel().rows.length > 0 ? (
                  table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                        selectedIds.has(row.original.id) ? "bg-blue-50/40 dark:bg-blue-950/20" : ""
                      }`}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="py-3 px-3">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={columns.length} className="py-12 text-center text-slate-400 font-semibold">
                      {t("emptyOptimized")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="flex items-center justify-between p-4 bg-slate-50/60 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
                {t("paginationPage")}{" "}
                <span className="text-slate-800 dark:text-slate-200 font-bold">
                  {table.getState().pagination.pageIndex + 1}
                </span>{" "}
                {t("paginationOf")}{" "}
                <span className="text-slate-800 dark:text-slate-200 font-bold">
                  {table.getPageCount() || 1}
                </span>
              </span>
              <select
                value={table.getState().pagination.pageSize}
                onChange={(e) => {
                  table.setPageSize(Number(e.target.value));
                }}
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-lg p-1.5 outline-none"
              >
                {[15, 30, 45, 60].map((pageSize) => (
                  <option key={pageSize} value={pageSize}>
                    {t("showOption", { size: pageSize })}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-lg font-semibold text-xs hover:border-[#0078D4] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-xs"
              >
                {t("previous")}
              </button>
              <button
                type="button"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-lg font-semibold text-xs hover:border-[#0078D4] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-xs"
              >
                {t("next")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal (z-[100] Layering) */}
      {bulkConfirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800 z-[100]">
            <div className="flex justify-between items-center p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
              <div className="flex items-center gap-3">
                <IconTrash className="w-5 h-5 text-rose-600 stroke-[1.5]" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {t("bulk_confirm_title")}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setBulkConfirmModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1 rounded-lg"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {t("bulk_confirm_intro")} <b>{t("bulk_confirm_selected", { count: selectedIds.size })}</b>.
              </p>
              <div className="p-3 bg-rose-50 dark:bg-rose-950/30 rounded-xl border border-rose-200 dark:border-rose-900/50 text-xs text-rose-700 dark:text-rose-300">
                {t("bulk_confirm_savings")} <b>{t("bulk_confirm_savings_amount", { amount: totalSelectedSavings.toFixed(2) })}</b>.
                {t("bulk_confirm_warning")}
              </div>
            </div>
            <div className="flex justify-end gap-3 p-4 bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setBulkConfirmModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm flex items-center gap-2"
              >
                {bulkDeleting ? (
                  <>
                    <IconLoader2 className="w-3.5 h-3.5 animate-spin stroke-[2]" />
                    {t("deletingBulk")}
                  </>
                ) : (
                  t("confirmPurge")
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tagging Modal (z-[100] Layering) */}
      {taggingItems.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 w-full max-w-md border border-slate-200 dark:border-slate-800 z-[100] animate-in zoom-in-95">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">{t("tagModalTitle")}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              {taggingItems.length === 1
                ? t.rich("tagModalDescSingle", {
                    name: taggingItems[0].resourceName,
                    res: (chunks) => <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{chunks}</span>,
                  })
                : t.rich("tagModalDescMultiple", {
                    count: taggingItems.length,
                    res: (chunks) => <span className="font-semibold text-slate-700 dark:text-slate-300">{chunks}</span>,
                  })}{" "}
              {t.rich("tagModalPolicyNote", { b: (chunks) => <b>{chunks}</b> })}
            </p>

            <div className="bg-blue-50/50 dark:bg-blue-950/20 p-2.5 rounded-xl border border-blue-200 dark:border-blue-900 mb-4 flex justify-between items-center">
              <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                {t("autocompleteWithAi")}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (taggingItems.length > 0) {
                    const first = taggingItems[0];
                    const sugeridas = sugerirEtiquetas(first.resourceGroup, first.resourceName);
                    setTagValues(sugeridas);
                    triggerCopilotWithPrompt(
                      `Analiza y sugiere etiquetas FinOps de gobernanza para ${taggingItems.length === 1 ? `el recurso **${first.resourceName}** (${first.type} en RG \`${first.resourceGroup}\`)` : `${taggingItems.length} recursos zombis seleccionados`}. Las obligatorias son ${GLOBAL_MANDATORY_TAGS.join(", ")}. Valores admitidos: ${GLOBAL_MANDATORY_TAGS.map((tag) => `${tag}=[${(TAG_SUGGESTED_VALUES[tag] || []).join("|")}]`).join(", ")}. Valida la coherencia de showback y gobernanza cloud.`
                    );
                  }
                }}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 hover:bg-blue-50/50 transition inline-flex items-center gap-1 cursor-pointer shadow-xs"
              >
                <IconSparkles size={14} stroke={1.5} className="text-[#0078D4]" />
                <span>{t("suggestWithAi")}</span>
              </button>
            </div>

            {/*
              * Un campo por etiqueta obligatoria, salidos de `tagConfig`. Antes
              * eran tres bloques escritos a mano --CostCenter, Environment,
              * Owner-- que no coincidian con la politica: aplicarlos dejaba al
              * recurso igual de incumplidor, con dos etiquetas de mas y dos de
              * las requeridas todavia faltando.
              *
              * `datalist` y no `select`: los valores de la politica son la
              * sugerencia, pero cada cliente nombra sus centros de costo como
              * quiere y encerrarlos en una lista fija convertiria la
              * remediacion en un embudo.
              */}
            <div className="space-y-3 mb-6">
              {GLOBAL_MANDATORY_TAGS.map((tag) => (
                <div key={tag}>
                  <label htmlFor={`tag-${tag}`} className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tag}
                  </label>
                  <input
                    id={`tag-${tag}`}
                    type="text"
                    list={`tag-opciones-${tag}`}
                    className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4]"
                    placeholder={(TAG_SUGGESTED_VALUES[tag] || []).join(", ")}
                    value={tagValues[tag] || ""}
                    onChange={(e) => setTagValues({ ...tagValues, [tag]: e.target.value })}
                  />
                  <datalist id={`tag-opciones-${tag}`}>
                    {(TAG_SUGGESTED_VALUES[tag] || []).map((valor) => (
                      <option key={valor} value={valor} />
                    ))}
                  </datalist>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setTaggingItems([])}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 bg-slate-100 dark:bg-slate-800 rounded-lg transition-colors"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleTagSubmit}
                disabled={isTagging || GLOBAL_MANDATORY_TAGS.some((tag) => !(tagValues[tag] || "").trim())}
                className="px-4 py-2 text-xs font-bold text-white bg-[#0054A6] hover:bg-[#0078D4] rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {isTagging ? (
                  <>
                    <IconLoader2 className="w-3.5 h-3.5 animate-spin stroke-[2]" />
                    {t("applying")}
                  </>
                ) : (
                  t("applyTags")
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exemption Modal (z-[100] Layering) */}
      {exemptionModalResource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 dark:border-slate-800 z-[100]">
            <div className="flex justify-between items-center p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
              <div className="flex items-center gap-3">
                <IconShield className="w-5 h-5 text-[#0078D4] stroke-[1.5]" />
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">{t("exempt_modal_title")}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t("markJustified")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExemptionModalResource(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1.5 rounded-lg"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-blue-50 dark:bg-blue-950/30 p-3.5 rounded-xl flex gap-3 border border-blue-100 dark:border-blue-900/50">
                <IconAlertTriangle className="w-5 h-5 text-[#0078D4] shrink-0 mt-0.5 stroke-[1.5]" />
                <div className="text-xs text-blue-900 dark:text-blue-300 leading-relaxed">
                  {t("exempt_intro")}{" "}
                  <span className="font-mono font-bold">{exemptionModalResource.resourceName}</span>.{" "}
                  {t("exempt_effect")}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t("exempt_reason_label")} <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={reasonInput}
                    onChange={(e) => setReasonInput(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4]"
                  >
                    <option value="VM requerida para backups periódicos de MySQL">{t("exempt_reason_backup")}</option>
                    <option value="Entorno de Disaster Recovery (DR)">{t("exempt_reason_dr")}</option>
                    <option value="Recurso temporal mantenido por auditoría/compliance">{t("exempt_reason_compliance")}</option>
                    <option value="Recurso Legacy (Proceso de migración)">{t("exempt_reason_legacy")}</option>
                    <option value="Eximida por decisión del usuario">{t("exempt_reason_other")}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                    <IconMessageDots className="w-4 h-4 text-slate-400 stroke-[1.5]" />
                    {t("exempt_justification")}
                  </label>
                  <textarea
                    value={commentInput}
                    onChange={(e) => setCommentInput(e.target.value)}
                    placeholder={t("exempt_justification_ph")}
                    rows={3}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] resize-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 p-4 bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setExemptionModalResource(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleSaveExemption}
                disabled={savingExemption || !reasonInput}
                className="px-4 py-2 text-xs font-bold text-white bg-[#0054A6] hover:bg-[#0078D4] rounded-lg transition-all shadow-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                {savingExemption ? (
                  <>
                    <IconLoader2 className="w-3.5 h-3.5 animate-spin stroke-[2]" />
                    {t("saving")}
                  </>
                ) : (
                  <>
                    <IconCheck className="w-3.5 h-3.5 stroke-[2]" />
                    {t("btn_save_exemption")}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

