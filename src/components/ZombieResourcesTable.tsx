"use client";
import React, { useEffect, useState, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from './TenantProvider';
import { useSubscription } from './SubscriptionProvider';
import { useViewMode } from '../context/ViewModeContext';
import RoleAssignmentBanner from './RoleAssignmentBanner';
import { toast } from 'sonner';
import { useActionLogStore } from '@/store/actionLogStore';
import { useTranslations } from 'next-intl';
import { useAIContext } from '@/hooks/useAIContext';
import { getMockDataForRoute, isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { canDeleteResources, canRemediateTags } from '@/lib/tierLogic';
import EnterpriseDeleteDisclaimer from '@/components/EnterpriseDeleteDisclaimer';
import { usePendingDeletionsStore } from '@/store/pendingDeletionsStore';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  ColumnDef,
  SortingState
} from '@tanstack/react-table';
import { EyeOff, Eye, X, MessageSquare, AlertTriangle , ShieldCheck, Shield, Edit3, Trash2} from 'lucide-react';

export default function ZombieResourcesTable({ forceFilterType }: { forceFilterType?: string }) {
  const { instance, accounts } = useMsal();
  const { selectedTenant, userRole, systemRole } = useTenant();
  const { viewMode } = useViewMode();
  const { addAction } = useActionLogStore();
  const { addPending, isPending } = usePendingDeletionsStore();
  const triggerCopilotWithPrompt = useAIContext(state => state.triggerCopilotWithPrompt);
  const { selectedSubscription, setSelectedSubscription } = useSubscription();
  
  // Removed conditional useTranslations hook which was causing React Error 310.
  // Called unconditionally at the top level to comply with the Rules of Hooks.
  const t = useTranslations('Zombies');
  const [data, setData] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [selectedSub, setSelectedSub] = useState<string>("all");

  useEffect(() => {
    if (selectedSubscription) {
      setSelectedSub(selectedSubscription.toLowerCase() === 'all' ? 'all' : selectedSubscription);
    }
  }, [selectedSubscription]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterGroup, setFilterGroup] = useState<string>('all');
  const [filterIssue, setFilterIssue] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [error, setError] = useState<string | null>(null);

  const [taggingItems, setTaggingItems] = useState<any[]>([]);
  const [tagValues, setTagValues] = useState({ CostCenter: '', Environment: '', Owner: '' });
  const [isTagging, setIsTagging] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Exemption Modal State
  const [exemptionModalResource, setExemptionModalResource] = useState<any | null>(null);
  const [reasonInput, setReasonInput] = useState("");
  const [commentInput, setCommentInput] = useState("");
  const [savingExemption, setSavingExemption] = useState(false);
  const [exemptionFilter, setExemptionFilter] = useState<'all' | 'active' | 'exempted'>('all');

  // Poda ids seleccionados que ya no existen en `data` (ej. tras eliminarlos).
  useEffect(() => {
      setSelectedIds(prev => {
          if (prev.size === 0) return prev;
          const validIds = new Set(data.map(d => d.id));
          const next = new Set(Array.from(prev).filter(id => validIds.has(id)));
          return next.size === prev.size ? prev : next;
      });
  }, [data]);

  const toggleSelected = (id: string) => {
      setSelectedIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
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
        setData(prev => prev.map(v => v.id === exemptionModalResource.id ? {
          ...v,
          isExempted: true,
          exemptionReason: reasonInput || "Eximida por el usuario",
          exemptionComment: commentInput || null
        } : v));
        setExemptionModalResource(null);
        setSavingExemption(false);
        return;
      }

      const account = accounts[0];
      const token = await getFreshIdToken(instance, account);

      const res = await fetch('/api/intelligence/zombies/exemptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-tenant-id': selectedTenant.id
        },
        body: JSON.stringify({
          resourceId: exemptionModalResource.id,
          resourceName: exemptionModalResource.resourceName,
          recommendationType: 'zombies',
          reason: reasonInput || "Eximida por el usuario",
          comment: commentInput || null
        })
      });
      const json = await res.json();
      if (json.success) {
        setData(prev => prev.map(v => v.id === exemptionModalResource.id ? {
          ...v,
          isExempted: true,
          exemptionReason: reasonInput || "Eximida por el usuario",
          exemptionComment: commentInput || null
        } : v));
        setExemptionModalResource(null);
        toast.success(t("exemptionSaved", { defaultMessage: "Exención guardada" }));
      } else {
        toast.error(json.error || t("errorServer"));
      }
    } catch (e: any) {
      toast.error(e.message || String(e));
    }
    setSavingExemption(false);
  };

  const handleRemoveExemption = async (item: any) => {
    if (!window.confirm("¿Seguro que deseas remover la exención de este recurso?")) return;
    try {
      if (isMockTenant(selectedTenant.id)) {
        setData(prev => prev.map(v => v.id === item.id ? {
          ...v,
          isExempted: false,
          exemptionReason: null,
          exemptionComment: null
        } : v));
        return;
      }

      const account = accounts[0];
      const token = await getFreshIdToken(instance, account);

      const res = await fetch(`/api/intelligence/zombies/exemptions?resourceId=${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'x-tenant-id': selectedTenant.id
        }
      });
      const json = await res.json();
      if (json.success) {
        setData(prev => prev.map(v => v.id === item.id ? {
          ...v,
          isExempted: false,
          exemptionReason: null,
          exemptionComment: null
        } : v));
        toast.success("Exención removida");
      } else {
        toast.error(json.error || t("errorServer"));
      }
    } catch (e: any) {
      toast.error(e.message || String(e));
    }
  };

  // Ejecuta el DELETE contra /api/remediation para un único recurso; no
  // muestra toasts (los llamadores single-item y bulk manejan su propio
  // feedback agregado).
  const deleteResourceItem = async (item: any): Promise<{ ok: boolean; error?: string }> => {
      try {
          const idToken = await getFreshIdToken(instance, accounts[0]);
          const res = await fetch('/api/remediation', {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${idToken}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                  tenantId: selectedTenant.id,
                  subscriptionId: item.subscriptionId,
                  resourceGroup: item.resourceGroup,
                  resourceName: item.resourceName,
                  resourceType: item.armType,
                  domain: 'zombies'
              })
          });
          const json = await res.json();
          if (!res.ok) return { ok: false, error: json.error || t('errorDeleteGeneric') };
          return { ok: true };
      } catch (err: any) {
          return { ok: false, error: err.message };
      }
  };

  const handleDelete = async (item: any) => {
      if (item.manualDelete) {
          toast.error(t('toastManualTitle'), { description: t('toastManualDesc', { type: item.type }) });
          return;
      }

      if (!window.confirm(t('confirmDeleteSingle', { name: item.resourceName }))) return;

      setDeletingId(item.id);
      const result = await deleteResourceItem(item);
      if (result.ok) {
          addPending({
              id: item.id,
              name: item.resourceName,
              type: item.type,
              tenantId: selectedTenant.id
          });
          toast.success(t('toastDeletedTitle'), { description: t('toastDeletedDesc', { name: item.resourceName }) });
          addAction({ message: t('logDeleted', { name: item.resourceName }), status: 'success' });
      } else if (result.error === "MISSING_CONTRIBUTOR_ROLE") {
          toast.error(t('toastDeniedTitle'), { description: t('toastDeniedDesc') });
          addAction({ message: t('logDeniedSingle', { name: item.resourceName }), status: 'error' });
      } else {
          toast.error(t('toastDeleteErrorTitle'), { description: result.error });
          addAction({ message: t('logDeleteError', { name: item.resourceName, error: result.error || '' }), status: 'error' });
      }
      setDeletingId(null);
  };

  // Colaborador no tiene permiso de borrado directo (requireTenantRole en
  // /api/remediation exige Admin/Owner) — en vez de mostrarle un botón
  // "Borrar" que siempre falla con 403, se le ofrece solicitar la
  // eliminación: crea un pending en RemediationRequests (visible en
  // /remediation/approvals) y notifica al Admin por los canales configurados
  // (Slack/Teams/Email) para que sea él quien la ejecute.
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const requestDeletion = async (item: any) => {
      if (!window.confirm(t('confirmRequestSingle', { name: item.resourceName }))) return;
      setRequestingId(item.id);
      try {
          const idToken = await getFreshIdToken(instance, accounts[0]);
          const res = await fetch('/api/remediation/workflow', {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${idToken}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                  tenantId: selectedTenant.id,
                  resourceId: item.id,
                  resourceName: item.resourceName,
                  actionType: 'Eliminación de recurso zombi',
                  estimatedSavings: item.potentialSavings || 0
              })
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || t('errorRequestFailed'));
          toast.success(t('toastRequestSentTitle'), { description: t('toastRequestSentDesc', { name: item.resourceName }) });
          addAction({ message: t('logRequestSent', { name: item.resourceName }), status: 'success' });
      } catch (err: any) {
          toast.error(t('toastRequestErrorTitle'), { description: err.message });
      }
      setRequestingId(null);
  };

  const handleBulkDelete = async () => {
      const items = filteredData.filter(i => selectedIds.has(i.id) && !i.manualDelete);
      if (items.length === 0) return;
      if (!window.confirm(t('confirmBulkDelete', { count: items.length }))) return;

      setBulkDeleting(true);
      let ok = 0, missingRole = 0, failed = 0;
      for (const item of items) {
          setDeletingId(item.id);
          const result = await deleteResourceItem(item);
          if (result.ok) {
              ok++;
              addPending({
                  id: item.id,
                  name: item.resourceName,
                  type: item.type,
                  tenantId: selectedTenant.id
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

      if (ok > 0) {
          toast.success(t('toastBulkDeletedTitle', { count: ok }), { description: t('toastBulkDeletedDesc') });
          addAction({ message: t('logBulkDeleted', { count: ok }), status: 'success' });
      }
      if (missingRole > 0) {
          toast.error(t('toastDeniedTitle'), { description: t('toastBulkDeniedDesc', { count: missingRole }) });
      }
      if (failed > 0) {
          toast.error(t('toastBulkDeleteErrorTitle'), { description: t('toastBulkDeleteErrorDesc', { count: failed }) });
      }
  };

  const handleBulkRequestDeletion = async () => {
      const items = filteredData.filter(i => selectedIds.has(i.id) && !i.manualDelete);
      if (items.length === 0) return;
      if (!window.confirm(t('confirmBulkRequest', { count: items.length }))) return;

      setBulkDeleting(true);
      let ok = 0, failed = 0;
      for (const item of items) {
          setRequestingId(item.id);
          try {
              const idToken = await getFreshIdToken(instance, accounts[0]);
              const res = await fetch('/api/remediation/workflow', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                      tenantId: selectedTenant.id,
                      resourceId: item.id,
                      resourceName: item.resourceName,
                      actionType: 'Eliminación de recurso zombi',
                      estimatedSavings: item.potentialSavings || 0
                  })
              });
              if (res.ok) ok++; else failed++;
          } catch {
              failed++;
          }
      }
      setRequestingId(null);
      setBulkDeleting(false);
      setSelectedIds(new Set());

      if (ok > 0) toast.success(t('toastBulkRequestSentTitle', { count: ok }), { description: t('toastBulkRequestSentDesc') });
      if (failed > 0) toast.error(t('toastBulkRequestErrorTitle'), { description: t('toastBulkRequestErrorDesc', { count: failed }) });
  };

  const handleTagSubmit = async () => {
      if (taggingItems.length === 0) return;
      setIsTagging(true);

      let ok = 0, failed = 0;
      for (const item of taggingItems) {
          try {
              const idToken = await getFreshIdToken(instance, accounts[0]);
              const res = await fetch('/api/tags/apply', {
                  method: 'POST',
                  headers: {
                      'Authorization': `Bearer ${idToken}`,
                      'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                      tenantId: selectedTenant.id,
                      resourceId: item.id,
                      tags: tagValues
                  })
              });

              const json = await res.json();
              if (!res.ok) throw new Error(json.details || json.error || t('errorTagFailed'));

              ok++;
              setData(prev => prev.filter(r => r.id !== item.id));
              addAction({ message: t('logTagged', { name: item.resourceName }), status: 'success' });
          } catch (err: any) {
              console.error("Error tagging:", err);
              failed++;
              addAction({ message: t('logTagError', { name: item.resourceName, error: err.message }), status: 'error' });
          }
      }

      setIsTagging(false);
      setTaggingItems([]);
      setSelectedIds(new Set());

      if (ok > 0) toast.success(ok === 1 ? t('toastTaggedSingle') : t('toastTaggedMultiple', { count: ok }));
      if (failed > 0) toast.error(t('toastTagErrorCount', { count: failed }));
  };

  useEffect(() => {
    if ((accounts.length === 0 && !isMockTenant(selectedTenant.id)) || selectedTenant.id === 'default') {
      setLoading(false);
      return;
    }

    const fetchResourcesAndSubs = async () => {
      try {
        setLoading(true);
        const tenantId = selectedTenant.id;

        const idToken = await getFreshIdToken(instance, accounts[0]);
        const headers = { 'Authorization': `Bearer ${idToken}` };

        if (subscriptions.length === 0) {
            const subRes = await fetch(`/api/subscriptions?tenantId=${tenantId}`, { headers });
            if (subRes.ok) {
                const subJson = await subRes.json();
                setSubscriptions(subJson.subscriptions || []);
            }
        }

        let apiUrl = `/api/audit/full?tenantId=${tenantId}`;
        if (selectedSub !== "all") {
            apiUrl += `&subscriptionId=${selectedSub}`;
        }

        let json;
        if (isMockTenant(tenantId)) {
            json = getMockDataForRoute('audit_full', tenantId);
        } else {
            const res = await fetch(apiUrl, { headers });
            json = await res.json();
            
            if (!res.ok || json.error) {
                setError(json.error === 'MISSING_RBAC_ROLE' ? 'MISSING_RBAC_ROLE' : (json.error || t('errorServer')));
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
            longStoppedVMs: { type: "DeallocatedVMs", armType: "microsoft.compute/virtualmachines", issue: "VM Apagada con Discos", savings: 30.0, issueType: "cost", manualDelete: false }
        };

        let allMappedData: any[] = [];
        for (const [key, configValue] of Object.entries(resourceConfig)) {
            const config = configValue as any;
            const items = audit[key] || [];
            const mapped = items.map((r: any) => ({
                id: r.id || r.resourceId,
                resourceName: r.name,
                type: r.type ? (
                    r.type.toLowerCase().includes("serverfarms") ? "ServerFarms" :
                    r.type.toLowerCase().includes("virtualnetworkgateways") ? "VirtualNetworkGateways" :
                    r.type.toLowerCase().includes("snapshots") ? "Snapshots" :
                    r.type.toLowerCase().includes("virtualmachines") ? "DeallocatedVMs" :
                    r.type.toLowerCase().includes("publicipaddresses") ? "PublicIPAddresses" :
                    r.type.toLowerCase().includes("networkinterfaces") ? "NetworkInterfaces" :
                    (r.type.split("/").pop() || config.type)
                ) : config.type,
                armType: r.type || config.armType,
                resourceGroup: r.resourceGroup,
                issue: config.issue,
                issueKey: key,
                subscriptionId: r.subscriptionId || selectedSub,
                potentialSavings: r.estimatedMonthlyCost || (r.diskSizeGB ? r.diskSizeGB * 0.15 : (r.sizeGB ? r.sizeGB * 0.05 : config.savings)),
                issueType: config.issueType,
                manualDelete: config.manualDelete,
                isHygiene: r.isHygiene || config.isHygiene || false,
                isLocked: r.isLocked || false,
                isExempted: r.isExempted || false,
                exemptionReason: r.exemptionReason || null,
                exemptionComment: r.exemptionComment || null
            }));
            allMappedData = [...allMappedData, ...mapped];
        }

        if (forceFilterType) {
            allMappedData = allMappedData.filter(d => d.type === forceFilterType);
        }

        if (!isMockTenant(tenantId)) {
            const exemptionsRes = await fetch('/api/intelligence/zombies/exemptions', {
                headers: {
                    ...headers,
                    'x-tenant-id': tenantId
                }
            });
            if (exemptionsRes.ok) {
                const exemptionsJson = await exemptionsRes.json();
                const exemptions = Array.isArray(exemptionsJson?.data) ? exemptionsJson.data : [];
                const exMap = new Map(
                    exemptions
                        .filter((e: any) => e.recommendationType === 'zombies')
                        .map((e: any) => [String(e.resourceId || '').toLowerCase(), e])
                );

                allMappedData = allMappedData.map((item) => {
                    const ex = exMap.get(String(item.id || '').toLowerCase()) as any;
                    if (!ex) {
                        return { ...item, isExempted: false, exemptionReason: null, exemptionComment: null };
                    }
                    return {
                        ...item,
                        isExempted: true,
                        exemptionReason: ex.reason || null,
                        exemptionComment: ex.comment || null
                    };
                });
            }
        }

        setData(allMappedData);
        setError(null);
        setLoading(false);
      } catch (err: any) {
        console.error("Error obteniendo datos:", err);
        const errName = err?.name || (err?.constructor && err?.constructor.name) || "";
        const errCode = err?.errorCode || err?.code || "";
        const errMsg = err?.message || err?.errorMessage || "";

        if (
            errName === "BrowserAuthError" ||
            errName === "InteractionRequiredAuthError" ||
            errCode === "block_iframe_reload" ||
            errCode === "timed_out" ||
            errCode === "interaction_required" ||
            errCode === "consent_required" ||
            errCode === "login_required" ||
            errMsg.includes("block_iframe_reload") ||
            errMsg.includes("timed_out")
        ) {
            console.warn("MSAL silent token failure in ZombieResourcesTable, redirecting...", err);
            instance.acquireTokenRedirect({
                scopes: ["User.Read"],
                account: accounts[0]
            }).catch(e => console.error("Error initiating redirect login in ZombieResourcesTable:", e));
        } else {
            setError(t('errorNetwork'));
        }
        setLoading(false);
      }
    };

    fetchResourcesAndSubs();
  }, [accounts, instance, selectedSub, selectedTenant, forceFilterType]);

  const filteredData = useMemo(() => {
    return data.filter(item => {
        const matchName = !searchQuery || item.resourceName.toLowerCase().includes(searchQuery.toLowerCase());
        const matchType = !filterType || filterType === "all" || item.type.toLowerCase().includes(filterType.toLowerCase());
        const matchGroup = !filterGroup || filterGroup === "all" || item.resourceGroup.toLowerCase().includes(filterGroup.toLowerCase());
        const matchIssue = filterIssue === "all" || item.issueType === filterIssue;
        const matchExemption = exemptionFilter === 'all' || 
            (exemptionFilter === 'active' && !item.isExempted) || 
            (exemptionFilter === 'exempted' && item.isExempted);
        
        return matchName && matchType && matchGroup && matchIssue && matchExemption;
    });
  }, [data, filterType, filterGroup, filterIssue, searchQuery, exemptionFilter]);

  const hasLockedItems = useMemo(() => filteredData.some(item => item.isLocked), [filteredData]);
  const canDelete = canDeleteResources(selectedTenant.tier, 'zombies');
  const canTag = canRemediateTags(selectedTenant.tier);
  // Borrado directo: Admin/Owner/SuperAdmin. Colaborador (con tier habilitado)
  // solo puede solicitar la eliminación — ver requestDeletion() — porque
  // /api/remediation exige Admin/Owner server-side (403 si no).
  const canDeleteDirect = canDelete && (userRole === 'Admin' || userRole === 'Owner' || systemRole === 'SUPERADMIN');
  const canRequestDelete = canDelete && !canDeleteDirect;

  const columns = useMemo<ColumnDef<any>[]>(() => {
    const cols: ColumnDef<any>[] = [
      {
        id: 'select',
        header: ({ table }) => {
            const rows = table.getRowModel().rows;
            const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.original.id));
            const someSelected = !allSelected && rows.some(r => selectedIds.has(r.original.id));
            return (
                <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected; }}
                    onChange={() => {
                        setSelectedIds(prev => {
                            const next = new Set(prev);
                            if (allSelected) rows.forEach(r => next.delete(r.original.id));
                            else rows.forEach(r => next.add(r.original.id));
                            return next;
                        });
                    }}
                    className="cursor-pointer"
                />
            );
        },
        cell: ({ row }) => (
            <input
                type="checkbox"
                checked={selectedIds.has(row.original.id)}
                onChange={() => toggleSelected(row.original.id)}
                disabled={isPending(row.original.id)}
                className={`cursor-pointer ${isPending(row.original.id) ? 'opacity-50 cursor-not-allowed' : ''}`}
            />
        ),
        size: 36,
      },
      {
        accessorKey: 'resourceName',
        header: t('colResource'),
        cell: ({ row }) => {
            const item = row.original;
            return (
                <div className="flex flex-col">
                    <div className="flex items-center gap-[7px] font-bold text-ink">
                        {item.isExempted ? (
                            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : (
                            <AlertTriangle className={`w-4 h-4 text-amber`} />
                        )}
                        <span className={`font-semibold text-gray-800 dark:text-gray-200 ${item.isLocked ? 'filter blur-sm select-none' : ''}`}>{item.resourceName}</span>
                    </div>
                    {item.isExempted && (
                        <div className="mt-1.5 ml-6 flex flex-col gap-1">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 w-fit">
                                <Shield className="w-3 h-3" />
                                {t("badge_exempted")}
                            </span>
                            {item.exemptionReason && (
                                <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 m-0">
                                    📌 {item.exemptionReason}
                                </p>
                            )}
                            {item.exemptionComment && (
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 italic m-0 bg-surface-2 p-1.5 rounded border border-line/60 max-w-md">
                                    💬 "{item.exemptionComment}"
                                </p>
                            )}
                        </div>
                    )}
                </div>
            );
        },
      }
    ];

    if (viewMode === 'engineer') {
      cols.push({
        id: 'armDetails',
        header: t('colArmDetails'),
        cell: ({ row }) => {
            const item = row.original;
            return (
                <div className={`text-xs font-mono max-w-[150px] truncate ${item.isLocked ? 'filter blur-sm select-none' : ''}`} title={item.id}>
                    <div className="text-gray-500 font-semibold">{item.id?.split('/').pop()}</div>
                    <div className="text-[10px] text-gray-400 mt-1">{item.armType}</div>
                </div>
            );
        }
      });
      cols.push({
        accessorKey: 'subscriptionId',
        header: t('colSubscription'),
        cell: info => {
            const val = info.getValue() as string;
            return <span className="text-xs font-mono text-gray-500">{val === 'all' ? 'N/A' : val.substring(0,8) + '...'}</span>;
        }
      });
    }

    cols.push({
      accessorKey: 'type',
      header: t('colType'),
      cell: info => <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-1 rounded text-xs">{info.getValue() as string}</span>
    });

    cols.push({
      accessorKey: 'resourceGroup',
      header: t('colGroup'),
      cell: ({ row }) => {
          const item = row.original;
          return <span className={`text-xs text-gray-600 dark:text-gray-400 font-medium ${item.isLocked ? 'filter blur-sm select-none' : ''}`}>{item.resourceGroup || 'N/A'}</span>;
      }
    });

    cols.push({
      accessorKey: 'issue',
      header: t('colIssue'),
      cell: ({ row }) => {
          const item = row.original;
          return (
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${item.issueType === 'governance' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-100'}`}>
                {item.issueKey ? t(`issues.${item.issueKey}`) : item.issue}
            </span>
          );
      }
    });

    cols.push({
      accessorKey: 'potentialSavings',
      header: t('colSavings'),
      cell: ({ row }) => {
          const item = row.original;
          const val = item.potentialSavings as number;
          if (item.isHygiene) {
              return (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200">
                      {t('hygiene')}
                  </span>
              );
          }
          return <span className={`font-bold ${val > 0 ? "text-green-600" : "text-gray-400"}`}>{val > 0 ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val) : "-"}</span>;
      }
    });

    cols.push({
      id: 'actions',
      header: t('colActions'),
      cell: ({ row }) => {
          const item = row.original;
          const isTagCompliance = item.issueKey === 'taggingNonCompliance';
          return (
            <div className="text-right flex items-center justify-end gap-2">
                {isPending(item.id) ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-200">
                        <svg className="animate-spin h-3 w-3 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        {t('deleting')}
                    </span>
                ) : (
                    <>
                        {item.issueType === 'governance' && isTagCompliance && (
                            <>
                                <button
                                    onClick={() => {
                                        setTaggingItems([item]);
                                        setTagValues({ CostCenter: '', Environment: '', Owner: '' });
                                    }}
                                    disabled={!canTag}
                                    title={!canTag ? t('enterpriseTooltip') : ''}
                                    className={`px-3 py-1 rounded-md text-xs font-semibold shadow-sm transition-colors ${!canTag ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-[#0054A6] text-white hover:bg-[#00AEEF]'}`}
                                >
                                    {t('setTags')}
                                </button>
                                <button 
                                    onClick={() => triggerCopilotWithPrompt(t('suggestPrompt', { name: item.resourceName, type: item.type, group: item.resourceGroup }))}
                                    className="px-3 py-1 rounded-md text-xs font-semibold shadow-sm transition-colors bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
                                >
                                    {t('suggest')}
                                </button>
                            </>
                        )}
                        {canDeleteDirect ? (
                            <button
                                onClick={() => handleDelete(item)}
                                disabled={deletingId === item.id || (item.issueType === 'governance' && isTagCompliance)}
                                className={`px-3 py-1 rounded-md text-xs font-semibold shadow-sm transition-colors ${deletingId === item.id ? 'bg-gray-100 text-gray-400 cursor-wait' : (item.issueType === 'governance' && isTagCompliance) ? 'bg-gray-50 text-gray-300 cursor-not-allowed' : 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'}`}
                            >
                                {deletingId === item.id ? t('deleting') : t('delete')}
                            </button>
                        ) : canRequestDelete ? (
                            <button
                                onClick={() => requestDeletion(item)}
                                disabled={requestingId === item.id || (item.issueType === 'governance' && isTagCompliance)}
                                title={t('requestDeleteRowTooltip')}
                                className={`px-3 py-1 rounded-md text-xs font-semibold shadow-sm transition-colors ${requestingId === item.id ? 'bg-gray-100 text-gray-400 cursor-wait' : (item.issueType === 'governance' && isTagCompliance) ? 'bg-gray-50 text-gray-300 cursor-not-allowed' : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'}`}
                            >
                                {requestingId === item.id ? t('sending') : t('requestDelete')}
                            </button>
                        ) : (
                            <span className="px-3 py-1 rounded-md text-xs font-semibold bg-gray-50 text-gray-400 border border-gray-200" title={t('enterpriseTooltip')}>
                                {t('enterprise')}
                            </span>
                        )}
                        {item.isExempted ? (
                            <>
                                <button
                                    onClick={() => handleOpenExemptionModal(item)}
                                    className="font-heading font-semibold text-[11px] rounded-lg bg-surface-2 hover:bg-surface-3 text-ink border border-line p-[6px_10px] cursor-pointer active:scale-95 transition-all inline-flex items-center gap-1 shadow-xs"
                                    title={t("btn_edit_exemption")}
                                >
                                    <Edit3 className="w-3.5 h-3.5 text-primary" />
                                    {t("btn_edit_exemption")}
                                </button>
                                <button
                                    onClick={() => handleRemoveExemption(item)}
                                    className="font-heading font-semibold text-[11px] rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 p-[6px_10px] cursor-pointer active:scale-95 transition-all inline-flex items-center gap-1 shadow-xs"
                                    title={t("btn_remove_exemption")}
                                >
                                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                                    {t("btn_remove_exemption")}
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={() => handleOpenExemptionModal(item)}
                                className="font-heading font-semibold text-[11px] rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-line p-[7px_10px] cursor-pointer active:scale-95 transition-all inline-flex items-center gap-1 shadow-xs"
                                title={t("btn_exempt")}
                            >
                                <Shield className="w-3.5 h-3.5 text-amber" />
                                {t("btn_exempt")}
                            </button>
                        )}
                    </>
                )}
            </div>
          );
      }
    });

    return cols;
  }, [viewMode, deletingId, requestingId, canDeleteDirect, canRequestDelete, selectedIds, t, isPending, canTag]);

  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      sorting,
    },
    columnResizeMode: 'onChange',
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  if ((accounts.length === 0 && !isMockTenant(selectedTenant.id)) || selectedTenant.id === 'default') {
    return (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-8 text-center flex flex-col items-center justify-center">
            <svg className="w-12 h-12 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
            <h2 className="text-lg font-semibold text-gray-800 mb-2">{t('restrictedTitle')}</h2>
            <p className="text-sm text-gray-500">{t('restrictedDesc')}</p>
        </div>
    );
  }

  return (
    <div className="card">
      {!canDelete && <div className="mb-4"><EnterpriseDeleteDisclaimer domain="zombies" /></div>}
      <div className="card-h flex-col sm:flex-row items-start sm:items-center gap-4 border-b border-line pb-4 mb-4">
        <div>
            <h3 className="text-brand-deep dark:text-white m-0">
                {selectedSub === "all" ? t('auditGlobal') : t('auditFiltered')}
            </h3>
            {error && error !== 'MISSING_RBAC_ROLE' && <span className="mt-2 inline-block text-xs text-amber bg-amber-soft px-2 py-1 rounded border border-amber/20">{error}</span>}
        </div>
        
        <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
            <div className="flex items-center space-x-2">
                <label className="text-[11px] font-bold text-grey dark:text-gray-300 uppercase tracking-[0.5px]">{t('filterSubscription')}</label>
                <select 
                    value={selectedSub}
                    onChange={(e) => {
                        const val = e.target.value;
                        setSelectedSub(val);
                        setSelectedSubscription(val === 'all' ? 'All' : val);
                    }}
                    className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none w-32 placeholder-ink-soft"
                >
                    <option value="all">{t('filterAll')}</option>
                    {subscriptions.map((sub: any) => (
                        <option key={sub.id} value={sub.id}>{(sub.name || sub.id).substring(0,20)}...</option>
                    ))}
                </select>
            </div>
            <div className="flex items-center space-x-2">
                <label className="text-[11px] font-bold text-grey dark:text-gray-300 uppercase tracking-[0.5px]">{t('filterName')}</label>
                <input 
                    type="text" 
                    placeholder={t('filterNamePlaceholder')}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2 outline-none w-32 focus:border-brand-bright focus:ring-1 focus:ring-brand-bright placeholder-ink-soft"
                />
            </div>
            <div className="flex items-center space-x-2">
                <label className="text-[11px] font-bold text-grey dark:text-gray-300 uppercase tracking-[0.5px]">{t('filterType')}</label>
                <input 
                    type="text"
                    list="type-list"
                    placeholder={t('filterAllPlaceholder')}
                    value={filterType === 'all' ? '' : filterType}
                    onChange={e => setFilterType(e.target.value)}
                    className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2 outline-none w-32 focus:border-brand-bright focus:ring-1 focus:ring-brand-bright placeholder-ink-soft"
                />
                <datalist id="type-list">
                    {Array.from(new Set(data.map(d => d.type))).filter(Boolean).sort().map((opt: any) => <option key={opt} value={opt} />)}
                </datalist>
            </div>
            <div className="flex items-center space-x-2">
                <label className="text-[11px] font-bold text-grey dark:text-gray-300 uppercase tracking-[0.5px]">{t('filterGroup')}</label>
                <input 
                    type="text"
                    list="group-list"
                    placeholder={t('filterAllPlaceholder')}
                    value={filterGroup === 'all' ? '' : filterGroup}
                    onChange={e => setFilterGroup(e.target.value)}
                    className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2 outline-none w-32 focus:border-brand-bright focus:ring-1 focus:ring-brand-bright placeholder-ink-soft"
                />
                <datalist id="group-list">
                    {Array.from(new Set(data.map(d => d.resourceGroup))).filter(Boolean).sort().map((g: any) => <option key={g} value={g} />)}
                </datalist>
            </div>
            <div className="flex items-center space-x-2">
                <label className="text-[11px] font-bold text-grey dark:text-gray-300 uppercase tracking-[0.5px]">{t('filterSeverity')}</label>
                <select value={filterIssue} onChange={e => setFilterIssue(e.target.value)} className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2 outline-none w-32 focus:border-brand-bright focus:ring-1 focus:ring-brand-bright placeholder-ink-soft">
                    <option value="all">{t('filterAll')}</option>
                    <option value="cost">{t('severityCost')}</option>
                    <option value="governance">{t('severityGovernance')}</option>
                </select>
            </div>
            <div className="flex items-center space-x-2">
                <label className="text-[11px] font-bold text-grey dark:text-gray-300 uppercase tracking-[0.5px]">Estado</label>
                <select value={exemptionFilter} onChange={e => setExemptionFilter(e.target.value as any)} className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2 outline-none w-32 focus:border-brand-bright focus:ring-1 focus:ring-brand-bright placeholder-ink-soft">
                    <option value="all">Todos</option>
                    <option value="active">Activos</option>
                    <option value="exempted">Eximidos</option>
                </select>
            </div>
        </div>
      </div>

      {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800/50">
              <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">{t('selectedCount', { count: selectedIds.size })}</span>
              <button
                  onClick={() => {
                      setTaggingItems(filteredData.filter(i => selectedIds.has(i.id)));
                      setTagValues({ CostCenter: '', Environment: '', Owner: '' });
                  }}
                  disabled={!canTag}
                  title={!canTag ? t('enterpriseTooltip') : ''}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${!canTag ? 'bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-500 border border-gray-200 dark:border-slate-700 cursor-not-allowed' : 'bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40'}`}
              >
                  {t('tagSelected')}
              </button>
              {canDeleteDirect ? (
                  <button
                      onClick={handleBulkDelete}
                      disabled={bulkDeleting}
                      className="px-3 py-1.5 rounded-md text-xs font-semibold bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 hover:bg-red-100 dark:hover:bg-red-950/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                      {bulkDeleting ? t('deletingBulk') : t('deleteSelected')}
                  </button>
              ) : canRequestDelete ? (
                  <button
                      onClick={handleBulkRequestDeletion}
                      disabled={bulkDeleting}
                      title={t('requestDeleteSelectedTooltip')}
                      className="px-3 py-1.5 rounded-md text-xs font-semibold bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50 hover:bg-amber-100 dark:hover:bg-amber-950/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                      {bulkDeleting ? t('sendingBulk') : t('requestDeleteSelected')}
                  </button>
              ) : (
                  <span className="px-3 py-1.5 rounded-md text-xs font-semibold bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-500 border border-gray-200 dark:border-slate-700" title={t('enterpriseTooltip')}>
                      {t('deleteRequiresEnterprise')}
                  </span>
              )}
              <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-xs text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 font-semibold">
                  {t('clearSelection')}
              </button>
          </div>
      )}

      {error === 'MISSING_RBAC_ROLE' ? <RoleAssignmentBanner /> : loading ? (
          <div className="empty animate-pulse">{t('scanning')}</div>
      ) : (
        <div className="flex flex-col">
            <div className="overflow-x-auto w-full relative">
                {hasLockedItems && (
                    <div className="absolute inset-x-0 bottom-0 top-12 z-10 flex flex-col items-center justify-center bg-white/40 backdrop-blur-[1px]">
                        <a href="/upgrade" className="px-6 py-3 bg-brand-deep text-white font-bold rounded-lg shadow-lg hover:bg-brand-bright transition-all hover:scale-105 inline-flex items-center gap-2">
                            {t('upgradeCta')}
                        </a>
                    </div>
                )}
                <table className="tbl w-full" style={{ width: table.getCenterTotalSize() }}>
                    <thead>
                    {table.getHeaderGroups().map(headerGroup => (
                        <tr key={headerGroup.id}>
                        {headerGroup.headers.map(header => (
                            <th key={header.id} className="relative group" style={{ width: header.getSize() }}>
                            <div className="flex items-center justify-between">
                                {header.isPlaceholder ? null : (
                                <div
                                    {...{
                                    className: header.column.getCanSort() ? 'cursor-pointer select-none' : '',
                                    onClick: header.column.getToggleSortingHandler(),
                                    }}
                                >
                                    {flexRender(header.column.columnDef.header, header.getContext())}
                                    {{
                                    asc: ' 🔼',
                                    desc: ' 🔽',
                                    }[header.column.getIsSorted() as string] ?? null}
                                </div>
                                )}
                            </div>
                            <div
                                onMouseDown={header.getResizeHandler()}
                                onTouchStart={header.getResizeHandler()}
                                className={`absolute right-0 top-0 h-full w-1 cursor-col-resize bg-line opacity-0 group-hover:opacity-100 transition-opacity ${header.column.getIsResizing() ? 'opacity-100 bg-brand-deep' : ''}`}
                            />
                            </th>
                        ))}
                        </tr>
                    ))}
                    </thead>
                    <tbody>
                    {table.getRowModel().rows.length > 0 ? (
                        table.getRowModel().rows.map(row => (
                        <tr key={row.id}>
                            {row.getVisibleCells().map(cell => (
                            <td key={cell.id} style={{ width: cell.column.getSize() }}>
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                            ))}
                        </tr>
                        ))
                    ) : (
                        <tr>
                        <td colSpan={columns.length} className="empty">
                            {t('emptyOptimized')}
                        </td>
                        </tr>
                    )}
                    </tbody>
                </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between p-[18px] bg-surface border-t border-line sm:px-6">
                <div className="flex items-center gap-2">
                    <span className="text-[13px] text-ink-soft font-bold">
                        {t('paginationPage')} <span className="text-ink">{table.getState().pagination.pageIndex + 1}</span> {t('paginationOf')}{' '}
                        <span className="text-ink">{table.getPageCount() || 1}</span>
                    </span>
                    <select
                        value={table.getState().pagination.pageSize}
                        onChange={e => {
                            table.setPageSize(Number(e.target.value));
                        }}
                        className="ml-4 bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2 outline-none placeholder-ink-soft"
                    >
                        {[10, 15, 20, 25, 50, 100].map(pageSize => (
                            <option key={pageSize} value={pageSize}>
                                {t('showOption', { size: pageSize })}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                        className="bg-surface-2 border border-line text-ink px-[11px] py-[7px] rounded-[10px] font-heading font-semibold text-[12px] hover:border-brand-bright disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                    >
                        {t('previous')}
                    </button>
                    <button
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                        className="bg-surface-2 border border-line text-ink px-[11px] py-[7px] rounded-[10px] font-heading font-semibold text-[12px] hover:border-brand-bright disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                    >
                        {t('next')}
                    </button>
                </div>
            </div>
        </div>
      )}

      {taggingItems.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-[450px] animate-in zoom-in-95">
                <h3 className="text-xl font-bold text-gray-900 mb-2">{t('tagModalTitle')}</h3>
                <p className="text-sm text-gray-500 mb-4">
                    {taggingItems.length === 1
                        ? t.rich('tagModalDescSingle', {
                            name: taggingItems[0].resourceName,
                            res: (chunks) => <span className="font-mono font-semibold text-gray-700">{chunks}</span>,
                        })
                        : t.rich('tagModalDescMultiple', {
                            count: taggingItems.length,
                            res: (chunks) => <span className="font-semibold text-gray-700">{chunks}</span>,
                        })}{' '}
                    {t.rich('tagModalPolicyNote', { b: (chunks) => <b>{chunks}</b> })}
                </p>
                <div className="space-y-4 mb-6">
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">CostCenter</label>
                        <input 
                            type="text" 
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#0054A6] focus:ring-1 focus:ring-[#0054A6]" 
                            placeholder={t('costCenterPlaceholder')}
                            value={tagValues.CostCenter}
                            onChange={e => setTagValues({...tagValues, CostCenter: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Environment</label>
                        <select 
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#0054A6] focus:ring-1 focus:ring-[#0054A6]"
                            value={tagValues.Environment}
                            onChange={e => setTagValues({...tagValues, Environment: e.target.value})}
                        >
                            <option value="">{t('environmentSelectPlaceholder')}</option>
                            <option value="Production">Production</option>
                            <option value="Staging">Staging</option>
                            <option value="Development">Development</option>
                            <option value="Testing">Testing</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Owner</label>
                        <input 
                            type="text" 
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#0054A6] focus:ring-1 focus:ring-[#0054A6]" 
                            placeholder={t('ownerPlaceholder')}
                            value={tagValues.Owner}
                            onChange={e => setTagValues({...tagValues, Owner: e.target.value})}
                        />
                    </div>
                </div>
                <div className="flex justify-end gap-3">
                    <button
                        onClick={() => setTaggingItems([])}
                        className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                    >
                        {t('cancel')}
                    </button>
                    <button 
                        onClick={handleTagSubmit} 
                        disabled={isTagging || !tagValues.CostCenter || !tagValues.Environment || !tagValues.Owner}
                        className="px-4 py-2 text-sm font-semibold text-white bg-[#0054A6] hover:bg-[#00AEEF] rounded-md transition-colors disabled:opacity-50 flex items-center"
                    >
                        {isTagging ? t('applying') : t('applyTags')}
                    </button>
                </div>
            </div>
        </div>
      )}

      {exemptionModalResource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-100 dark:border-slate-800">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-lg">
                  <EyeOff className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">Eximir Recurso</h3>
                  <p className="text-sm text-gray-500 dark:text-slate-400">Marcar recurso como ignorado</p>
                </div>
              </div>
              <button 
                onClick={() => setExemptionModalResource(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl flex gap-3 border border-blue-100 dark:border-blue-800/30">
                <AlertTriangle className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div className="text-sm text-blue-800 dark:text-blue-300">
                  Estás a punto de eximir el recurso <span className="font-mono font-bold">{exemptionModalResource.resourceName}</span>. Este recurso dejará de sumar a los reportes de ahorro potencial y será ignorado en futuras auditorías.
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                    Motivo principal <span className="text-red-500">*</span>
                  </label>
                  <select 
                    value={reasonInput} 
                    onChange={e => setReasonInput(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:text-white"
                  >
                    <option value="VM requerida para backups periódicos de MySQL">Backup Periódico</option>
                    <option value="Entorno de Disaster Recovery (DR)">Disaster Recovery (DR)</option>
                    <option value="Recurso temporal mantenido por auditoría/compliance">Auditoría / Compliance</option>
                    <option value="Recurso Legacy (Proceso de migración)">Recurso Legacy (Migrando)</option>
                    <option value="Eximida por decisión del usuario">Otro Motivo</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-gray-400" />
                    Justificación adicional
                  </label>
                  <textarea 
                    value={commentInput}
                    onChange={e => setCommentInput(e.target.value)}
                    placeholder="Detalla por qué este recurso debe mantenerse activo o ignorarse en los reportes..."
                    rows={3}
                    className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none dark:text-white placeholder:text-gray-400"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 p-5 bg-gray-50 dark:bg-slate-800/30 border-t border-gray-100 dark:border-slate-800">
              <button
                onClick={() => setExemptionModalResource(null)}
                className="px-5 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg transition-all"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveExemption} 
                disabled={savingExemption || !reasonInput}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
              >
                {savingExemption ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Guardando...
                  </>
                ) : (
                  <>
                    <EyeOff className="w-4 h-4" />
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
