/**
 * Servicio Azure FinOps: Motor de Detección de Desperdicio en Redes Cloud (Networking Zombies)
 * Soporta Virtual Network Gateways VPN/ER ociosos, IPs Públicas huérfanas, Private Endpoints desconectados,
 * NAT Gateways vacíos, Application Gateways y normalización de Platform Watchers.
 */

import pool from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import {
  NetworkZombieType,
  NetworkZombieResourceItem,
  PrivateEndpointDetailItem,
  NetworkingZombiesSummary,
  NetworkingZombiesPayload,
} from "@/types/azureNetworkingZombies.types";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";

export function formatNetworkZombieType(type: NetworkZombieType): string {
  switch (type) {
    case "VPN_GATEWAY":
      return "Virtual Network Gateway (VPN)";
    case "EXPRESSROUTE_GATEWAY":
      return "ExpressRoute Gateway";
    case "PUBLIC_IP_UNATTACHED":
      return "IP Pública Sin Asociar";
    case "PRIVATE_ENDPOINT_ORPHAN":
      return "Private Endpoint Desconectado";
    case "NAT_GATEWAY_EMPTY":
      return "NAT Gateway Vacío";
    case "APP_GATEWAY_EMPTY":
      return "Application Gateway / Firewall Vacío";
    case "PLATFORM_WATCHER":
      return "Network Watcher (Platform)";
    default:
      return "Recurso de Red";
  }
}

export function computeNetworkingZombiesSummary(
  zombies: NetworkZombieResourceItem[],
  privateEndpoints: PrivateEndpointDetailItem[]
): NetworkingZombiesSummary {
  const activeZombies = zombies.filter((z) => !z.isExempted && z.zombieType !== "PLATFORM_WATCHER");
  const totalWasteMonthlyUSD = Number(
    activeZombies.reduce((sum, z) => sum + (z.monthlyCostUSD || 0), 0).toFixed(2)
  );
  const totalWasteAnnualUSD = Number((totalWasteMonthlyUSD * 12).toFixed(2));

  const activePEs = privateEndpoints.filter((pe) => pe.connectionStatus === "Connected");
  const privateEndpointsMonthlyCostUSD = Number(
    (privateEndpoints.length * 7.2).toFixed(2)
  );

  return {
    totalScannedCount: zombies.length,
    totalWasteMonthlyUSD,
    totalWasteAnnualUSD,
    activePrivateEndpointsCount: activePEs.length,
    privateEndpointsMonthlyCostUSD,
    zombies,
    privateEndpoints,
  };
}

/**
 * Dataset sintético determinista para modo demo.
 */
export function getMockNetworkingZombiesPayload(tenantId: string): NetworkingZombiesPayload {
  const isEnterprise = tenantId.includes("4444") || tenantId.includes("enterprise");

  const zombies: NetworkZombieResourceItem[] = [
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-hub-networking/providers/Microsoft.Network/virtualNetworkGateways/vgw-primary-vpn-idle",
      name: "vgw-primary-vpn-idle",
      resourceType: "microsoft.network/virtualnetworkgateways",
      zombieType: "VPN_GATEWAY",
      location: "westus2",
      resourceGroup: "rg-hub-networking",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-LandingZone-Production",
      idleDays: 45,
      detectionReason: "Gateway VPN activo sin túneles ni conexiones IPsec asociadas (0 bytes TX/RX en 30d)",
      monthlyCostUSD: 140.0,
      isExempted: false,
    },
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-hub-networking/providers/Microsoft.Network/publicIPAddresses/pip-legacy-unattached-01",
      name: "pip-legacy-unattached-01",
      resourceType: "microsoft.network/publicipaddresses",
      zombieType: "PUBLIC_IP_UNATTACHED",
      location: "westus2",
      resourceGroup: "rg-hub-networking",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-LandingZone-Production",
      idleDays: 60,
      detectionReason: "Dirección IP pública estática Standard huérfana (sin NIC ni Load Balancer frontend)",
      monthlyCostUSD: 3.65,
      isExempted: false,
    },
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-hub-networking/providers/Microsoft.Network/publicIPAddresses/pip-qa-ingress-stale",
      name: "pip-qa-ingress-stale",
      resourceType: "microsoft.network/publicipaddresses",
      zombieType: "PUBLIC_IP_UNATTACHED",
      location: "eastus",
      resourceGroup: "rg-hub-networking",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-LandingZone-Production",
      idleDays: 30,
      detectionReason: "IP pública desasociada tras decomiso de VM de testing",
      monthlyCostUSD: 3.65,
      isExempted: false,
    },
    {
      id: "/subscriptions/demo-sub-02/resourceGroups/rg-analytics-platform/providers/Microsoft.Network/natGateways/nat-gw-empty-pool",
      name: "nat-gw-empty-pool",
      resourceType: "microsoft.network/natgateways",
      zombieType: "NAT_GATEWAY_EMPTY",
      location: "eastus2",
      resourceGroup: "rg-analytics-platform",
      subscriptionId: "demo-sub-02",
      subscriptionName: "CSCS-DataPlatform-Analytics",
      idleDays: 90,
      detectionReason: "NAT Gateway provisionado sin subredes asignadas consumiendo tarifa horaria fija",
      monthlyCostUSD: 32.85,
      isExempted: false,
    },
    {
      id: "/subscriptions/demo-sub-02/resourceGroups/rg-analytics-platform/providers/Microsoft.Network/privateEndpoints/pe-datalake-rejected",
      name: "pe-datalake-rejected",
      resourceType: "microsoft.network/privateendpoints",
      zombieType: "PRIVATE_ENDPOINT_ORPHAN",
      location: "eastus2",
      resourceGroup: "rg-analytics-platform",
      subscriptionId: "demo-sub-02",
      subscriptionName: "CSCS-DataPlatform-Analytics",
      idleDays: 20,
      detectionReason: "Private Endpoint con estado de enlace 'Rejected' hacia Azure Storage Account eliminada",
      monthlyCostUSD: 7.2,
      isExempted: false,
    },
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/NetworkWatcher_westus2",
      name: "NetworkWatcher_westus2",
      resourceType: "microsoft.network/networkwatchers",
      zombieType: "PLATFORM_WATCHER",
      location: "westus2",
      resourceGroup: "NetworkWatcherRG",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-LandingZone-Production",
      idleDays: 0,
      detectionReason: "Componente de monitoreo de plataforma por defecto de Azure ($0.00 USD/mes)",
      monthlyCostUSD: 0.0,
      isExempted: true,
      exemptionReason: "Platform baseline de telemetría y diagnósticos de red",
    },
  ];

  if (isEnterprise) {
    zombies.push({
      id: "/subscriptions/demo-sub-02/resourceGroups/rg-dr-networking/providers/Microsoft.Network/virtualNetworkGateways/erg-expressroute-backup-idle",
      name: "erg-expressroute-backup-idle",
      resourceType: "microsoft.network/virtualnetworkgateways",
      zombieType: "EXPRESSROUTE_GATEWAY",
      location: "centralus",
      resourceGroup: "rg-dr-networking",
      subscriptionId: "demo-sub-02",
      subscriptionName: "CSCS-DataPlatform-Analytics",
      idleDays: 120,
      detectionReason: "ExpressRoute Gateway HighPerformance en standby frío sin circuitos enrutados",
      monthlyCostUSD: 438.0,
      isExempted: false,
    });
  }

  const privateEndpoints: PrivateEndpointDetailItem[] = [
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-hub-networking/providers/Microsoft.Network/privateEndpoints/pe-keyvault-prod",
      name: "pe-keyvault-prod",
      resourceGroup: "rg-hub-networking",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-LandingZone-Production",
      connectionStatus: "Connected",
      targetServiceId: "/subscriptions/demo-sub-01/resourceGroups/rg-core/providers/Microsoft.KeyVault/vaults/kv-prod-finops",
      monthlyCostUSD: 7.2,
    },
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-hub-networking/providers/Microsoft.Network/privateEndpoints/pe-sqldb-core",
      name: "pe-sqldb-core",
      resourceGroup: "rg-hub-networking",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-LandingZone-Production",
      connectionStatus: "Connected",
      targetServiceId: "/subscriptions/demo-sub-01/resourceGroups/rg-core/providers/Microsoft.Sql/servers/sql-core-prod",
      monthlyCostUSD: 7.2,
    },
    {
      id: "/subscriptions/demo-sub-02/resourceGroups/rg-analytics-platform/providers/Microsoft.Network/privateEndpoints/pe-datalake-rejected",
      name: "pe-datalake-rejected",
      resourceGroup: "rg-analytics-platform",
      subscriptionId: "demo-sub-02",
      subscriptionName: "CSCS-DataPlatform-Analytics",
      connectionStatus: "Rejected",
      targetServiceId: "/subscriptions/demo-sub-02/resourceGroups/rg-analytics/providers/Microsoft.Storage/storageAccounts/stgdeleted",
      monthlyCostUSD: 7.2,
    },
    {
      id: "/subscriptions/demo-sub-02/resourceGroups/rg-analytics-platform/providers/Microsoft.Network/privateEndpoints/pe-synapse-dw",
      name: "pe-synapse-dw",
      resourceGroup: "rg-analytics-platform",
      subscriptionId: "demo-sub-02",
      subscriptionName: "CSCS-DataPlatform-Analytics",
      connectionStatus: "Connected",
      targetServiceId: "/subscriptions/demo-sub-02/resourceGroups/rg-analytics/providers/Microsoft.Synapse/workspaces/syn-dw-prod",
      monthlyCostUSD: 7.2,
    },
  ];

  const metrics = computeNetworkingZombiesSummary(zombies, privateEndpoints);

  return {
    metrics,
    source: "mock",
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Ensambla los recursos de red escaneados en vivo desde Azure Resource Graph.
 */
export function assembleLiveNetworkingZombies(input: {
  rawGateways: any[];
  rawPublicIps: any[];
  rawPrivateEndpoints: any[];
  rawNatGateways: any[];
  rawAppGateways: any[];
  rawNetworkWatchers: any[];
  exemptions: Map<string, { reason: string; exemptedAt: string; expiresAt?: string | null }>;
  subNameMap: Map<string, string>;
}): NetworkingZombiesPayload {
  const {
    rawGateways = [],
    rawPublicIps = [],
    rawPrivateEndpoints = [],
    rawNatGateways = [],
    rawAppGateways = [],
    rawNetworkWatchers = [],
    exemptions,
    subNameMap,
  } = input;

  const zombies: NetworkZombieResourceItem[] = [];
  const privateEndpoints: PrivateEndpointDetailItem[] = [];

  // 1. Virtual Network Gateways (VPN / ER)
  for (const gw of rawGateways) {
    const resId = gw.id || "";
    const lowerId = resId.toLowerCase();
    const isExempted = exemptions.has(lowerId);
    const subId = gw.subscriptionId || (resId.split("/subscriptions/")[1] || "").split("/")[0] || "";
    const isER = String(gw.gatewayType || "").toLowerCase().includes("expressroute");
    const cost = isER ? 438.0 : 140.0;

    zombies.push({
      id: resId,
      name: gw.name || resId.split("/").pop() || "vnet-gateway",
      resourceType: "microsoft.network/virtualnetworkgateways",
      zombieType: isER ? "EXPRESSROUTE_GATEWAY" : "VPN_GATEWAY",
      location: gw.location || "global",
      resourceGroup: gw.resourceGroup || (resId.split("/resourceGroups/")[1] || "").split("/")[0] || "",
      subscriptionId: subId,
      subscriptionName: resolveSubscriptionName(subId, subNameMap),
      idleDays: gw.idleDays || 30,
      detectionReason: "Gateway sin túneles de conexión activos (0 bytes de rendimiento en 30 días)",
      monthlyCostUSD: cost,
      isExempted,
      exemptionReason: exemptions.get(lowerId)?.reason,
    });
  }

  // 2. Unattached Public IPs
  for (const pip of rawPublicIps) {
    const resId = pip.id || "";
    const lowerId = resId.toLowerCase();
    const isExempted = exemptions.has(lowerId);
    const subId = pip.subscriptionId || (resId.split("/subscriptions/")[1] || "").split("/")[0] || "";

    zombies.push({
      id: resId,
      name: pip.name || resId.split("/").pop() || "public-ip",
      resourceType: "microsoft.network/publicipaddresses",
      zombieType: "PUBLIC_IP_UNATTACHED",
      location: pip.location || "global",
      resourceGroup: pip.resourceGroup || (resId.split("/resourceGroups/")[1] || "").split("/")[0] || "",
      subscriptionId: subId,
      subscriptionName: resolveSubscriptionName(subId, subNameMap),
      idleDays: pip.idleDays || 30,
      detectionReason: "Dirección IP pública Standard huérfana sin interfaz ni balanceador asociado",
      monthlyCostUSD: 3.65,
      isExempted,
      exemptionReason: exemptions.get(lowerId)?.reason,
    });
  }

  // 3. NAT Gateways sin subredes
  for (const nat of rawNatGateways) {
    const resId = nat.id || "";
    const lowerId = resId.toLowerCase();
    const isExempted = exemptions.has(lowerId);
    const subId = nat.subscriptionId || (resId.split("/subscriptions/")[1] || "").split("/")[0] || "";

    zombies.push({
      id: resId,
      name: nat.name || resId.split("/").pop() || "nat-gateway",
      resourceType: "microsoft.network/natgateways",
      zombieType: "NAT_GATEWAY_EMPTY",
      location: nat.location || "global",
      resourceGroup: nat.resourceGroup || (resId.split("/resourceGroups/")[1] || "").split("/")[0] || "",
      subscriptionId: subId,
      subscriptionName: resolveSubscriptionName(subId, subNameMap),
      idleDays: nat.idleDays || 30,
      detectionReason: "NAT Gateway sin subredes conectadas devengando tarifa de disponibilidad",
      monthlyCostUSD: 32.85,
      isExempted,
      exemptionReason: exemptions.get(lowerId)?.reason,
    });
  }

  // 4. Private Endpoints (detalle + detección de huérfanos/desconectados)
  for (const pe of rawPrivateEndpoints) {
    const resId = pe.id || "";
    const lowerId = resId.toLowerCase();
    const isExempted = exemptions.has(lowerId);
    const subId = pe.subscriptionId || (resId.split("/subscriptions/")[1] || "").split("/")[0] || "";
    const state = pe.connectionState || pe.status || "Connected";
    const isOrphan = state === "Disconnected" || state === "Rejected" || pe.isOrphan;

    privateEndpoints.push({
      id: resId,
      name: pe.name || resId.split("/").pop() || "private-endpoint",
      resourceGroup: pe.resourceGroup || (resId.split("/resourceGroups/")[1] || "").split("/")[0] || "",
      subscriptionId: subId,
      subscriptionName: resolveSubscriptionName(subId, subNameMap),
      connectionStatus: state === "Rejected" ? "Rejected" : state === "Disconnected" ? "Disconnected" : "Connected",
      targetServiceId: pe.targetServiceId,
      monthlyCostUSD: 7.2,
    });

    if (isOrphan) {
      zombies.push({
        id: resId,
        name: pe.name || resId.split("/").pop() || "private-endpoint",
        resourceType: "microsoft.network/privateendpoints",
        zombieType: "PRIVATE_ENDPOINT_ORPHAN",
        location: pe.location || "global",
        resourceGroup: pe.resourceGroup || (resId.split("/resourceGroups/")[1] || "").split("/")[0] || "",
        subscriptionId: subId,
        subscriptionName: resolveSubscriptionName(subId, subNameMap),
        idleDays: pe.idleDays || 15,
        detectionReason: `Private Endpoint en estado '${state}' sin enlace a servicio destino`,
        monthlyCostUSD: 7.2,
        isExempted,
        exemptionReason: exemptions.get(lowerId)?.reason,
      });
    }
  }

  // 5. Application Gateways vacíos
  for (const appgw of rawAppGateways) {
    const resId = appgw.id || "";
    const lowerId = resId.toLowerCase();
    const isExempted = exemptions.has(lowerId);
    const subId = appgw.subscriptionId || (resId.split("/subscriptions/")[1] || "").split("/")[0] || "";

    zombies.push({
      id: resId,
      name: appgw.name || resId.split("/").pop() || "app-gateway",
      resourceType: "microsoft.network/applicationgateways",
      zombieType: "APP_GATEWAY_EMPTY",
      location: appgw.location || "global",
      resourceGroup: appgw.resourceGroup || (resId.split("/resourceGroups/")[1] || "").split("/")[0] || "",
      subscriptionId: subId,
      subscriptionName: resolveSubscriptionName(subId, subNameMap),
      idleDays: appgw.idleDays || 30,
      detectionReason: "Application Gateway sin HTTP listeners ni backend pools activos",
      monthlyCostUSD: 130.0,
      isExempted,
      exemptionReason: exemptions.get(lowerId)?.reason,
    });
  }

  // 6. Platform Network Watchers
  for (const nw of rawNetworkWatchers) {
    const resId = nw.id || "";
    const lowerId = resId.toLowerCase();
    const subId = nw.subscriptionId || (resId.split("/subscriptions/")[1] || "").split("/")[0] || "";

    zombies.push({
      id: resId,
      name: nw.name || resId.split("/").pop() || "network-watcher",
      resourceType: "microsoft.network/networkwatchers",
      zombieType: "PLATFORM_WATCHER",
      location: nw.location || "global",
      resourceGroup: nw.resourceGroup || "NetworkWatcherRG",
      subscriptionId: subId,
      subscriptionName: resolveSubscriptionName(subId, subNameMap),
      idleDays: 0,
      detectionReason: "Línea base de diagnóstico y telemetría de plataforma Azure ($0.00 USD)",
      monthlyCostUSD: 0.0,
      isExempted: true,
      exemptionReason: "Línea base de plataforma",
    });
  }

  const metrics = computeNetworkingZombiesSummary(zombies, privateEndpoints);

  return {
    metrics,
    source: "live",
    lastUpdated: new Date().toISOString(),
  };
}
