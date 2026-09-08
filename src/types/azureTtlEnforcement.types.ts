/**
 * Tipos TypeScript para el Motor de Gobernanza y Ciclo de Vida TTL (Time-To-Live Enforcement)
 * Soporta políticas TTL, recursos pendientes de etiquetar, tracking de expiración,
 * histórico de desaprovisionamiento y configuración de tablas.
 */

export interface TtlPolicyItem {
  id: string | number;
  name: string;
  targetResourceType: string;
  maxLifespanDays: number;
  description: string;
  isEnabled: boolean;
  notifyDaysBefore: number;
  createdAt?: string;
  createdBy?: string | null;
}

export interface UntaggedTtlResourceItem {
  id: string;
  name: string;
  resourceType: string;
  resourceGroup: string;
  subscriptionId: string;
  suggestedExpiryDate: string;
  monthlyCostUSD: number;
}

export interface TtlTrackedResourceItem {
  id: string;
  name: string;
  resourceType: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  expirationDateIso: string;
  formattedExpirationDate: string;
  /**
   * Clave de catalogo + su valor, no texto armado: el servicio no conoce el
   * locale del lector y su payload se cachea sin el, asi que traducir aca
   * serviria el idioma equivocado desde el cache.
   */
  relativeTimeKey: "relExpiredHours" | "relExpiredDays" | "relDueHours" | "relDueDays";
  relativeTimeValue: number;
  status: "CRITICAL" | "WARNING" | "ACTIVE";
  monthlySavingsUSD: number;
  isExempted: boolean;
  exemptionReason?: string;
  daysUntilExpiry?: number;
}

export interface TtlDeletionRecord {
  id: string | number;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  expiredAtDate: string;
  deletedBy: string;
  deletedAtDate: string;
  reclaimedMonthlyCostUSD?: number;
}

export interface TtlSummaryMetrics {
  expiredResourcesCount: number;
  warningResourcesCount: number;
  potentialSavingsMonthlyUSD: number;
  activePoliciesCount: number;
  policies: TtlPolicyItem[];
  untaggedResources: UntaggedTtlResourceItem[];
  trackedResources: TtlTrackedResourceItem[];
  deletionHistory: TtlDeletionRecord[];
}

export interface TtlActionPayload {
  resourceId: string;
  actionType: "EXTEND_LIFESPAN" | "DELETE_RESOURCE" | "APPLY_TTL_TAG" | "EXEMPT";
  additionalDays?: number;
  expiryDateIso?: string;
  reason?: string;
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
