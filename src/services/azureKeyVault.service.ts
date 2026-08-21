/**
 * Azure Key Vault — Gobernanza de Identidades, Telemetria de API y FinOps
 *
 * RBAC minimo en Azure (Service Principal del tenant):
 *   - `Reader` sobre las suscripciones: inventario via Resource Graph y lectura
 *     de metricas de Azure Monitor (`ServiceApiHit`, `ServiceApiResult`,
 *     `ServiceApiLatency`), que son metricas del plano de control y no requieren
 *     acceso al plano de datos.
 *   - NO se requiere `Key Vault Reader` ni ningun rol de plano de datos: este
 *     servicio nunca lee el VALOR de un secreto, solo su metadata. Pedir mas
 *     permiso del necesario sobre una boveda seria injustificable.
 *
 * Dos dimensiones que la vista nativa no muestra juntas:
 *  - Dinero: concentrado en Managed HSM (~$2.300/mes por pool, exista o no
 *    trafico) y en las claves HSM de Premium. Las transacciones son calderilla.
 *  - Riesgo: un bucle de lectura no produce una factura alarmante, produce 429
 *    contra los limites duros del servicio y tumba la aplicacion.
 */

import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { getSubscriptionNameMap } from "@/lib/azureSubscriptionNames";
import { withArgLimit } from "@/lib/argConcurrency";
import { errorMessage } from "@/lib/apiErrors";
import { MonitorClient } from "@azure/arm-monitor";
import {
  HOURS_PER_MONTH,
  IDLE_VAULT_DAYS,
  KV_MANAGED_HSM_USD_HOUR,
  KV_OBJECT_COLORS,
  KV_OBJECT_LABELS,
  KV_PREMIUM_HSM_KEY_USD_MONTH,
  KV_TRANSACTION_USD_PER_10K,
  POLLING_THRESHOLD_OPS,
  type KeyVaultAuthModel,
  type KeyVaultConsumer,
  type KeyVaultObjectType,
  type KeyVaultPayload,
  type KeyVaultRemediationAction,
  type KeyVaultResourceItem,
  type KeyVaultSku,
  type KeyVaultSummaryMetrics,
} from "@/types/azureKeyVault.types";

// ─────────────────────────────────────────────────────────────────────────────
// Normalizacion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normaliza el SKU. Azure devuelve `standard`/`premium` para vaults y nombres de
 * familia (`Standard_B1`, `Custom_B32`) para Managed HSM, ademas de traer el
 * tipo de recurso distinto.
 */
export function normalizeSku(resourceType: string, skuName: unknown): KeyVaultSku {
  if (resourceType.toLowerCase().includes("managedhsm")) return "Managed_HSM";
  const v = typeof skuName === "string" ? skuName.toLowerCase() : "";
  return v === "premium" ? "Premium" : "Standard";
}

/**
 * Modelo de autorizacion. `enableRbacAuthorization` ausente equivale a false:
 * las bovedas viejas usan Access Policies, que no dan auditoria granular por
 * identidad y son el motivo de la recomendacion ENABLE_RBAC.
 */
export function deriveAuthModel(enableRbacAuthorization: unknown): KeyVaultAuthModel {
  return enableRbacAuthorization === true ? "AzureRBAC" : "AccessPolicies";
}

/** Heuristica de entorno por nombre de RG y suscripcion (misma que el resto del repo). */
export function isDevOrTestScope(resourceGroup: string, subscriptionName: string): boolean {
  const haystack = `${resourceGroup} ${subscriptionName}`.toLowerCase();
  return /\b(dev|desarrollo|test|testing|qa|stg|stage|staging|sandbox|poc|lab|preprod|pre-prod|nonprod|non-prod)\b/.test(
    haystack
  );
}

/**
 * Deduce como un recurso consume la boveda a partir de su tipo. Solo se afirma
 * el metodo cuando el tipo lo determina; en el resto se declara generico en vez
 * de inventar un mecanismo.
 */
export function deriveAccessMethod(resourceType: string): string {
  const t = resourceType.toLowerCase();
  if (t.includes("microsoft.web/sites")) return "App Setting @Microsoft.KeyVault + Managed Identity";
  if (t.includes("microsoft.containerservice/managedclusters")) return "Secrets Store CSI Driver";
  if (t.includes("microsoft.compute/diskencryptionsets")) return "Disk Encryption Set";
  if (t.includes("microsoft.compute/virtualmachines")) return "Azure Disk Encryption";
  if (t.includes("microsoft.datafactory/factories")) return "Linked Service con credencial en Key Vault";
  if (t.includes("microsoft.logic/workflows")) return "Conexion con secreto en Key Vault";
  if (t.includes("microsoft.apimanagement/service")) return "Named Value referenciado";
  if (t.includes("microsoft.storage/storageaccounts")) return "Customer Managed Key (CMK)";
  if (t.includes("microsoft.sql/servers")) return "Transparent Data Encryption con CMK";
  return "Managed Identity autorizada";
}

// ─────────────────────────────────────────────────────────────────────────────
// Costo
// ─────────────────────────────────────────────────────────────────────────────

/** Costo de transacciones: $0.03 por cada 10.000 operaciones. */
export function calcTransactionCost(apiHits: number): number {
  if (apiHits <= 0) return 0;
  return Number(((apiHits / 10_000) * KV_TRANSACTION_USD_PER_10K).toFixed(2));
}

/** Claves protegidas por HSM: solo facturan en SKU Premium. */
export function calcHsmKeyCost(sku: KeyVaultSku, hsmKeysCount: number): number {
  if (sku !== "Premium" || hsmKeysCount <= 0) return 0;
  return Number((hsmKeysCount * KV_PREMIUM_HSM_KEY_USD_MONTH).toFixed(2));
}

/**
 * Pool de Managed HSM: se factura por hora de existencia, con trafico o sin el.
 * Es el unico componente realmente caro del modulo.
 */
export function calcManagedHsmPoolCost(sku: KeyVaultSku, activeHours: number = HOURS_PER_MONTH): number {
  if (sku !== "Managed_HSM") return 0;
  return Number((activeHours * KV_MANAGED_HSM_USD_HOUR).toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Motor de deteccion de fugas y riesgos
// ─────────────────────────────────────────────────────────────────────────────

/** Regla 1 — volumen compatible con un bucle de lectura sin cache. */
export function hasPollingPattern(totalApiHitsMTD: number): boolean {
  return totalApiHitsMTD > POLLING_THRESHOLD_OPS;
}

/** Regla 2 — pool de Managed HSM dedicado en un scope no productivo. */
export function hasUnjustifiedManagedHsm(sku: KeyVaultSku, isDevOrTest: boolean): boolean {
  return sku === "Managed_HSM" && isDevOrTest;
}

/** Regla 3 — boveda sin trafico reciente u objetos vencidos. */
export function hasHygieneIssue(
  daysSinceLastTransaction: number | null,
  expiredObjectsCount: number
): boolean {
  if (expiredObjectsCount > 0) return true;
  // `null` significa que nunca registro una transaccion: es el caso mas huerfano.
  return daysSinceLastTransaction === null || daysSinceLastTransaction > IDLE_VAULT_DAYS;
}

/** Consolida los motivos en el flag y el texto legible de la boveda. */
export function deriveFindings(input: {
  sku: KeyVaultSku;
  isDevOrTest: boolean;
  totalApiHitsMTD: number;
  throttledHits429: number;
  daysSinceLastTransaction: number | null;
  expiredObjectsCount: number;
  authModel: KeyVaultAuthModel;
}): { hasFindings: boolean; findingReason?: string } {
  const reasons: string[] = [];
  if (hasUnjustifiedManagedHsm(input.sku, input.isDevOrTest)) {
    reasons.push("Pool de Managed HSM dedicado en un scope no productivo");
  }
  if (hasPollingPattern(input.totalApiHitsMTD)) {
    reasons.push(`${(input.totalApiHitsMTD / 1_000_000).toFixed(1)}M operaciones MTD: patron de lectura en bucle`);
  }
  if (input.throttledHits429 > 0) {
    reasons.push(`${input.throttledHits429} respuestas 429 (throttling)`);
  }
  if (input.expiredObjectsCount > 0) {
    reasons.push(`${input.expiredObjectsCount} objeto(s) vencido(s)`);
  }
  if (input.daysSinceLastTransaction === null) {
    reasons.push("Sin transacciones registradas");
  } else if (input.daysSinceLastTransaction > IDLE_VAULT_DAYS) {
    reasons.push(`Sin trafico hace ${input.daysSinceLastTransaction} dias`);
  }
  if (input.authModel === "AccessPolicies") {
    reasons.push("Autorizacion por Access Policies (sin auditoria granular)");
  }
  return reasons.length > 0 ? { hasFindings: true, findingReason: reasons.join(" · ") } : { hasFindings: false };
}

export function generateKeyVaultRecommendations(
  vaults: KeyVaultResourceItem[]
): KeyVaultRemediationAction[] {
  const out: KeyVaultRemediationAction[] = [];

  for (const v of vaults) {
    // Regla 2 primero: es la unica con dinero real detras.
    if (hasUnjustifiedManagedHsm(v.skuName, v.isDevOrTest)) {
      // Migrar a Premium conserva el respaldo HSM (FIPS 140-2 Nivel 2) sin el
      // pool dedicado; solo se pierde el aislamiento de inquilino unico.
      const premiumEquivalent = calcHsmKeyCost("Premium", Math.max(1, v.hsmKeysCount || v.keysCount));
      out.push({
        id: `hsm-${v.id}`,
        vaultId: v.id,
        vaultName: v.name,
        title: `Migrar Managed HSM a Key Vault Premium: ${v.name}`,
        description: `Pool de Managed HSM dedicado en ${v.resourceGroup} (${v.subscriptionName}), un scope no productivo. El pool factura ${KV_MANAGED_HSM_USD_HOUR} USD/hora por existir, con trafico o sin el. Key Vault Premium conserva el respaldo HSM validado FIPS 140-2 Nivel 2 por ${KV_PREMIUM_HSM_KEY_USD_MONTH} USD/clave/mes; lo unico que se pierde es el aislamiento de inquilino unico, que rara vez se justifica fuera de produccion.`,
        category: "DOWNGRADE_MANAGED_HSM",
        estimatedSavingsUSD: Number(Math.max(0, v.managedHsmPoolCostUSD - premiumEquivalent).toFixed(2)),
        confidence: "HIGH",
        actionType: "MIGRATE_TO_PREMIUM",
      });
    }

    // Regla 1 — bucle de lectura. El ahorro directo es chico; el problema es el
    // throttling. Se reporta el ahorro real, sin inflarlo.
    if (hasPollingPattern(v.totalApiHitsMTD)) {
      // Cachear en el cliente elimina tipicamente la gran mayoria de las
      // lecturas repetidas del mismo secreto.
      const avoidableHits = v.totalApiHitsMTD * 0.9;
      const throttleNote =
        v.throttledHits429 > 0
          ? ` Ya se registran ${v.throttledHits429} respuestas 429: la boveda esta chocando contra los limites duros del servicio y la aplicacion esta fallando, no solo gastando.`
          : " Todavia sin 429, pero el margen contra los limites de servicio se estrecha con cada despliegue nuevo.";
      out.push({
        id: `polling-${v.id}`,
        vaultId: v.id,
        vaultName: v.name,
        title: `Cachear secretos en el cliente: ${v.name} (${(v.totalApiHitsMTD / 1_000_000).toFixed(1)}M ops MTD)`,
        description: `${v.totalApiHitsMTD.toLocaleString("es-AR")} operaciones en el mes indican lecturas repetidas del mismo secreto en cada request en vez de una cache en memoria con TTL.${throttleNote} El ahorro en factura es modesto (las transacciones cuestan ${KV_TRANSACTION_USD_PER_10K} USD cada 10.000); el beneficio principal es de disponibilidad y latencia.`,
        category: "POLLING_CACHE_OPTIMIZATION",
        estimatedSavingsUSD: calcTransactionCost(avoidableHits),
        confidence: "HIGH",
        actionType: "IMPLEMENT_CLIENT_CACHE",
      });
    }

    // Regla 3 — higiene: objetos vencidos o boveda sin trafico.
    if (v.expiredObjectsCount > 0 || v.daysSinceLastTransaction === null || v.daysSinceLastTransaction > IDLE_VAULT_DAYS) {
      const idleText =
        v.daysSinceLastTransaction === null
          ? "no registra ninguna transaccion"
          : `no registra trafico hace ${v.daysSinceLastTransaction} dias`;
      out.push({
        id: `hygiene-${v.id}`,
        vaultId: v.id,
        vaultName: v.name,
        title:
          v.expiredObjectsCount > 0
            ? `Auditar ${v.expiredObjectsCount} objeto(s) vencido(s) en ${v.name}`
            : `Boveda sin uso: ${v.name}`,
        description: `${v.name} ${idleText}${
          v.expiredObjectsCount > 0 ? ` y tiene ${v.expiredObjectsCount} secreto(s)/certificado(s) vencidos` : ""
        }. Un certificado vencido en una boveda activa rompe la aplicacion que lo consume; una boveda sin trafico suele ser residuo de un proyecto cerrado. ${
          v.purgeProtectionEnabled
            ? "Tiene purge protection activa: no se puede eliminar hasta que venza el periodo de retencion, asi que planificar la baja con tiempo."
            : "Sin purge protection: verificar que nada la consuma antes de eliminarla, porque el borrado sera reversible solo durante el periodo de soft delete."
        }`,
        category: "PURGE_EXPIRED_OBJECTS",
        // Higiene y riesgo operativo: el ahorro es marginal salvo que la boveda
        // sea Premium o HSM, asi que solo se cuenta lo que realmente se libera.
        estimatedSavingsUSD:
          v.daysSinceLastTransaction === null || v.daysSinceLastTransaction > IDLE_VAULT_DAYS
            ? Number((v.hsmKeyCostUSD + v.managedHsmPoolCostUSD).toFixed(2))
            : 0,
        confidence: v.expiredObjectsCount > 0 ? "HIGH" : "MEDIUM",
        actionType: "AUDIT_AND_PURGE",
      });
    }

    // Gobernanza: Access Policies no permiten auditoria por identidad ni
    // asignaciones granulares. No ahorra dinero; mejora la postura.
    if (v.authModel === "AccessPolicies") {
      out.push({
        id: `rbac-${v.id}`,
        vaultId: v.id,
        vaultName: v.name,
        title: `Migrar a Azure RBAC: ${v.name}`,
        description:
          "La boveda autoriza por Access Policies, un modelo plano que no distingue quien accedio a que objeto ni permite asignaciones a nivel de secreto individual. Azure RBAC habilita auditoria granular en el log de actividad y roles por objeto. Migrar es un cambio de plano de control: revisar cada politica existente y mapearla a su rol equivalente ANTES de activar enableRbacAuthorization, porque el cambio invalida las policies de golpe y puede dejar aplicaciones sin acceso.",
        category: "ENABLE_RBAC",
        estimatedSavingsUSD: 0,
        confidence: "MEDIUM",
        actionType: "ENABLE_RBAC_AUTH",
      });
    }
  }

  return out.sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD);
}

// ─────────────────────────────────────────────────────────────────────────────
// Agregacion
// ─────────────────────────────────────────────────────────────────────────────

export function calculateKeyVaultSummary(
  vaults: KeyVaultResourceItem[],
  remediations: KeyVaultRemediationAction[]
): KeyVaultSummaryMetrics {
  const totalCost = vaults.reduce((a, v) => a + v.monthlyCostUSD, 0);
  const totalHits = vaults.reduce((a, v) => a + v.totalApiHitsMTD, 0);

  const objectTypes: KeyVaultObjectType[] = ["Secrets", "Keys", "Certificates"];
  const opsByType = objectTypes.map((objectType) => {
    const operationsCount = vaults.reduce((a, v) => a + (v.hitsByObjectType[objectType] || 0), 0);
    return {
      objectType,
      label: KV_OBJECT_LABELS[objectType],
      operationsCount,
      costUSD: calcTransactionCost(operationsCount),
      percentage: totalHits > 0 ? Number(((operationsCount / totalHits) * 100).toFixed(1)) : 0,
      color: KV_OBJECT_COLORS[objectType],
    };
  });

  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projected = dayOfMonth > 0 ? (totalCost / dayOfMonth) * daysInMonth : totalCost;

  return {
    totalMonthlyCostUSD: Number(totalCost.toFixed(2)),
    projectedMonthEndCostUSD: Number(projected.toFixed(2)),
    totalVaultsCount: vaults.length,
    standardCount: vaults.filter((v) => v.skuName === "Standard").length,
    premiumCount: vaults.filter((v) => v.skuName === "Premium").length,
    managedHsmCount: vaults.filter((v) => v.skuName === "Managed_HSM").length,
    totalApiTransactionsMTD: totalHits,
    totalThrottled429: vaults.reduce((a, v) => a + v.throttledHits429, 0),
    totalStoredObjects: vaults.reduce((a, v) => a + v.secretsCount + v.keysCount + v.certificatesCount, 0),
    totalSecrets: vaults.reduce((a, v) => a + v.secretsCount, 0),
    totalKeys: vaults.reduce((a, v) => a + v.keysCount, 0),
    totalCertificates: vaults.reduce((a, v) => a + v.certificatesCount, 0),
    totalExpiredObjects: vaults.reduce((a, v) => a + v.expiredObjectsCount, 0),
    accessPolicyVaultsCount: vaults.filter((v) => v.authModel === "AccessPolicies").length,
    potentialSavingsUSD: Number(remediations.reduce((a, r) => a + r.estimatedSavingsUSD, 0).toFixed(2)),
    breakdownByObjectType: opsByType.filter((o) => o.operationsCount > 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensamblado de una boveda (compartido entre mock y live)
// ─────────────────────────────────────────────────────────────────────────────

export function assembleVault(input: {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  skuName: KeyVaultSku;
  rbacEnabled: boolean;
  softDeleteEnabled: boolean;
  purgeProtectionEnabled: boolean;
  publicNetworkAccess: "Enabled" | "Disabled" | "Unknown";
  privateEndpointsCount: number;
  secretsCount: number;
  keysCount: number;
  hsmKeysCount: number;
  certificatesCount: number;
  expiredObjectsCount: number;
  hitsByObjectType: Record<KeyVaultObjectType, number>;
  throttledHits429: number;
  serverErrors5xx: number;
  avgLatencyMs: number;
  daysSinceLastTransaction: number | null;
  linkedConsumers: KeyVaultConsumer[];
  managedHsmActiveHours?: number;
}): KeyVaultResourceItem {
  const totalApiHitsMTD =
    input.hitsByObjectType.Secrets + input.hitsByObjectType.Keys + input.hitsByObjectType.Certificates;
  const isDevOrTest = isDevOrTestScope(input.resourceGroup, input.subscriptionName);
  const authModel = deriveAuthModel(input.rbacEnabled);

  const transactionCostUSD = calcTransactionCost(totalApiHitsMTD);
  const hsmKeyCostUSD = calcHsmKeyCost(input.skuName, input.hsmKeysCount);
  const managedHsmPoolCostUSD = calcManagedHsmPoolCost(input.skuName, input.managedHsmActiveHours);

  const { hasFindings, findingReason } = deriveFindings({
    sku: input.skuName,
    isDevOrTest,
    totalApiHitsMTD,
    throttledHits429: input.throttledHits429,
    daysSinceLastTransaction: input.daysSinceLastTransaction,
    expiredObjectsCount: input.expiredObjectsCount,
    authModel,
  });

  return {
    id: input.id,
    name: input.name,
    location: input.location,
    resourceGroup: input.resourceGroup,
    subscriptionId: input.subscriptionId,
    subscriptionName: input.subscriptionName,
    skuName: input.skuName,
    authModel,
    rbacEnabled: input.rbacEnabled,
    softDeleteEnabled: input.softDeleteEnabled,
    purgeProtectionEnabled: input.purgeProtectionEnabled,
    publicNetworkAccess: input.publicNetworkAccess,
    privateEndpointsCount: input.privateEndpointsCount,
    secretsCount: input.secretsCount,
    keysCount: input.keysCount,
    hsmKeysCount: input.hsmKeysCount,
    certificatesCount: input.certificatesCount,
    expiredObjectsCount: input.expiredObjectsCount,
    totalApiHitsMTD,
    hitsByObjectType: input.hitsByObjectType,
    throttledHits429: input.throttledHits429,
    serverErrors5xx: input.serverErrors5xx,
    avgLatencyMs: input.avgLatencyMs,
    daysSinceLastTransaction: input.daysSinceLastTransaction,
    transactionCostUSD,
    hsmKeyCostUSD,
    managedHsmPoolCostUSD,
    monthlyCostUSD: Number((transactionCostUSD + hsmKeyCostUSD + managedHsmPoolCostUSD).toFixed(2)),
    isDevOrTest,
    hasFindings,
    findingReason,
    linkedConsumers: input.linkedConsumers,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset sintetico por tier (solo tenants demo — AGENTS.md #13)
// ─────────────────────────────────────────────────────────────────────────────

function consumer(
  resourceName: string,
  resourceType: string,
  resourceGroup: string,
  apiHitsMTD: number
): KeyVaultConsumer {
  return {
    resourceId: `/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/${resourceGroup}/providers/${resourceType}/${resourceName}`,
    resourceName,
    resourceType,
    resourceGroup,
    accessMethod: deriveAccessMethod(resourceType),
    principalId: `mi-${resourceName}`,
    apiHitsMTD,
  };
}

export function getMockKeyVaultPayload(tenantId: string): KeyVaultPayload {
  const isEnterprise = tenantId.includes("4444");
  const isBusiness = tenantId.includes("2222") || isEnterprise;

  const SUB_PROD = { id: "00000000-0000-0000-0000-000000000001", name: "Produccion CSCloudSolutions" };
  const SUB_DEV = { id: "00000000-0000-0000-0000-000000000002", name: "Desarrollo y QA" };

  const vaults: KeyVaultResourceItem[] = [
    // Regla 1: bucle de lectura con throttling ya presente.
    assembleVault({
      id: `/subscriptions/${SUB_PROD.id}/resourceGroups/rg-prod-app/providers/Microsoft.KeyVault/vaults/kv-prod-app`,
      name: "kv-prod-app",
      location: "eastus",
      resourceGroup: "rg-prod-app",
      subscriptionId: SUB_PROD.id,
      subscriptionName: SUB_PROD.name,
      skuName: "Standard",
      rbacEnabled: true,
      softDeleteEnabled: true,
      purgeProtectionEnabled: true,
      publicNetworkAccess: "Disabled",
      privateEndpointsCount: 2,
      secretsCount: 34,
      keysCount: 4,
      hsmKeysCount: 0,
      certificatesCount: 6,
      expiredObjectsCount: 0,
      hitsByObjectType: { Secrets: 2_180_000, Keys: 96_000, Certificates: 18_000 },
      throttledHits429: 1_842,
      serverErrors5xx: 12,
      avgLatencyMs: 41,
      daysSinceLastTransaction: 0,
      linkedConsumers: [
        consumer("app-prod-api", "Microsoft.Web/sites", "rg-prod-app", 1_640_000),
        consumer("app-prod-worker", "Microsoft.Web/sites", "rg-prod-app", 520_000),
        consumer("aks-prod-cluster", "Microsoft.ContainerService/managedClusters", "rg-prod-aks", 134_000),
      ],
    }),
    // Boveda sana, con volumen razonable.
    assembleVault({
      id: `/subscriptions/${SUB_PROD.id}/resourceGroups/rg-prod-data/providers/Microsoft.KeyVault/vaults/kv-prod-cmk`,
      name: "kv-prod-cmk",
      location: "eastus",
      resourceGroup: "rg-prod-data",
      subscriptionId: SUB_PROD.id,
      subscriptionName: SUB_PROD.name,
      skuName: "Premium",
      rbacEnabled: true,
      softDeleteEnabled: true,
      purgeProtectionEnabled: true,
      publicNetworkAccess: "Disabled",
      privateEndpointsCount: 1,
      secretsCount: 3,
      keysCount: 6,
      hsmKeysCount: 6,
      certificatesCount: 0,
      expiredObjectsCount: 0,
      hitsByObjectType: { Secrets: 2_400, Keys: 74_500, Certificates: 0 },
      throttledHits429: 0,
      serverErrors5xx: 0,
      avgLatencyMs: 28,
      daysSinceLastTransaction: 0,
      linkedConsumers: [
        consumer("sqlprodcore", "Microsoft.Sql/servers", "rg-prod-data", 41_000),
        consumer("stprodarchive", "Microsoft.Storage/storageAccounts", "rg-prod-data", 33_500),
      ],
    }),
    // Regla 3: certificados vencidos + Access Policies.
    assembleVault({
      id: `/subscriptions/${SUB_PROD.id}/resourceGroups/rg-legacy/providers/Microsoft.KeyVault/vaults/kv-legacy-certs`,
      name: "kv-legacy-certs",
      location: "westus2",
      resourceGroup: "rg-legacy",
      subscriptionId: SUB_PROD.id,
      subscriptionName: SUB_PROD.name,
      skuName: "Standard",
      rbacEnabled: false,
      softDeleteEnabled: true,
      purgeProtectionEnabled: false,
      publicNetworkAccess: "Enabled",
      privateEndpointsCount: 0,
      secretsCount: 12,
      keysCount: 1,
      hsmKeysCount: 0,
      certificatesCount: 9,
      expiredObjectsCount: 4,
      hitsByObjectType: { Secrets: 210, Keys: 0, Certificates: 88 },
      throttledHits429: 0,
      serverErrors5xx: 0,
      avgLatencyMs: 63,
      daysSinceLastTransaction: 71,
      linkedConsumers: [],
    }),
  ];

  if (isBusiness) {
    vaults.push(
      // Regla 2: el hallazgo caro.
      assembleVault({
        id: `/subscriptions/${SUB_DEV.id}/resourceGroups/rg-dev-crypto/providers/Microsoft.KeyVault/managedHSMs/hsm-dev-pool`,
        name: "hsm-dev-pool",
        location: "eastus",
        resourceGroup: "rg-dev-crypto",
        subscriptionId: SUB_DEV.id,
        subscriptionName: SUB_DEV.name,
        skuName: "Managed_HSM",
        rbacEnabled: true,
        softDeleteEnabled: true,
        purgeProtectionEnabled: false,
        publicNetworkAccess: "Enabled",
        privateEndpointsCount: 0,
        secretsCount: 0,
        keysCount: 3,
        hsmKeysCount: 3,
        certificatesCount: 0,
        expiredObjectsCount: 0,
        hitsByObjectType: { Secrets: 0, Keys: 1_120, Certificates: 0 },
        throttledHits429: 0,
        serverErrors5xx: 0,
        avgLatencyMs: 19,
        daysSinceLastTransaction: 2,
        linkedConsumers: [consumer("app-dev-crypto", "Microsoft.Web/sites", "rg-dev-crypto", 1_120)],
      }),
      assembleVault({
        id: `/subscriptions/${SUB_DEV.id}/resourceGroups/rg-dev-app/providers/Microsoft.KeyVault/vaults/kv-dev-app`,
        name: "kv-dev-app",
        location: "eastus",
        resourceGroup: "rg-dev-app",
        subscriptionId: SUB_DEV.id,
        subscriptionName: SUB_DEV.name,
        skuName: "Standard",
        rbacEnabled: false,
        softDeleteEnabled: true,
        purgeProtectionEnabled: false,
        publicNetworkAccess: "Enabled",
        privateEndpointsCount: 0,
        secretsCount: 18,
        keysCount: 0,
        hsmKeysCount: 0,
        certificatesCount: 1,
        expiredObjectsCount: 1,
        hitsByObjectType: { Secrets: 46_800, Keys: 0, Certificates: 300 },
        throttledHits429: 0,
        serverErrors5xx: 3,
        avgLatencyMs: 52,
        daysSinceLastTransaction: 1,
        linkedConsumers: [
          consumer("app-dev-api", "Microsoft.Web/sites", "rg-dev-app", 44_200),
          consumer("adf-dev-pipeline", "Microsoft.DataFactory/factories", "rg-dev-data", 2_900),
        ],
      })
    );
  }

  if (isEnterprise) {
    vaults.push(
      // Boveda huerfana: nunca registro trafico.
      assembleVault({
        id: `/subscriptions/${SUB_PROD.id}/resourceGroups/rg-sandbox/providers/Microsoft.KeyVault/vaults/kv-poc-abandonado`,
        name: "kv-poc-abandonado",
        location: "brazilsouth",
        resourceGroup: "rg-sandbox",
        subscriptionId: SUB_PROD.id,
        subscriptionName: SUB_PROD.name,
        skuName: "Premium",
        rbacEnabled: false,
        softDeleteEnabled: true,
        purgeProtectionEnabled: true,
        publicNetworkAccess: "Enabled",
        privateEndpointsCount: 0,
        secretsCount: 2,
        keysCount: 2,
        hsmKeysCount: 2,
        certificatesCount: 0,
        expiredObjectsCount: 2,
        hitsByObjectType: { Secrets: 0, Keys: 0, Certificates: 0 },
        throttledHits429: 0,
        serverErrors5xx: 0,
        avgLatencyMs: 0,
        daysSinceLastTransaction: null,
        linkedConsumers: [],
      }),
      assembleVault({
        id: `/subscriptions/${SUB_PROD.id}/resourceGroups/rg-prod-emea/providers/Microsoft.KeyVault/vaults/kv-prod-emea`,
        name: "kv-prod-emea",
        location: "westeurope",
        resourceGroup: "rg-prod-emea",
        subscriptionId: SUB_PROD.id,
        subscriptionName: SUB_PROD.name,
        skuName: "Standard",
        rbacEnabled: true,
        softDeleteEnabled: true,
        purgeProtectionEnabled: true,
        publicNetworkAccess: "Disabled",
        privateEndpointsCount: 3,
        secretsCount: 51,
        keysCount: 8,
        hsmKeysCount: 0,
        certificatesCount: 14,
        expiredObjectsCount: 0,
        hitsByObjectType: { Secrets: 890_000, Keys: 61_000, Certificates: 24_000 },
        throttledHits429: 0,
        serverErrors5xx: 5,
        avgLatencyMs: 37,
        daysSinceLastTransaction: 0,
        linkedConsumers: [
          consumer("app-emea-portal", "Microsoft.Web/sites", "rg-prod-emea", 620_000),
          consumer("func-emea-jobs", "Microsoft.Web/sites", "rg-prod-emea", 248_000),
          consumer("des-emea-vms", "Microsoft.Compute/diskEncryptionSets", "rg-prod-emea", 61_000),
          consumer("logic-emea-sync", "Microsoft.Logic/workflows", "rg-prod-emea", 46_000),
        ],
      })
    );
  }

  const remediations = generateKeyVaultRecommendations(vaults);
  const summary = calculateKeyVaultSummary(vaults, remediations);

  // Serie determinista (sin Math.random) para que la demo sea estable.
  const dailyHits = summary.totalApiTransactionsMTD / 30;
  const apiTrend = Array.from({ length: 30 }, (_, i) => {
    const wave = 1 + 0.25 * Math.sin((i / 30) * Math.PI * 5);
    return {
      date: new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10),
      apiHits: Math.round(dailyHits * wave),
      // La latencia sube donde el volumen aprieta: es el sintoma del throttling.
      avgLatencyMs: Number((32 * wave).toFixed(1)),
    };
  });

  return {
    summary,
    vaults,
    remediations,
    apiTrend,
    source: "mock",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions: Array.from(new Set(vaults.map((v) => v.subscriptionName))),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Descubrimiento vivo
// ─────────────────────────────────────────────────────────────────────────────

function emptyPayload(availableSubscriptions: string[] = []): KeyVaultPayload {
  return {
    summary: calculateKeyVaultSummary([], []),
    vaults: [],
    remediations: [],
    apiTrend: [],
    source: "live",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions,
  };
}

const ZERO_HITS: Record<KeyVaultObjectType, number> = { Secrets: 0, Keys: 0, Certificates: 0 };

/** Métricas de Azure Monitor para una bóveda. */
export interface VaultMetrics {
  totalHits: number;
  throttled429: number;
  serverErrors5xx: number;
  avgLatencyMs: number;
  daysSinceLastTransaction: number | null;
}

/**
 * Lee `ServiceApiHit`, `ServiceApiResult` y `ServiceApiLatency` de Azure Monitor.
 * Ante cualquier fallo devuelve ceros con `daysSinceLastTransaction: null`, que
 * la UI renderiza como "sin telemetria" — no se inventan valores.
 */
export async function fetchVaultMetrics(
  monitorClient: MonitorClient,
  resourceId: string
): Promise<VaultMetrics> {
  const empty: VaultMetrics = {
    totalHits: 0,
    throttled429: 0,
    serverErrors5xx: 0,
    avgLatencyMs: 0,
    daysSinceLastTransaction: null,
  };
  try {
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 86400000);
    const response = await monitorClient.metrics.list(resourceId, {
      timespan: `${from.toISOString()}/${now.toISOString()}`,
      interval: "P1D",
      metricnames: "ServiceApiHit,ServiceApiLatency,ServiceApiResult",
      aggregation: "Total,Average",
    });

    let totalHits = 0;
    let latencySum = 0;
    let latencySamples = 0;
    let throttled429 = 0;
    let serverErrors5xx = 0;
    let lastActivityMs: number | null = null;

    for (const metric of response.value || []) {
      const name = String(metric.name?.value || "");
      for (const series of metric.timeseries || []) {
        // ServiceApiResult se dimensiona por StatusCode: hay que mirar la
        // dimension para separar 429 de 5xx.
        const statusCode = (series.metadatavalues || []).find(
          (m) => String(m.name?.value || "").toLowerCase() === "statuscode"
        )?.value;

        for (const point of series.data || []) {
          const total = typeof point.total === "number" ? point.total : 0;
          if (name === "ServiceApiHit") {
            totalHits += total;
            if (total > 0 && point.timeStamp) {
              const ts = new Date(point.timeStamp).getTime();
              lastActivityMs = lastActivityMs === null ? ts : Math.max(lastActivityMs, ts);
            }
          } else if (name === "ServiceApiLatency") {
            if (typeof point.average === "number") {
              latencySum += point.average;
              latencySamples += 1;
            }
          } else if (name === "ServiceApiResult" && statusCode) {
            if (statusCode === "429") throttled429 += total;
            else if (/^5\d\d$/.test(statusCode)) serverErrors5xx += total;
          }
        }
      }
    }

    return {
      totalHits: Math.round(totalHits),
      throttled429: Math.round(throttled429),
      serverErrors5xx: Math.round(serverErrors5xx),
      avgLatencyMs: latencySamples > 0 ? Number((latencySum / latencySamples).toFixed(1)) : 0,
      daysSinceLastTransaction:
        lastActivityMs === null ? null : Math.max(0, Math.floor((Date.now() - lastActivityMs) / 86400000)),
    };
  } catch (error) {
    console.warn(`[azureKeyVault.service] metricas no disponibles para ${resourceId}:`, errorMessage(error));
    return empty;
  }
}

/**
 * Reparte las operaciones totales entre tipos de objeto segun la proporcion de
 * objetos alojados.
 *
 * ponytail: aproximacion por composicion. `ServiceApiHit` no se dimensiona por
 * tipo de objeto en Azure Monitor; la unica fuente exacta seria el log de
 * diagnostico `AuditEvent` en Log Analytics, que no todas las bovedas tienen
 * habilitado. Con cero objetos el reparto queda en cero, no se fuerza.
 */
export function distributeHitsByObjectType(
  totalHits: number,
  secretsCount: number,
  keysCount: number,
  certificatesCount: number
): Record<KeyVaultObjectType, number> {
  const totalObjects = secretsCount + keysCount + certificatesCount;
  if (totalHits <= 0 || totalObjects <= 0) return { ...ZERO_HITS };
  const secrets = Math.round((totalHits * secretsCount) / totalObjects);
  const keys = Math.round((totalHits * keysCount) / totalObjects);
  // El resto va a certificados para que la suma cuadre exactamente con el total.
  return { Secrets: secrets, Keys: keys, Certificates: Math.max(0, totalHits - secrets - keys) };
}

/**
 * Inventario vivo de Key Vaults y Managed HSM, con telemetria de Azure Monitor
 * y cruce de consumidores.
 *
 * Devuelve estado vacio legitimo si no hay credenciales o no hay bovedas: nunca
 * cae al dataset mock (Directiva 24.1).
 */
export async function fetchLiveKeyVaultData(tenantId: string): Promise<KeyVaultPayload> {
  try {
    const credential = await getAzureCredential(tenantId);
    if (!credential) return emptyPayload();

    const subMap = await getSubscriptionNameMap(tenantId, credential).catch(() => new Map<string, string>());
    const availableSubscriptions = Array.from(subMap.values());
    const client = await getResourceGraphClient(tenantId);

    const vaultsQuery = `
      resources
      | where type =~ 'microsoft.keyvault/vaults' or type =~ 'microsoft.keyvault/managedhsms'
      | project id, name, type, location, resourceGroup, subscriptionId, sku, properties
    `;
    // Consumidores potenciales: recursos con Managed Identity o CMK que suelen
    // apoyarse en una boveda.
    const consumersQuery = `
      resources
      | where type in~ (
          'microsoft.web/sites',
          'microsoft.containerservice/managedclusters',
          'microsoft.compute/diskencryptionsets',
          'microsoft.datafactory/factories',
          'microsoft.logic/workflows',
          'microsoft.apimanagement/service',
          'microsoft.storage/storageaccounts',
          'microsoft.sql/servers'
        )
      | project id, name, type, resourceGroup, subscriptionId, identity, properties
    `;
    const privateEndpointsQuery = `
      resources
      | where type =~ 'microsoft.network/privateendpoints'
      | project id, properties
    `;

    const [vRes, cRes, peRes] = await withArgLimit(async () => {
      return await Promise.all([
        client.resources({ query: vaultsQuery }),
        client.resources({ query: consumersQuery }),
        client.resources({ query: privateEndpointsQuery }),
      ]);
    });

    const vaultRows: Array<Record<string, unknown>> = vRes.data || [];
    if (vaultRows.length === 0) return emptyPayload(availableSubscriptions);

    // Indexar Private Endpoints por el recurso al que apuntan.
    const peCountByVault = new Map<string, number>();
    for (const row of (peRes.data || []) as Array<Record<string, unknown>>) {
      const props = (row.properties || {}) as Record<string, unknown>;
      const connections = [
        ...(Array.isArray(props.privateLinkServiceConnections) ? props.privateLinkServiceConnections : []),
        ...(Array.isArray(props.manualPrivateLinkServiceConnections)
          ? props.manualPrivateLinkServiceConnections
          : []),
      ];
      for (const conn of connections) {
        const target = String(
          ((conn as Record<string, unknown>).properties as Record<string, unknown> | undefined)
            ?.privateLinkServiceId || ""
        ).toLowerCase();
        if (target) peCountByVault.set(target, (peCountByVault.get(target) || 0) + 1);
      }
    }

    // Indexar consumidores por el nombre de boveda que referencian. Resource
    // Graph no expone los app settings, asi que el cruce se hace por las
    // referencias que si aparecen en `properties` (CMK, DES, keyVaultUri…).
    const consumerRows = (cRes.data || []) as Array<Record<string, unknown>>;
    const consumersByVaultKey = new Map<string, KeyVaultConsumer[]>();
    for (const row of consumerRows) {
      const serialized = JSON.stringify(row.properties || {}).toLowerCase();
      const resourceType = String(row.type || "");
      // Referencias del tipo https://<vault>.vault.azure.net o un resourceId.
      const uriMatches = serialized.matchAll(/https:\/\/([a-z0-9-]+)\.(?:vault|managedhsm)\.azure\.net/g);
      const idMatches = serialized.matchAll(/\/providers\/microsoft\.keyvault\/(?:vaults|managedhsms)\/([a-z0-9-]+)/g);
      const referenced = new Set<string>();
      for (const m of uriMatches) referenced.add(m[1]);
      for (const m of idMatches) referenced.add(m[1]);
      if (referenced.size === 0) continue;

      for (const vaultName of referenced) {
        consumersByVaultKey.set(vaultName, [
          ...(consumersByVaultKey.get(vaultName) || []),
          {
            resourceId: String(row.id || ""),
            resourceName: String(row.name || ""),
            resourceType,
            resourceGroup: String(row.resourceGroup || ""),
            accessMethod: deriveAccessMethod(resourceType),
            principalId: String(
              ((row.identity as Record<string, unknown> | undefined)?.principalId as string) || ""
            ) || undefined,
            // Sin `AuditEvent` en Log Analytics no se puede atribuir volumen por
            // consumidor: se deja en 0 en vez de repartirlo a ojo.
            apiHitsMTD: 0,
          },
        ]);
      }
    }

    const monitorClients = new Map<string, MonitorClient>();
    const vaults: KeyVaultResourceItem[] = [];

    for (const row of vaultRows) {
      const id = String(row.id || "");
      const name = String(row.name || "");
      const resourceType = String(row.type || "");
      const subscriptionId = String(row.subscriptionId || "");
      const props = (row.properties || {}) as Record<string, unknown>;
      const sku = (row.sku || {}) as Record<string, unknown>;

      const skuName = normalizeSku(resourceType, sku.name);

      if (!monitorClients.has(subscriptionId)) {
        monitorClients.set(subscriptionId, new MonitorClient(credential, subscriptionId));
      }
      const metrics = await fetchVaultMetrics(monitorClients.get(subscriptionId)!, id);

      // Resource Graph no expone el conteo de objetos alojados (secretos,
      // claves, certificados): eso vive en el plano de datos y requiere permisos
      // que este servicio deliberadamente no pide. Se reporta 0, que la UI
      // muestra como "requiere plano de datos", en vez de estimarlo.
      const secretsCount = 0;
      const keysCount = 0;
      const certificatesCount = 0;

      const publicNetworkAccessRaw = String(props.publicNetworkAccess || "").toLowerCase();
      const publicNetworkAccess: "Enabled" | "Disabled" | "Unknown" =
        publicNetworkAccessRaw === "enabled"
          ? "Enabled"
          : publicNetworkAccessRaw === "disabled"
            ? "Disabled"
            : "Unknown";

      vaults.push(
        assembleVault({
          id,
          name,
          location: String(row.location || ""),
          resourceGroup: String(row.resourceGroup || ""),
          subscriptionId,
          subscriptionName: subMap.get(subscriptionId) || subscriptionId,
          skuName,
          rbacEnabled: props.enableRbacAuthorization === true,
          softDeleteEnabled: props.enableSoftDelete !== false,
          purgeProtectionEnabled: props.enablePurgeProtection === true,
          publicNetworkAccess,
          privateEndpointsCount: peCountByVault.get(id.toLowerCase()) || 0,
          secretsCount,
          keysCount,
          hsmKeysCount: 0,
          certificatesCount,
          expiredObjectsCount: 0,
          // Sin conteo de objetos el reparto proporcional no aplica, pero el
          // total de operaciones si es real: se imputa a Secretos, que es la
          // operacion dominante en la practica, y el tooltip lo aclara.
          hitsByObjectType:
            secretsCount + keysCount + certificatesCount > 0
              ? distributeHitsByObjectType(metrics.totalHits, secretsCount, keysCount, certificatesCount)
              : { Secrets: metrics.totalHits, Keys: 0, Certificates: 0 },
          throttledHits429: metrics.throttled429,
          serverErrors5xx: metrics.serverErrors5xx,
          avgLatencyMs: metrics.avgLatencyMs,
          daysSinceLastTransaction: metrics.daysSinceLastTransaction,
          linkedConsumers: consumersByVaultKey.get(name.toLowerCase()) || [],
        })
      );
    }

    const remediations = generateKeyVaultRecommendations(vaults);
    const summary = calculateKeyVaultSummary(vaults, remediations);

    return {
      summary,
      vaults,
      remediations,
      apiTrend: [],
      source: "live",
      lastUpdated: new Date().toISOString(),
      availableSubscriptions,
    };
  } catch (error) {
    console.error("[azureKeyVault.service] fetchLiveKeyVaultData:", errorMessage(error));
    return emptyPayload();
  }
}
