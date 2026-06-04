"use client";
import React, { useEffect, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from './TenantProvider';
import RoleAssignmentBanner from './RoleAssignmentBanner';

export default function ZombieResourcesTable({ forceFilterType }: { forceFilterType?: string }) {
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  const [data, setData] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [selectedSub, setSelectedSub] = useState<string>("all");
    const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (item: any) => {
      if (item.manualDelete) {
          alert(`La eliminación automática de [${item.type}] requiere precaución extra y no está enlazada al SDK en esta versión.\n\nPor favor, bórralo manualmente en el portal de Azure.`);
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
          
          // Remover de la tabla local
          setData(prev => prev.filter(r => r.id !== item.id));
      } catch (err: any) {
          console.error("Error de eliminación:", err);
          if (err.message && err.message.startsWith("MISSING_CONTRIBUTOR_ROLE")) {
              const clientId = err.message.split("|")[1];
              alert(`¡Operación Denegada por Azure!\n\nTu aplicación FinOps solo tiene rol de 'Lector'. Para borrar recursos, debes asignar el rol de 'Colaborador' ejecutando:\n\naz role assignment create --assignee "${clientId}" --role "Contributor" --scope "/subscriptions/${item.subscriptionId}"`);
          } else {
              alert(`Error al borrar: ${err.message || 'Sin permisos suficientes.'}`);
          }
      } finally {
          setDeletingId(null);
      }
  };
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (accounts.length === 0 || selectedTenant.id === 'default') {
      setLoading(false);
      return;
    }

    const fetchResourcesAndSubs = async () => {
      try {
        setLoading(true);
        const account = accounts[0];
        const tenantId = account.tenantId;
        
        const tokenResponse = await instance.acquireTokenSilent({
            scopes: ["User.Read"],
            account: account
        });
        const headers = { 'Authorization': `Bearer ${tokenResponse.idToken}` };

        // 1. Fetch Subscriptions if not loaded yet
        if (subscriptions.length === 0) {
            const subRes = await fetch(`/api/subscriptions?tenantId=${tenantId}`, { headers });
            if (subRes.ok) {
                const subJson = await subRes.json();
                setSubscriptions(subJson.subscriptions || []);
            }
        }

        // 2. Fetch Zombie Resources (Filtered or Global)
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
        for (const [key, config] of Object.entries(resourceConfig)) {
            const items = audit[key] || [];
            const mapped = items.map((r: any) => ({
                id: r.id,
                resourceName: r.name,
                type: r.type ? (r.type.split("/").pop() || config.type) : config.type,
                armType: r.type || config.armType,
                resourceGroup: r.resourceGroup,
                issue: config.issue,
                subscriptionId: r.subscriptionId || selectedSub,
                potentialSavings: r.diskSizeGB ? r.diskSizeGB * 0.15 : (r.sizeGB ? r.sizeGB * 0.05 : config.savings),
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
    <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-gray-200">
      <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-50 gap-4">
        <div>
            <h2 className="text-lg font-semibold text-[var(--color-primary)]">
                {selectedSub === "all" ? "Auditoría FinOps (Global)" : "Auditoría FinOps (Filtrada)"}
            </h2>
            {error && error !== 'MISSING_RBAC_ROLE' && <span className="mt-2 inline-block text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">{error}</span>}
        </div>
        
        {/* Selector de Suscripciones */}
        <div className="flex items-center space-x-2 w-full sm:w-auto">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Suscripción:</label>
            <select 
                value={selectedSub}
                onChange={(e) => setSelectedSub(e.target.value)}
                className="bg-white border border-gray-300 text-gray-700 text-sm rounded-md focus:ring-[#0054A6] focus:border-[#0054A6] block p-2 shadow-sm w-full sm:w-64"
            >
                <option value="all">Todas las Suscripciones</option>
                {subscriptions.map((sub: any) => (
                    <option key={sub.id} value={sub.id}>{sub.displayName}</option>
                ))}
            </select>
        </div>
      </div>
      
      {error === 'MISSING_RBAC_ROLE' ? <RoleAssignmentBanner /> : loading ? (
          <div className="p-8 text-center text-gray-500 font-medium animate-pulse">Escaneando Azure Resource Graph...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200 bg-white">
                <th className="p-4 font-medium">Recurso</th>
                <th className="p-4 font-medium">Suscripción</th>
                <th className="p-4 font-medium">Tipo</th>
                <th className="p-4 font-medium">Problema</th>
                <th className="p-4 font-medium text-right">Ahorro Mensual (USD)</th>
                <th className="p-4 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data.length > 0 ? data.map((item, i) => (
                <tr key={`${item.id}-${i}`} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="p-4 text-sm font-semibold text-gray-800">{item.resourceName}</td>
                  <td className="p-4 text-xs font-mono text-gray-500">{item.subscriptionId === 'all' ? 'N/A' : item.subscriptionId.substring(0,8) + '...'}</td>
                  <td className="p-4 text-sm text-gray-600">
                    <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs">{item.type}</span>
                  </td>
                  <td className="p-4 text-sm text-gray-600">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${item.issueType === 'governance' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-100'}`}>
                      {item.issue}
                    </span>
                  </td>
                  <td className="p-4 text-sm font-bold text-right ${item.potentialSavings > 0 ? 'text-green-600' : 'text-gray-400'}">${item.potentialSavings > 0 ? `$` + Number(item.potentialSavings).toFixed(2) : "-"}</td>
                  <td className="p-4 text-right">
                    <button 
                        onClick={() => handleDelete(item)}
                        disabled={deletingId === item.id || item.issueType === 'governance'}
                        className={`px-3 py-1 rounded-md text-xs font-semibold shadow-sm transition-colors ${deletingId === item.id ? 'bg-gray-100 text-gray-400 cursor-wait' : item.issueType === 'governance' ? 'bg-gray-50 text-gray-300 cursor-not-allowed' : 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'}`}
                    >
                        {deletingId === item.id ? 'Borrando...' : 'Borrar'}
                    </button>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-sm text-gray-500">
                    El entorno está 100% optimizado y bajo políticas de Gobernanza. ¡Excelente trabajo!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
