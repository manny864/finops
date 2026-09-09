/**
 * TypeScript Contracts for Azure Key Vault — Gobernanza de Identidades y FinOps
 *
 * Key Vault es barato por transaccion pero tiene dos caras que la vista nativa
 * no muestra juntas:
 *  - El dinero grande esta en Managed HSM (~$2.300/mes por pool dedicado, se
 *    facture o no una sola operacion) y en las claves HSM de Premium.
 *  - El riesgo grande esta en el throttling: Key Vault tiene limites duros de
 *    servicio, y una app que lee un secreto en bucle no genera una factura
 *    alarmante, genera 429 y caidas.
 * Por eso este modulo reporta ambas dimensiones y no presenta la mitigacion de
 * polling como si fuera un ahorro grande, porque no lo es.
 */

/** Transacciones Standard: USD por cada 10.000 operaciones. */
export const KV_TRANSACTION_USD_PER_10K = 0.03;

/** Clave protegida por HSM en SKU Premium: USD por clave y por mes. */
export const KV_PREMIUM_HSM_KEY_USD_MONTH = 1.0;

/** Managed HSM: pool dedicado, USD por hora. Se factura este por su existencia. */
export const KV_MANAGED_HSM_USD_HOUR = 3.2;

/** Horas de un mes de 30 dias, para proyectar el pool de Managed HSM. */
export const HOURS_PER_MONTH = 730;

/** Operaciones MTD a partir de las cuales se sospecha un bucle de lectura. */
export const POLLING_THRESHOLD_OPS = 1_000_000;

/** Dias sin transacciones a partir de los cuales la boveda se considera huerfana. */
export const IDLE_VAULT_DAYS = 45;

export type KeyVaultSku = "Standard" | "Premium" | "Managed_HSM";

export type KeyVaultAuthModel = "AzureRBAC" | "AccessPolicies";

export type KeyVaultObjectType = "Secrets" | "Keys" | "Certificates";

export const KEY_VAULT_REMEDIATION_CATEGORIES = [
  "POLLING_CACHE_OPTIMIZATION",
  "DOWNGRADE_MANAGED_HSM",
  "PURGE_EXPIRED_OBJECTS",
  "ENABLE_RBAC",
] as const;

export type KeyVaultRemediationCategory = (typeof KEY_VAULT_REMEDIATION_CATEGORIES)[number];

/** Un recurso de computo que consume la boveda. */
export interface KeyVaultConsumer {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  /** Como accede: referencia en app settings, Managed Identity, CSI driver, DES… */
  accessMethod: string;
  /** Identidad administrada usada, si se pudo resolver. */
  principalId?: string;
  /** Transacciones MTD atribuidas a este consumidor. */
  apiHitsMTD: number;
}

export interface KeyVaultResourceItem {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  skuName: KeyVaultSku;
  authModel: KeyVaultAuthModel;
  rbacEnabled: boolean;
  softDeleteEnabled: boolean;
  purgeProtectionEnabled: boolean;
  /** `Disabled` implica que solo se llega por Private Endpoint. */
  publicNetworkAccess: "Enabled" | "Disabled" | "Unknown";
  privateEndpointsCount: number;
  secretsCount: number;
  keysCount: number;
  /** Claves protegidas por HSM: son las que facturan en SKU Premium. */
  hsmKeysCount: number;
  certificatesCount: number;
  expiredObjectsCount: number;
  totalApiHitsMTD: number;
  /** Desglose de operaciones por tipo de objeto. */
  hitsByObjectType: Record<KeyVaultObjectType, number>;
  throttledHits429: number;
  serverErrors5xx: number;
  avgLatencyMs: number;
  /** Dias desde la ultima transaccion registrada; null si nunca hubo. */
  daysSinceLastTransaction: number | null;
  /** Desglose del costo para que la cifra sea auditable. */
  transactionCostUSD: number;
  hsmKeyCostUSD: number;
  managedHsmPoolCostUSD: number;
  monthlyCostUSD: number;
  isDevOrTest: boolean;
  /** `true` si dispara alguna regla de fuga o riesgo. */
  hasFindings: boolean;
  findingReason?: string;
  linkedConsumers: KeyVaultConsumer[];
}

export interface KeyVaultSummaryMetrics {
  totalMonthlyCostUSD: number;
  projectedMonthEndCostUSD: number;
  totalVaultsCount: number;
  standardCount: number;
  premiumCount: number;
  managedHsmCount: number;
  totalApiTransactionsMTD: number;
  totalThrottled429: number;
  totalStoredObjects: number;
  totalSecrets: number;
  totalKeys: number;
  totalCertificates: number;
  totalExpiredObjects: number;
  /** Bovedas que todavia usan Access Policies en vez de Azure RBAC. */
  accessPolicyVaultsCount: number;
  potentialSavingsUSD: number;
  breakdownByObjectType: Array<{
    objectType: KeyVaultObjectType;
    label: string;
    operationsCount: number;
    costUSD: number;
    percentage: number;
    color: string;
  }>;
}

export interface KeyVaultRemediationAction {
  id: string;
  vaultId: string;
  vaultName: string;
  /** Valores a interpolar en `rem_<category>_title` / `_desc`. */
  params?: Record<string, string | number>;
  category: KeyVaultRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
}

export interface KeyVaultTrendPoint {
  date: string;
  apiHits: number;
  avgLatencyMs: number;
}

export interface KeyVaultPayload {
  summary: KeyVaultSummaryMetrics;
  vaults: KeyVaultResourceItem[];
  remediations: KeyVaultRemediationAction[];
  apiTrend?: KeyVaultTrendPoint[];
  source: "live" | "mock";
  lastUpdated: string;
  availableSubscriptions?: string[];
}

/** Paleta institucional en tonos de azul por tipo de operacion. */
export const KV_OBJECT_COLORS: Record<KeyVaultObjectType, string> = {
  Secrets: "#0078D4",
  Keys: "#2563EB",
  Certificates: "#0284C7",
};

export const KV_OBJECT_LABELS: Record<KeyVaultObjectType, string> = {
  Secrets: "Secretos",
  Keys: "Claves / Criptografia",
  Certificates: "Certificados",
};

/** Color de las series auxiliares de las graficas. */
export const KV_HSM_COLOR = "#38BDF8";
export const KV_THROTTLE_COLOR = "#94A3B8";
