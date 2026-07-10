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
import { canDeleteResources } from '@/lib/tierLogic';
import EnterpriseDeleteDisclaimer from '@/components/EnterpriseDeleteDisclaimer';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  ColumnDef,
  SortingState
} from '@tanstack/react-table';

export default function ZombieResourcesTable({ forceFilterType }: { forceFilterType?: string }) {
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  const { viewMode } = useViewMode();
  const { addAction } = useActionLogStore();
  const triggerCopilotWithPrompt = useAIContext(state => state.triggerCopilotWithPrompt);
  const { selectedSubscription, setSelectedSubscription } = useSubscription();
  
  // Removed conditional useTranslations hook which was causing React Error 310
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
                  resourceType: item.armType
              })
          });
          const json = await res.json();
          if (!res.ok) return { ok: false, error: json.error || "Fallo al eliminar" };
          return { ok: true };
      } catch (err: any) {
          return { ok: false, error: err.message };
      }
  };

  const handleDelete = async (item: any) => {
      if (item.manualDelete) {
          toast.error('Requisito Manual', { description: `La eliminación de [${item.type}] debe hacerse en el portal.` });
          return;
      }

      if (!window.confirm(`¿Estás completamente seguro de ELIMINAR el recurso ${item.resourceName} permanentemente? Esto impactará los costos en Azure al instante.`)) return;

      setDeletingId(item.id);
      const result = await deleteResourceItem(item);
      if (result.ok) {
          setData(prev => prev.filter(r => r.id !== item.id));
          toast.success('Recurso Eliminado', { description: `${item.resourceName} fue destruido.` });
          addAction({ message: `Se eliminó el recurso zombi: ${item.resourceName} exitosamente.`, status: 'success' });
      } else if (result.error === "MISSING_CONTRIBUTOR_ROLE") {
          toast.error('¡Operación Denegada!', { description: 'La eliminación de recursos requiere el plan Enterprise (tu Service Principal no tiene el rol de Azure necesario).' });
          addAction({ message: `Fallo de permisos al borrar ${item.resourceName}. Requiere plan Enterprise.`, status: 'error' });
      } else {
          toast.error('Error al borrar', { description: result.error });
          addAction({ message: `Error al borrar ${item.resourceName}: ${result.error}`, status: 'error' });
      }
      setDeletingId(null);
  };

  const handleBulkDelete = async () => {
      const items = filteredData.filter(i => selectedIds.has(i.id) && !i.manualDelete);
      if (items.length === 0) return;
      if (!window.confirm(`¿Estás completamente seguro de ELIMINAR permanentemente ${items.length} recursos seleccionados? Esto impactará los costos en Azure al instante y no se puede deshacer.`)) return;

      setBulkDeleting(true);
      let ok = 0, missingRole = 0, failed = 0;
      for (const item of items) {
          setDeletingId(item.id);
          const result = await deleteResourceItem(item);
          if (result.ok) {
              ok++;
              setData(prev => prev.filter(r => r.id !== item.id));
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
          toast.success(`${ok} recurso(s) eliminados`, { description: 'Eliminación en bulk completada.' });
          addAction({ message: `Eliminación en bulk: ${ok} recurso(s) destruidos exitosamente.`, status: 'success' });
      }
      if (missingRole > 0) {
          toast.error('¡Operación Denegada!', { description: `${missingRole} recurso(s) requieren el plan Enterprise para poder eliminarse.` });
      }
      if (failed > 0) {
          toast.error('Error al eliminar', { description: `${failed} recurso(s) fallaron.` });
      }
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
              if (!res.ok) throw new Error(json.details || json.error || "Fallo al aplicar etiquetas");

              ok++;
              setData(prev => prev.filter(r => r.id !== item.id));
              addAction({ message: `Etiquetas FinOps aplicadas a ${item.resourceName}`, status: 'success' });
          } catch (err: any) {
              console.error("Error tagging:", err);
              failed++;
              addAction({ message: `Error etiquetando ${item.resourceName}: ${err.message}`, status: 'error' });
          }
      }

      setIsTagging(false);
      setTaggingItems([]);
      setSelectedIds(new Set());

      if (ok > 0) toast.success(ok === 1 ? "Etiquetas aplicadas exitosamente." : `Etiquetas aplicadas a ${ok} recursos.`);
      if (failed > 0) toast.error(`${failed} recurso(s) fallaron al etiquetar.`);
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
                setError(json.error === 'MISSING_RBAC_ROLE' ? 'MISSING_RBAC_ROLE' : (json.error || "Error de servidor al consultar recursos."));
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
                subscriptionId: r.subscriptionId || selectedSub,
                potentialSavings: r.estimatedMonthlyCost || (r.diskSizeGB ? r.diskSizeGB * 0.15 : (r.sizeGB ? r.sizeGB * 0.05 : config.savings)),
                issueType: config.issueType,
                manualDelete: config.manualDelete,
                isHygiene: r.isHygiene || config.isHygiene || false,
                isLocked: r.isLocked || false
            }));
            allMappedData = [...allMappedData, ...mapped];
        }

        if (forceFilterType) {
            allMappedData = allMappedData.filter(d => d.type === forceFilterType);
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
            setError("Fallo de red o credenciales denegadas.");
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
        
        return matchName && matchType && matchGroup && matchIssue;
    });
  }, [data, filterType, filterGroup, filterIssue, searchQuery]);

  const hasLockedItems = useMemo(() => filteredData.some(item => item.isLocked), [filteredData]);
  const canDelete = canDeleteResources(selectedTenant.tier);

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
                className="cursor-pointer"
            />
        ),
        size: 36,
      },
      {
        accessorKey: 'resourceName',
        header: 'Recurso',
        cell: ({ row }) => {
            const item = row.original;
            return <span className={`font-semibold text-gray-800 dark:text-gray-200 ${item.isLocked ? 'filter blur-sm select-none' : ''}`}>{item.resourceName}</span>;
        },
      }
    ];

    if (viewMode === 'engineer') {
      cols.push({
        id: 'armDetails',
        header: 'Resource ID / ARM Type',
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
        header: 'Suscripción',
        cell: info => {
            const val = info.getValue() as string;
            return <span className="text-xs font-mono text-gray-500">{val === 'all' ? 'N/A' : val.substring(0,8) + '...'}</span>;
        }
      });
    }

    cols.push({
      accessorKey: 'type',
      header: 'Tipo',
      cell: info => <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-1 rounded text-xs">{info.getValue() as string}</span>
    });

    cols.push({
      accessorKey: 'resourceGroup',
      header: 'Grupo',
      cell: ({ row }) => {
          const item = row.original;
          return <span className={`text-xs text-gray-600 dark:text-gray-400 font-medium ${item.isLocked ? 'filter blur-sm select-none' : ''}`}>{item.resourceGroup || 'N/A'}</span>;
      }
    });

    cols.push({
      accessorKey: 'issue',
      header: 'Problema',
      cell: ({ row }) => {
          const item = row.original;
          return (
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${item.issueType === 'governance' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-100'}`}>
                {item.issue}
            </span>
          );
      }
    });

    cols.push({
      accessorKey: 'potentialSavings',
      header: 'Ahorro Est.',
      cell: ({ row }) => {
          const item = row.original;
          const val = item.potentialSavings as number;
          if (item.isHygiene) {
              return (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200">
                      Higiene
                  </span>
              );
          }
          return <span className={`font-bold ${val > 0 ? "text-green-600" : "text-gray-400"}`}>{val > 0 ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val) : "-"}</span>;
      }
    });

    cols.push({
      id: 'actions',
      header: 'Acciones',
      cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="text-right flex items-center justify-end gap-2">
                {item.issueType === 'governance' && item.issue === "Sin Etiquetas FinOps" && (
                    <>
                        <button
                            onClick={() => {
                                setTaggingItems([item]);
                                setTagValues({ CostCenter: '', Environment: '', Owner: '' });
                            }}
                            className="px-3 py-1 rounded-md text-xs font-semibold shadow-sm transition-colors bg-[#0054A6] text-white hover:bg-[#00AEEF]"
                        >
                            Fijar Etiquetas
                        </button>
                        <button 
                            onClick={() => triggerCopilotWithPrompt(`Por favor, analiza el recurso "${item.resourceName}" (Tipo: ${item.type}) en el grupo "${item.resourceGroup}" y sugiéreme la mejor estructura de etiquetas (tags) FinOps para aplicarle basándote en las mejores prácticas de Azure.`)}
                            className="px-3 py-1 rounded-md text-xs font-semibold shadow-sm transition-colors bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
                        >
                            Sugerir
                        </button>
                    </>
                )}
                {canDelete ? (
                    <button
                        onClick={() => handleDelete(item)}
                        disabled={deletingId === item.id || (item.issueType === 'governance' && item.issue === "Sin Etiquetas FinOps")}
                        className={`px-3 py-1 rounded-md text-xs font-semibold shadow-sm transition-colors ${deletingId === item.id ? 'bg-gray-100 text-gray-400 cursor-wait' : (item.issueType === 'governance' && item.issue === "Sin Etiquetas FinOps") ? 'bg-gray-50 text-gray-300 cursor-not-allowed' : 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'}`}
                    >
                        {deletingId === item.id ? 'Borrando...' : 'Borrar'}
                    </button>
                ) : (
                    <span className="px-3 py-1 rounded-md text-xs font-semibold bg-gray-50 text-gray-400 border border-gray-200" title="La eliminación de recursos requiere el plan Enterprise">
                        Enterprise
                    </span>
                )}
            </div>
          );
      }
    });

    return cols;
  }, [viewMode, deletingId, canDelete, selectedIds]);

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
            <h2 className="text-lg font-semibold text-gray-800 mb-2">Acceso Restringido</h2>
            <p className="text-sm text-gray-500">Inicia sesión con Microsoft Entra ID para visualizar tus recursos zombi.</p>
        </div>
    );
  }

  return (
    <div className="card">
      {!canDelete && <div className="mb-4"><EnterpriseDeleteDisclaimer /></div>}
      <div className="card-h flex-col sm:flex-row items-start sm:items-center gap-4 border-b border-line pb-4 mb-4">
        <div>
            <h3 className="text-brand-deep dark:text-white m-0">
                {selectedSub === "all" ? "Auditoría FinOps (Global)" : "Auditoría FinOps (Filtrada)"}
            </h3>
            {error && error !== 'MISSING_RBAC_ROLE' && <span className="mt-2 inline-block text-xs text-amber bg-amber-soft px-2 py-1 rounded border border-amber/20">{error}</span>}
        </div>
        
        <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
            <div className="flex items-center space-x-2">
                <label className="text-[11px] font-bold text-grey dark:text-gray-300 uppercase tracking-[0.5px]">Suscripción:</label>
                <select 
                    value={selectedSub}
                    onChange={(e) => {
                        const val = e.target.value;
                        setSelectedSub(val);
                        setSelectedSubscription(val === 'all' ? 'All' : val);
                    }}
                    className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none w-32 placeholder-ink-soft"
                >
                    <option value="all">Todas</option>
                    {subscriptions.map((sub: any) => (
                        <option key={sub.id} value={sub.id}>{(sub.name || sub.id).substring(0,20)}...</option>
                    ))}
                </select>
            </div>
            <div className="flex items-center space-x-2">
                <label className="text-[11px] font-bold text-grey dark:text-gray-300 uppercase tracking-[0.5px]">Nombre:</label>
                <input 
                    type="text" 
                    placeholder="Filtrar por nombre..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2 outline-none w-32 focus:border-brand-bright focus:ring-1 focus:ring-brand-bright placeholder-ink-soft"
                />
            </div>
            <div className="flex items-center space-x-2">
                <label className="text-[11px] font-bold text-grey dark:text-gray-300 uppercase tracking-[0.5px]">Tipo:</label>
                <input 
                    type="text"
                    list="type-list"
                    placeholder="Todos..."
                    value={filterType === 'all' ? '' : filterType}
                    onChange={e => setFilterType(e.target.value)}
                    className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2 outline-none w-32 focus:border-brand-bright focus:ring-1 focus:ring-brand-bright placeholder-ink-soft"
                />
                <datalist id="type-list">
                    {Array.from(new Set(data.map(d => d.type))).filter(Boolean).sort().map((t: any) => <option key={t} value={t} />)}
                </datalist>
            </div>
            <div className="flex items-center space-x-2">
                <label className="text-[11px] font-bold text-grey dark:text-gray-300 uppercase tracking-[0.5px]">Grupo:</label>
                <input 
                    type="text"
                    list="group-list"
                    placeholder="Todos..."
                    value={filterGroup === 'all' ? '' : filterGroup}
                    onChange={e => setFilterGroup(e.target.value)}
                    className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2 outline-none w-32 focus:border-brand-bright focus:ring-1 focus:ring-brand-bright placeholder-ink-soft"
                />
                <datalist id="group-list">
                    {Array.from(new Set(data.map(d => d.resourceGroup))).filter(Boolean).sort().map((g: any) => <option key={g} value={g} />)}
                </datalist>
            </div>
            <div className="flex items-center space-x-2">
                <label className="text-[11px] font-bold text-grey dark:text-gray-300 uppercase tracking-[0.5px]">Severidad:</label>
                <select value={filterIssue} onChange={e => setFilterIssue(e.target.value)} className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2 outline-none w-32 focus:border-brand-bright focus:ring-1 focus:ring-brand-bright placeholder-ink-soft">
                    <option value="all">Todas</option>
                    <option value="cost">Costo</option>
                    <option value="governance">Gobernanza</option>
                </select>
            </div>
        </div>
      </div>

      {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800/50">
              <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">{selectedIds.size} seleccionado(s)</span>
              <button
                  onClick={() => {
                      setTaggingItems(filteredData.filter(i => selectedIds.has(i.id)));
                      setTagValues({ CostCenter: '', Environment: '', Owner: '' });
                  }}
                  className="px-3 py-1.5 rounded-md text-xs font-semibold bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
              >
                  Etiquetar seleccionados
              </button>
              {canDelete ? (
                  <button
                      onClick={handleBulkDelete}
                      disabled={bulkDeleting}
                      className="px-3 py-1.5 rounded-md text-xs font-semibold bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 hover:bg-red-100 dark:hover:bg-red-950/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                      {bulkDeleting ? 'Eliminando...' : 'Eliminar seleccionados'}
                  </button>
              ) : (
                  <span className="px-3 py-1.5 rounded-md text-xs font-semibold bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-500 border border-gray-200 dark:border-slate-700" title="La eliminación de recursos requiere el plan Enterprise">
                      Eliminar — requiere Enterprise
                  </span>
              )}
              <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-xs text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 font-semibold">
                  Limpiar selección
              </button>
          </div>
      )}

      {error === 'MISSING_RBAC_ROLE' ? <RoleAssignmentBanner /> : loading ? (
          <div className="empty animate-pulse">Escaneando Azure Resource Graph...</div>
      ) : (
        <div className="flex flex-col">
            <div className="overflow-x-auto w-full relative">
                {hasLockedItems && (
                    <div className="absolute inset-x-0 bottom-0 top-12 z-10 flex flex-col items-center justify-center bg-white/40 backdrop-blur-[1px]">
                        <a href="/upgrade" className="px-6 py-3 bg-brand-deep text-white font-bold rounded-lg shadow-lg hover:bg-brand-bright transition-all hover:scale-105 inline-flex items-center gap-2">
                            Upgrade to Professional to unlock exact resource names and start saving
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
                            El entorno está 100% optimizado y bajo políticas de Gobernanza. ¡Excelente trabajo!
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
                        Página <span className="text-ink">{table.getState().pagination.pageIndex + 1}</span> de{' '}
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
                                Mostrar {pageSize}
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
                        Anterior
                    </button>
                    <button
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                        className="bg-surface-2 border border-line text-ink px-[11px] py-[7px] rounded-[10px] font-heading font-semibold text-[12px] hover:border-brand-bright disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                    >
                        Siguiente
                    </button>
                </div>
            </div>
        </div>
      )}

      {taggingItems.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-[450px] animate-in zoom-in-95">
                <h3 className="text-xl font-bold text-gray-900 mb-2">Fijar Etiquetas FinOps</h3>
                <p className="text-sm text-gray-500 mb-4">
                    {taggingItems.length === 1 ? (
                        <>Estás a punto de etiquetar el recurso <span className="font-mono font-semibold text-gray-700">{taggingItems[0].resourceName}</span>.</>
                    ) : (
                        <>Estás a punto de etiquetar <span className="font-semibold text-gray-700">{taggingItems.length} recursos</span> seleccionados con las mismas etiquetas.</>
                    )}{' '}
                    Las políticas FinOps de la organización requieren 3 etiquetas fundamentales: <b>CostCenter</b> (quién paga), <b>Environment</b> (producción/dev) y <b>Owner</b> (responsable técnico).
                </p>
                <div className="space-y-4 mb-6">
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">CostCenter</label>
                        <input 
                            type="text" 
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#0054A6] focus:ring-1 focus:ring-[#0054A6]" 
                            placeholder="Ej: Marketing, IT, HR..." 
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
                            <option value="">Selecciona un entorno...</option>
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
                            placeholder="Ej: juan.perez@empresa.com" 
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
                        Cancelar
                    </button>
                    <button 
                        onClick={handleTagSubmit} 
                        disabled={isTagging || !tagValues.CostCenter || !tagValues.Environment || !tagValues.Owner}
                        className="px-4 py-2 text-sm font-semibold text-white bg-[#0054A6] hover:bg-[#00AEEF] rounded-md transition-colors disabled:opacity-50 flex items-center"
                    >
                        {isTagging ? 'Aplicando...' : 'Aplicar Etiquetas'}
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}
