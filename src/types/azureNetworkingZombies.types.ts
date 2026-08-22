/**
 * Tipos TypeScript para el Motor de Detección de Desperdicio en Redes Cloud (Azure Networking Zombies)
 * Soporta Virtual Network Gateways ociosos, IPs Públicas huérfanas, Private Endpoints desconectados,
 * NAT Gateways vacíos, Application Gateways huérfanos, y configuración dinámica de columnas.
 */

export type NetworkZombieType =
  | "VPN_GATEWAY"
  | "EXPRESSROUTE_GATEWAY"
  | "PUBLIC_IP_UNATTACHED"
  | "PRIVATE_ENDPOINT_ORPHAN"
  | "NAT_GATEWAY_EMPTY"
  | "APP_GATEWAY_EMPTY"
  | "PLATFORM_WATCHER";

export interface NetworkZombieResourceItem {
  id: string;
  name: string;
  resourceType: string;
  zombieType: NetworkZombieType;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  idleDays: number;
  detectionReason: string;
  monthlyCostUSD: number;
  isExempted: boolean;
  exemptionReason?: string;
}

export interface PrivateEndpointDetailItem {
  id: string;
  name: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  connectionStatus: "Connected" | "Disconnected" | "Rejected";
  targetServiceId?: string;
  monthlyCostUSD: number;
}

export interface NetworkingZombiesSummary {
  totalScannedCount: number;
  totalWasteMonthlyUSD: number;
  totalWasteAnnualUSD: number;
  activePrivateEndpointsCount: number;
  privateEndpointsMonthlyCostUSD: number;
  zombies: NetworkZombieResourceItem[];
  privateEndpoints: PrivateEndpointDetailItem[];
}

export interface NetworkingZombiesPayload {
  metrics: NetworkingZombiesSummary;
  source: "live" | "mock";
  lastUpdated: string;
}

export interface TableColumnConfig {
  key: string;
  label: string;
  isVisible: boolean;
  widthPx: number;
}
