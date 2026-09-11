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

/**
 * El rotulo del tipo sale del discriminador, no de una cadena del servidor: la
 * tabla venia pintando `zombieType.replace(/_/g, " ")` ("PUBLIC IP
 * UNATTACHED") mientras el filtro de arriba ya mostraba el nombre del catalogo.
 */
export const NETWORK_ZOMBIE_TYPE_KEYS: Record<NetworkZombieType, string> = {
  VPN_GATEWAY: "ntype_vpn_gateway",
  EXPRESSROUTE_GATEWAY: "ntype_er_gateway",
  PUBLIC_IP_UNATTACHED: "ntype_public_ip",
  PRIVATE_ENDPOINT_ORPHAN: "ntype_private_endpoint",
  NAT_GATEWAY_EMPTY: "ntype_nat_gateway",
  APP_GATEWAY_EMPTY: "ntype_app_gateway",
  PLATFORM_WATCHER: "ntype_platform_watcher",
};

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
  /**
   * Prosa ya armada, en castellano. A diferencia del tipo, el motivo varia
   * ENTRE recursos del mismo `zombieType` (dos IPs huerfanas lo son por causas
   * distintas), asi que el discriminador no alcanza: viaja la clave por fila.
   * `detectionReason` queda como fallback y es lo que se loguea.
   */
  detectionReason: string;
  detectionReasonKey?: string;
  detectionReasonParams?: Record<string, string | number>;
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
  /**
   * El rotulo NO viaja aca: la UI lo resuelve con `col_<key>` del catalogo.
   * Mientras existio un `label: string`, las columnas se declaraban en
   * castellano y compilaban.
   */
  key: string;
  isVisible: boolean;
  widthPx: number;
}
