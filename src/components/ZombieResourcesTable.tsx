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
import { canDeleteResources, canRemediateTags } from "@/lib/tierLogic";
import EnterpriseDeleteDisclaimer from "@/components/EnterpriseDeleteDisclaimer";
import { usePendingDeletionsStore } from "@/store/pendingDeletionsStore";
import ResizableTh from "@/components/ResizableTh";
import InfoTooltip from "@/components/InfoTooltip";
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
  const [tagValues, setTagValues] = useState({ CostCenter: "", Environment: "", Owner: "" });
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
    if (!window.confirm("¿Seguro que deseas remover la exención de este recurso?")) return;
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
        toast.success("Exención removida");
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
        toast.success("Exención removida");
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

        const resourceConfig: any = {
          unattachedDisks: { type: "Disk", armType: "microsoft.compute/disks", issue: "Disco sin asociar", savings: 15.0, issueType: "cost", manualDelete: false },
          unusedIps: { type: "Public IP", armType: "microsoft.network/publicipaddresses", issue: "IP Pública sin asignar", savings: 3.5, issueType: "cost", manualDelete: false },
          staleSnapshots: { type: "Snapshot", armType: "microsoft.compute/snapshots", issue: "Snapshot Antiguo (>90d)", savings: 5.0, issueType: "cost", manualDelete: false },
          oldSnapshots: { type: "Snapshot", armType: "microsoft.compute/snapshots", issue: "Snapshot Antiguo (>30d)", savings: 5.0, issueType: "cost", manualDelete: false },
          taggingNonCompliance: { type: "Resource", armType: "unknown", issue: "Sin Etiquetas FinOps", savings: 0.0, issueType: "governance", manualDelete: true },
          orphanedNics: { type: "NIC", armType: "microsoft.network/networkinterfaces", issue: "NIC Huérfano", savings: 0.0, issueType: "cost", manualDelete: false },
          orphanedNsgs: { type: "NSG", armType: "microsoft.network/networksecuritygroups", issue: "NSG sin asociar", savings: 0.0, issueType: "governance", manualDelete: false },
          emptyAppServicePlans: { type: "App Service Plan", armType: "microsoft.web/serverfarms", issue: "Plan ASP vacío", savings: 45.0, issueType: "cost", manualDelete: false },
          availabilitySets: { type: "Availability Set", armType: "microsoft.compute/availabilitysets", issue: "Set vacío", savings: 0.0, issueType: "governance", manualDelete: false },
          elasticPools: { type: "SQL Elastic Pool", armType: "microsoft.sql/servers/elasticpools", issue: "Pool Vacío", savings: 250.0, issueType: "cost", manualDelete: false },
          emptySqlElasticPools: { type: "SQL Elastic Pool", armType: "microsoft.sql/servers/elasticpools", issue: "Pool sin bases de datos", savings: 150.0, issueType: "cost", manualDelete: false },
          idleVmss: { type: "VM Scale Set", armType: "microsoft.compute/virtualmachinescalesets", issue: "Escalado a 0 instancias", savings: 0.0, issueType: "governance", manualDelete: false },
          routeTables: { type: "Route Table", armType: "microsoft.network/routetables", issue: "No asignada", savings: 0.0, issueType: "governance", manualDelete: false },
          loadBalancers: { type: "Load Balancer", armType: "microsoft.network/loadbalancers", issue: "Sin Backend", savings: 18.0, issueType: "cost", manualDelete: false },
          unusedLoadBalancers: { type: "Load Balancer", armType: "microsoft.network/loadbalancers", issue: "Sin Frontend / Backend Vacío", savings: 18.0, issueType: "cost", manualDelete: false },
          frontDoorWaf: { type: "Front Door WAF", armType: "microsoft.network/frontdoorwebapplicationfirewallpolicies", issue: "Sin Política", savings: 5.0, issueType: "cost", manualDelete: false },
          trafficManager: { type: "Traffic Manager", armType: "microsoft.network/trafficmanagerprofiles", issue: "Sin Endpoints", savings: 3.0, issueType: "cost", manualDelete: false },
          appGateways: { type: "App Gateway", armType: "microsoft.network/applicationgateways", issue: "Sin Backend IPs", savings: 180.0, issueType: "cost", manualDelete: false },
          unusedAppGateways: { type: "App Gateway", armType: "microsoft.network/applicationgateways", issue: "Sin Backend / Sin Reglas", savings: 250.0, issueType: "cost", manualDelete: false },
          emptyVnets: { type: "VNET", armType: "microsoft.network/virtualnetworks", issue: "Red Vacía", savings: 0.0, issueType: "governance", manualDelete: false },
          emptySubnets: { type: "Subnet", armType: "microsoft.network/virtualnetworks/subnets", issue: "Subred Vacía", savings: 0.0, issueType: "governance", manualDelete: false },
          natGateways: { type: "NAT Gateway", armType: "microsoft.network/natgateways", issue: "Sin Subred", savings: 32.0, issueType: "cost", manualDelete: false },
          ipGroups: { type: "IP Group", armType: "microsoft.network/ipgroups", issue: "Sin Firewall", savings: 0.0, issueType: "governance", manualDelete: false },
          privateDnsZones: { type: "Private DNS", armType: "microsoft.network/privatednszones", issue: "Sin Enlaces", savings: 0.5, issueType: "governance", manualDelete: false },
          privateEndpoints: { type: "Private Endpoint", armType: "microsoft.network/privateendpoints", issue: "Desconectado", savings: 7.0, issueType: "cost", manualDelete: false },
          vnetGateways: { type: "VNet Gateway", armType: "microsoft.network/virtualnetworkgateways", issue: "Sin Conexiones", savings: 130.0, issueType: "cost", manualDelete: false },
          unusedVNetGateways: { type: "VNet Gateway", armType: "microsoft.network/virtualnetworkgateways", issue: "Sin Conexiones Activas", savings: 130.0, issueType: "cost", manualDelete: false },
          ddos: { type: "DDoS Plan", armType: "microsoft.network/ddosprotectionplans", issue: "Sin Recursos", savings: 2944.0, issueType: "cost", manualDelete: false },
          emptyRgs: { type: "Resource Group", armType: "microsoft.resources/subscriptions/resourcegroups", issue: "RG Vacío", savings: 0.0, issueType: "governance", manualDelete: false, isHygiene: true },
          apiConnections: { type: "API Connection", armType: "microsoft.web/connections", issue: "Desconectada", savings: 0.0, issueType: "governance", manualDelete: false },
          expiredCerts: { type: "Certificate", armType: "microsoft.web/certificates", issue: "Expirado", savings: 0.0, issueType: "governance", manualDelete: false },
          unattachedPublicIps: { type: "PublicIPAddresses", armType: "microsoft.network/publicipaddresses", issue: "IP Pública sin asignar", savings: 3.5, issueType: "cost", manualDelete: false },
          unattachedNics: { type: "NetworkInterfaces", armType: "microsoft.network/networkinterfaces", issue: "NIC Huérfano", savings: 0.0, issueType: "cost", manualDelete: false },
          longStoppedVMs: { type: "DeallocatedVMs", armType: "microsoft.compute/virtualmachines", issue: "VM Apagada con Discos", savings: 30.0, issueType: "cost", manualDelete: false },
        };

        let allMappedData: any[] = [];
        for (const [key, configValue] of Object.entries(resourceConfig)) {
          const config = configValue as any;
          const items = audit[key] || [];
          const mapped = items.map((r: any) => ({
            id: r.id || r.resourceId,
            resourceName: r.name,
            type: r.type
              ? r.type.toLowerCase().includes("serverfarms")
                ? "ServerFarms"
                : r.type.toLowerCase().includes("virtualnetworkgateways")
                ? "VirtualNetworkGateways"
                : r.type.toLowerCase().includes("snapshots")
                ? "Snapshots"
                : r.type.toLowerCase().includes("virtualmachines")
                ? "DeallocatedVMs"
                : r.type.toLowerCase().includes("publicipaddresses")
                ? "PublicIPAddresses"
                : r.type.toLowerCase().includes("networkinterfaces")
                ? "NetworkInterfaces"
                : r.type.split("/").pop() || config.type
              : config.type,
            armType: r.type || config.armType,
            resourceGroup: r.resourceGroup,
            issue: config.issue,
            issueKey: key,
            subscriptionId: r.subscriptionId || selectedSub,
            subscriptionName:
              resolvedSubscriptions.find((sub: any) => sub.id === (r.subscriptionId || selectedSub))?.name ||
              (r.subscriptionName || r.subscriptionId || selectedSub),
            region: r.location || r.region || r.resourceLocation || r.geo || "-",
            potentialSavings:
              r.estimatedMonthlyCost ||
              (r.diskSizeGB ? r.diskSizeGB * 0.15 : r.sizeGB ? r.sizeGB * 0.05 : config.savings),
            issueType: config.issueType,
            manualDelete: config.manualDelete,
            isHygiene: r.isHygiene || config.isHygiene || false,
            isLocked: r.isLocked || false,
            isExempted: r.isExempted || false,
            exemptionReason: r.exemptionReason || null,
            exemptionComment: r.exemptionComment || null,
          }));
          allMappedData = [...allMappedData, ...mapped];
        }

        if (forceFilterType) {
          allMappedData = allMappedData.filter((d) => d.type === forceFilterType);
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
    if (tLower.includes("app service") || tLower.includes("serverfarms") || armLower.includes("serverfarms")) return <IconCloud className="w-4 h-4 text-[#0078D4] stroke-[1.5] shrink-0" />;
    if (tLower.includes("load balancer") || armLower.includes("loadbalancers")) return <IconArrowsSplit className="w-4 h-4 text-[#0078D4] stroke-[1.5] shrink-0" />;
    if (tLower.includes("gateway") || armLower.includes("virtualnetworkgateways")) return <IconNetwork className="w-4 h-4 text-[#0078D4] stroke-[1.5] shrink-0" />;
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
                  className={`truncate max-w-[220px] font-semibold text-xs text-slate-900 dark:text-slate-100 ${
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
                    <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 m-0 truncate max-w-[200px]">
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
              className={`text-xs font-mono max-w-[150px] truncate ${item.isLocked ? "filter blur-xs select-none" : ""}`}
              title={item.id}
            >
              <div className="text-slate-600 dark:text-slate-400 font-semibold truncate">{item.id?.split("/").pop()}</div>
              <div className="text-[10px] text-slate-400 mt-0.5 truncate">{item.armType}</div>
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
        const label = item.subscriptionName || item.subscriptionId || "N/A";
        return (
          <span
            className={`text-xs text-slate-600 dark:text-slate-400 font-medium truncate max-w-[160px] block ${
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
          <span className={`text-xs text-slate-600 dark:text-slate-400 ${item.isLocked ? "filter blur-xs select-none" : ""}`}>
            {item.region || "-"}
          </span>
        );
      },
    });

    cols.push({
      accessorKey: "type",
      header: t("colType"),
      cell: (info) => (
        <span className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded text-[11px] font-medium border border-slate-200/60 dark:border-slate-700">
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
            className={`text-xs text-slate-600 dark:text-slate-400 font-medium truncate max-w-[140px] block ${
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
        const val = item.potentialSavings as number;
        if (item.isHygiene) {
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800/50">
              {t("hygiene")}
            </span>
          );
        }
        return (
          <span className={`font-bold text-xs ${val > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}>
            {val > 0
              ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val) + "/mes"
              : "-"}
          </span>
        );
      },
    });

    cols.push({
      id: "actions",
      header: t("colActions"),
      cell: ({ row }) => {
        const item = row.original;
        const isTagCompliance = item.issueKey === "taggingNonCompliance";
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
                        setTagValues({ CostCenter: "", Environment: "", Owner: "" });
                      }}
                      disabled={!canTag}
                      title={!canTag ? t("enterpriseTooltip") : ""}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 ${
                        !canTag
                          ? "bg-slate-50 text-slate-400 border border-slate-200 cursor-not-allowed"
                          : "bg-white dark:bg-slate-900 text-[#0054A6] border border-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/30 cursor-pointer active:scale-95"
                      }`}
                    >
                      <IconTag className="w-3.5 h-3.5 stroke-[1.5]" />
                      {t("setTags")}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        triggerCopilotWithPrompt(
                          t("suggestPrompt", {
                            name: item.resourceName,
                            type: item.type,
                            group: item.resourceGroup,
                          })
                        )
                      }
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold shadow-xs transition-all bg-white dark:bg-slate-900 text-sky-600 border border-sky-400 hover:bg-sky-50/50 dark:hover:bg-sky-950/30 flex items-center gap-1 cursor-pointer active:scale-95"
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
                        : "bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 border border-rose-300 dark:border-rose-700 hover:bg-rose-50/50 dark:hover:bg-rose-950/30 cursor-pointer active:scale-95"
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
                      className="px-2 py-1 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 text-[#0054A6] border border-[#0054A6]/60 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 inline-flex items-center gap-1 shadow-xs cursor-pointer active:scale-95 transition-all"
                      title={t("btn_edit_exemption")}
                    >
                      <IconEdit className="w-3.5 h-3.5 stroke-[1.5]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveExemption(item)}
                      className="px-2 py-1 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 text-emerald-600 border border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/30 inline-flex items-center gap-1 shadow-xs cursor-pointer active:scale-95 transition-all"
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
            Estado
          </label>
          <select
            value={exemptionFilter}
            onChange={(e) => setExemptionFilter(e.target.value as any)}
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-lg p-2 outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4]"
          >
            <option value="all">Todos</option>
            <option value="active">Activos</option>
            <option value="exempted">Eximidos</option>
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
                Ahorro potencial: ${totalSelectedSavings.toFixed(2)} USD/mes
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTaggingItems(filteredData.filter((i) => selectedIds.has(i.id)));
                setTagValues({ CostCenter: "", Environment: "", Owner: "" });
              }}
              disabled={!canTag}
              title={!canTag ? t("enterpriseTooltip") : ""}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 shadow-xs ${
                !canTag
                  ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                  : "bg-white dark:bg-slate-900 text-[#0054A6] border border-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/30 cursor-pointer active:scale-95"
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
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-slate-900 text-rose-600 border border-rose-400 hover:bg-rose-50/50 dark:hover:bg-rose-950/30 transition-all flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <IconTrash className="w-3.5 h-3.5 stroke-[1.5]" />
                {bulkDeleting ? t("deletingBulk") : `Ejecutar Remediación Masiva ($${totalSelectedSavings.toFixed(2)}/mes) ✨`}
              </button>
            ) : canRequestDelete ? (
              <button
                type="button"
                onClick={handleBulkRequestDeletion}
                disabled={bulkDeleting}
                title={t("requestDeleteSelectedTooltip")}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-slate-900 text-amber-700 border border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-950/30 transition-all flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <IconSend className="w-3.5 h-3.5 stroke-[1.5]" />
                {bulkDeleting ? t("sendingBulk") : t("requestDeleteSelected")}
              </button>
            ) : (
              <span
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-400 border border-slate-200"
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
                  Confirmar Remediación Masiva
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
                Estás a punto de eliminar <b>{selectedIds.size} recursos seleccionados</b>.
              </p>
              <div className="p-3 bg-rose-50 dark:bg-rose-950/30 rounded-xl border border-rose-200 dark:border-rose-900/50 text-xs text-rose-700 dark:text-rose-300">
                Ahorro mensual proyectado a recuperar: <b>${totalSelectedSavings.toFixed(2)} USD/mes</b>.
                Esta acción es irreversible y ejecutará las llamadas REST a Azure ARM correspondientes.
              </div>
            </div>
            <div className="flex justify-end gap-3 p-4 bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setBulkConfirmModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50"
              >
                Cancelar
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
                    Eliminando...
                  </>
                ) : (
                  "Confirmar y Purgar Recursos"
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
            <div className="space-y-3 mb-6">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">CostCenter</label>
                <input
                  type="text"
                  className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4]"
                  placeholder={t("costCenterPlaceholder")}
                  value={tagValues.CostCenter}
                  onChange={(e) => setTagValues({ ...tagValues, CostCenter: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Environment</label>
                <select
                  className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4]"
                  value={tagValues.Environment}
                  onChange={(e) => setTagValues({ ...tagValues, Environment: e.target.value })}
                >
                  <option value="">{t("environmentSelectPlaceholder")}</option>
                  <option value="Production">Production</option>
                  <option value="Staging">Staging</option>
                  <option value="Development">Development</option>
                  <option value="Testing">Testing</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Owner</label>
                <input
                  type="text"
                  className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4]"
                  placeholder={t("ownerPlaceholder")}
                  value={tagValues.Owner}
                  onChange={(e) => setTagValues({ ...tagValues, Owner: e.target.value })}
                />
              </div>
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
                disabled={isTagging || !tagValues.CostCenter || !tagValues.Environment || !tagValues.Owner}
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
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Eximir Recurso</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Marcar recurso como justificado o ignorado
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
                  Estás a punto de eximir el recurso{" "}
                  <span className="font-mono font-bold">{exemptionModalResource.resourceName}</span>. Este recurso
                  dejará de sumar a los reportes de ahorro potencial y será ignorado en futuras auditorías.
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Motivo principal <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={reasonInput}
                    onChange={(e) => setReasonInput(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4]"
                  >
                    <option value="VM requerida para backups periódicos de MySQL">Backup Periódico</option>
                    <option value="Entorno de Disaster Recovery (DR)">Disaster Recovery (DR)</option>
                    <option value="Recurso temporal mantenido por auditoría/compliance">Auditoría / Compliance</option>
                    <option value="Recurso Legacy (Proceso de migración)">Recurso Legacy (Migrando)</option>
                    <option value="Eximida por decisión del usuario">Otro Motivo</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                    <IconMessageDots className="w-4 h-4 text-slate-400 stroke-[1.5]" />
                    Justificación adicional
                  </label>
                  <textarea
                    value={commentInput}
                    onChange={(e) => setCommentInput(e.target.value)}
                    placeholder="Detalla por qué este recurso debe mantenerse activo o ignorarse en los reportes..."
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
                Cancelar
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
                    Guardando...
                  </>
                ) : (
                  <>
                    <IconCheck className="w-3.5 h-3.5 stroke-[2]" />
                    Guardar Exención
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

