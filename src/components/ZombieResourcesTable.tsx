"use client";
import React, { useEffect, useState, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from './TenantProvider';
import { useViewMode } from '../context/ViewModeContext';
import RoleAssignmentBanner from './RoleAssignmentBanner';
import { toast } from 'sonner';
import { useActionLogStore } from '@/store/actionLogStore';
import { useTranslations } from 'next-intl';
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
  
  // Removed conditional useTranslations hook which was causing React Error 310
  const [data, setData] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [selectedSub, setSelectedSub] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterGroup, setFilterGroup] = useState<string>('all');
  const [filterIssue, setFilterIssue] = useState<string>('all');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (item: any) => {
      if (item.manualDelete) {
          toast.error('Requisito Manual', { description: `La eliminación de [${item.type}] debe hacerse en el portal.` }); 
          return;
      }

      if (!window.confirm(`¿Estás completamente seguro de ELIMINAR el recurso ${item.resourceName} permanentemente? Esto impactará los costos en Azure al instante.`)) return;
      
      try {
          setDeletingId(item.id);
          const account = accounts[0];
          const tokenResponse = await instance.acquireTokenSilent({
              scopes: ["User.Read"],
              account: account
          });
          
          const res = await fetch('/api/remediation', {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${tokenResponse.idToken}`,
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
          if (!res.ok) {
              if (json.error === "MISSING_CONTRIBUTOR_ROLE") {
                  throw new Error(`MISSING_CONTRIBUTOR_ROLE|${json.clientId}`);
              }
              throw new Error(json.error || "Fallo al eliminar");
          }
          
          setData(prev => prev.filter(r => r.id !== item.id));
          toast.success('Recurso Eliminado', { description: `${item.resourceName} fue destruido.` });
          addAction({ message: `Se eliminó el recurso zombi: ${item.resourceName} exitosamente.`, status: 'success' });
      } catch (err: any) {
          console.error("Error de eliminación:", err);
          if (err.message && err.message.startsWith("MISSING_CONTRIBUTOR_ROLE")) {
              const clientId = err.message.split("|")[1];
              toast.error('¡Operación Denegada!', { description: 'Tu aplicación FinOps solo tiene rol de Lector.' });
              addAction({ message: `Fallo de permisos al borrar ${item.resourceName}. Se requiere Rol Contributor.`, status: 'error' }); 
          } else {
              toast.error('Error al borrar', { description: err.message });
              addAction({ message: `Error al borrar ${item.resourceName}: ${err.message}`, status: 'error' });
          }
      } finally {
          setDeletingId(null);
      }
  };

  useEffect(() => {
    if (accounts.length === 0 || selectedTenant.id === 'default') {
      setLoading(false);
      return;
    }

    const fetchResourcesAndSubs = async () => {
      try {
        setLoading(true);
        const account = accounts[0];
        const tenantId = selectedTenant.id;
        
        const tokenResponse = await instance.acquireTokenSilent({
            scopes: ["User.Read"],
            account: account
        });
        const headers = { 'Authorization': `Bearer ${tokenResponse.idToken}` };

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

        const res = await fetch(apiUrl, { headers });
        const json = await res.json();
        
        if (!res.ok || json.error) {
            setError(json.error === 'MISSING_RBAC_ROLE' ? 'MISSING_RBAC_ROLE' : (json.error || "Error de servidor al consultar recursos."));
            setLoading(false);
            return;
        }

        const audit = json.auditResults || {};
        
        const resourceConfig: any = {
            unattachedDisks: { type: "Disk", armType: "microsoft.compute/disks", issue: "Disco sin asociar", savings: 15.0, issueType: "cost", manualDelete: false },
            unusedIps: { type: "Public IP", armType: "microsoft.network/publicipaddresses", issue: "IP Pública sin asignar", savings: 3.5, issueType: "cost", manualDelete: false },
            staleSnapshots: { type: "Snapshot", armType: "microsoft.compute/snapshots", issue: "Snapshot Antiguo (>90d)", savings: 5.0, issueType: "cost", manualDelete: false },
            taggingNonCompliance: { type: "Resource", armType: "unknown", issue: "Sin Etiquetas FinOps", savings: 0.0, issueType: "governance", manualDelete: true },
            orphanedNics: { type: "NIC", armType: "microsoft.network/networkinterfaces", issue: "NIC Huérfano", savings: 0.0, issueType: "cost", manualDelete: false },
            orphanedNsgs: { type: "NSG", armType: "microsoft.network/networksecuritygroups", issue: "NSG sin asociar", savings: 0.0, issueType: "governance", manualDelete: false },
            emptyAppServicePlans: { type: "App Service Plan", armType: "microsoft.web/serverfarms", issue: "Plan ASP vacío", savings: 45.0, issueType: "cost", manualDelete: false },
            availabilitySets: { type: "Availability Set", armType: "microsoft.compute/availabilitysets", issue: "Set vacío", savings: 0.0, issueType: "governance", manualDelete: true },
            elasticPools: { type: "SQL Elastic Pool", armType: "microsoft.sql/servers/elasticpools", issue: "Pool Vacío", savings: 250.0, issueType: "cost", manualDelete: true },
            routeTables: { type: "Route Table", armType: "microsoft.network/routetables", issue: "No asignada", savings: 0.0, issueType: "governance", manualDelete: true },
            loadBalancers: { type: "Load Balancer", armType: "microsoft.network/loadbalancers", issue: "Sin Backend", savings: 18.0, issueType: "cost", manualDelete: true },
            frontDoorWaf: { type: "Front Door WAF", armType: "microsoft.network/frontdoorwebapplicationfirewallpolicies", issue: "Sin Política", savings: 5.0, issueType: "cost", manualDelete: true },
            trafficManager: { type: "Traffic Manager", armType: "microsoft.network/trafficmanagerprofiles", issue: "Sin Endpoints", savings: 3.0, issueType: "cost", manualDelete: true },
            appGateways: { type: "App Gateway", armType: "microsoft.network/applicationgateways", issue: "Sin Backend IPs", savings: 180.0, issueType: "cost", manualDelete: true },
            emptyVnets: { type: "VNET", armType: "microsoft.network/virtualnetworks", issue: "Red Vacía", savings: 0.0, issueType: "governance", manualDelete: true },
            emptySubnets: { type: "Subnet", armType: "microsoft.network/virtualnetworks/subnets", issue: "Subred Vacía", savings: 0.0, issueType: "governance", manualDelete: true },
            natGateways: { type: "NAT Gateway", armType: "microsoft.network/natgateways", issue: "Sin Subred", savings: 32.0, issueType: "cost", manualDelete: true },
            ipGroups: { type: "IP Group", armType: "microsoft.network/ipgroups", issue: "Sin Firewall", savings: 0.0, issueType: "governance", manualDelete: true },
            privateDnsZones: { type: "Private DNS", armType: "microsoft.network/privatednszones", issue: "Sin Enlaces", savings: 0.5, issueType: "governance", manualDelete: true },
            privateEndpoints: { type: "Private Endpoint", armType: "microsoft.network/privateendpoints", issue: "Desconectado", savings: 7.0, issueType: "cost", manualDelete: true },
            vnetGateways: { type: "VNet Gateway", armType: "microsoft.network/virtualnetworkgateways", issue: "Sin Conexiones", savings: 130.0, issueType: "cost", manualDelete: true },
            ddos: { type: "DDoS Plan", armType: "microsoft.network/ddosprotectionplans", issue: "Sin Recursos", savings: 2944.0, issueType: "cost", manualDelete: true },
            emptyRgs: { type: "Resource Group", armType: "microsoft.resources/subscriptions/resourcegroups", issue: "RG Vacío", savings: 0.0, issueType: "governance", manualDelete: true },
            apiConnections: { type: "API Connection", armType: "microsoft.web/connections", issue: "Desconectada", savings: 0.0, issueType: "governance", manualDelete: true },
            expiredCerts: { type: "Certificate", armType: "microsoft.web/certificates", issue: "Expirado", savings: 0.0, issueType: "governance", manualDelete: true }
        };

        let allMappedData: any[] = [];
        for (const [key, configValue] of Object.entries(resourceConfig)) {
            const config = configValue as any;
            const items = audit[key] || [];
            const mapped = items.map((r: any) => ({
                id: r.id,
                resourceName: r.name,
                type: r.type ? (r.type.split("/").pop() || config.type) : config.type,
                armType: r.type || config.armType,
                resourceGroup: r.resourceGroup,
                issue: config.issue,
                subscriptionId: r.subscriptionId || selectedSub,
                potentialSavings: r.estimatedMonthlyCost || (r.diskSizeGB ? r.diskSizeGB * 0.15 : (r.sizeGB ? r.sizeGB * 0.05 : config.savings)),
                issueType: config.issueType,
                manualDelete: config.manualDelete
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
        setError("Fallo de red o credenciales denegadas.");
        setLoading(false);
      }
    };

    fetchResourcesAndSubs();
  }, [accounts, instance, selectedSub, selectedTenant, forceFilterType]);

  const filteredData = useMemo(() => {
    return data.filter(item => {
        const matchType = filterType === "all" || item.type === filterType;
        const matchGroup = filterGroup === "all" || item.resourceGroup === filterGroup;
        const matchIssue = filterIssue === "all" || item.issueType === filterIssue;
        return matchType && matchGroup && matchIssue;
    });
  }, [data, filterType, filterGroup, filterIssue]);

  const columns = useMemo<ColumnDef<any>[]>(() => {
    const cols: ColumnDef<any>[] = [
      {
        accessorKey: 'resourceName',
        header: 'Recurso',
        cell: info => <span className="font-semibold text-gray-800">{info.getValue() as string}</span>,
      }
    ];

    if (viewMode === 'engineer') {
      cols.push({
        id: 'armDetails',
        header: 'Resource ID / ARM Type',
        cell: ({ row }) => {
            const item = row.original;
            return (
                <div className="text-xs font-mono max-w-[150px] truncate" title={item.id}>
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
      cell: info => <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs">{info.getValue() as string}</span>
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
      cell: info => {
          const val = info.getValue() as number;
          return <span className={`font-bold ${val > 0 ? "text-green-600" : "text-gray-400"}`}>{val > 0 ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val) : "-"}</span>;
      }
    });

    cols.push({
      id: 'actions',
      header: 'Acciones',
      cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="text-right">
                <button 
                    onClick={() => handleDelete(item)}
                    disabled={deletingId === item.id || item.issueType === 'governance'}
                    className={`px-3 py-1 rounded-md text-xs font-semibold shadow-sm transition-colors ${deletingId === item.id ? 'bg-gray-100 text-gray-400 cursor-wait' : item.issueType === 'governance' ? 'bg-gray-50 text-gray-300 cursor-not-allowed' : 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'}`}
                >
                    {deletingId === item.id ? 'Borrando...' : 'Borrar'}
                </button>
            </div>
          );
      }
    });

    return cols;
  }, [viewMode, deletingId]);

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

  if (accounts.length === 0 || selectedTenant.id === 'default') {
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
      <div className="card-h flex-col sm:flex-row items-start sm:items-center gap-4 border-b border-line pb-4 mb-4">
        <div>
            <h3 className="text-brand-deep m-0">
                {selectedSub === "all" ? "Auditoría FinOps (Global)" : "Auditoría FinOps (Filtrada)"}
            </h3>
            {error && error !== 'MISSING_RBAC_ROLE' && <span className="mt-2 inline-block text-xs text-amber bg-amber-soft px-2 py-1 rounded border border-amber/20">{error}</span>}
        </div>
        
        <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
            <div className="flex items-center space-x-2">
                <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px]">Suscripción:</label>
                <select 
                    value={selectedSub}
                    onChange={(e) => setSelectedSub(e.target.value)}
                    className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none w-32"
                >
                    <option value="all">Todas</option>
                    {subscriptions.map((sub: any) => (
                        <option key={sub.id} value={sub.id}>{(sub.displayName || sub.id).substring(0,15)}...</option>
                    ))}
                </select>
            </div>
            <div className="flex items-center space-x-2">
                <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px]">Tipo:</label>
                <select value={filterType} onChange={e => setFilterType(e.target.value)} className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2 outline-none w-32">
                    <option value="all">Todos</option>
                    {Array.from(new Set(data.map(d => d.type))).filter(Boolean).sort().map((t: any) => <option key={t} value={t}>{t}</option>)}
                </select>
            </div>
            <div className="flex items-center space-x-2">
                <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px]">Grupo:</label>
                <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)} className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2 outline-none w-32">
                    <option value="all">Todos</option>
                    {Array.from(new Set(data.map(d => d.resourceGroup))).filter(Boolean).sort().map((g: any) => <option key={g} value={g}>{g}</option>)}
                </select>
            </div>
            <div className="flex items-center space-x-2">
                <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px]">Severidad:</label>
                <select value={filterIssue} onChange={e => setFilterIssue(e.target.value)} className="bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2 outline-none w-32">
                    <option value="all">Todas</option>
                    <option value="cost">Costo</option>
                    <option value="governance">Gobernanza</option>
                </select>
            </div>
        </div>
      </div>
      
      {error === 'MISSING_RBAC_ROLE' ? <RoleAssignmentBanner /> : loading ? (
          <div className="empty animate-pulse">Escaneando Azure Resource Graph...</div>
      ) : (
        <div className="flex flex-col">
            <div className="overflow-x-auto w-full">
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
                        className="ml-4 bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2 outline-none"
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
    </div>
  );
}
