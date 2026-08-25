import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { ClientSecretCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { attachQuotaTracking } from "@/lib/azureQuotaTracking";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { getTenantCredentials } from "@/lib/secrets/tenantCredentials";
import { getSubscriptionLimit } from "@/lib/tierLogic";
import { errorMessage } from '@/lib/apiErrors';

export function isSubscriptionStateEligible(state: unknown): boolean {
  const normalized = String(state || "").trim().toLowerCase();
  if (!normalized) return true;
  // Excluimos solo estados terminales/no utilizables; el resto se conserva
  // para no perder subs con costo real por estados transitorios (Warned/PastDue).
  return !["deleted", "disabled", "expired", "canceled", "cancelled"].includes(normalized);
}

async function listAccessibleSubscriptions(
  cred: ClientSecretCredential
): Promise<Array<{ subscriptionId: string; state?: string }>> {
  const tokenResponse = await cred.getToken("https://management.azure.com/.default");
  if (!tokenResponse?.token) return [];

  const out: Array<{ subscriptionId: string; state?: string }> = [];
  const seen = new Set<string>();
  let nextUrl: string | null = "https://management.azure.com/subscriptions?api-version=2020-01-01";

  while (nextUrl) {
    const fetchRes: Response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${tokenResponse.token}` },
    });
    if (!fetchRes.ok) break;

    const data: any = await fetchRes.json();
    for (const sub of data.value || []) {
      const id = String(sub?.subscriptionId || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ subscriptionId: id, state: sub?.state });
    }

    const candidate: string = String(data?.nextLink || "").trim();
    nextUrl = candidate.length > 0 ? candidate : null;
  }

  return out;
}

export async function getAzureCredential(tenantId: string) {
  await initializeDatabase();

  const clean = (v: string | undefined): string =>
    (v ?? "").trim().replace(/^["']+|["']+$/g, "");
  const cleanTid = clean(tenantId);

  const creds = await getTenantCredentials(cleanTid);
  const clientId = creds?.clientId || clean(process.env.AZURE_CLIENT_ID);
  const clientSecret = creds?.clientSecret || clean(process.env.AZURE_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    throw new Error(`Faltan credenciales (Client ID o Secret) para el tenant ${tenantId}. Verifique el Onboarding.`);
  }

  return new ClientSecretCredential(cleanTid, clientId, clientSecret);
}

/**
 * Suscripciones de Azure visibles para el Service Principal del tenant,
 * truncadas al límite de plan (Professional=5, Business=20,
 * Enterprise=sin límite — ver SUBSCRIPTION_LIMITS en tierLogic.ts).
 */
export async function getSubscriptionsForTenant(
  tenantId: string,
  credential?: ClientSecretCredential
): Promise<string[]> {
  const cred = credential || (await getAzureCredential(tenantId));
  const subs = new Set<string>();

  try {
    const discovered = await listAccessibleSubscriptions(cred);
    for (const sub of discovered) {
      if (sub.subscriptionId && isSubscriptionStateEligible(sub.state)) {
        subs.add(String(sub.subscriptionId));
      }
    }
  } catch (e) {
    console.error(`[azure] Error fetching subscriptions for tenant ${tenantId}:`, e);
  }

  for (const subId of await getStoredSubscriptionsForTenant(tenantId)) {
    subs.add(subId);
  }

  const subList = Array.from(subs);
  if (subList.length === 0) return subList;

  let tier = "Professional";
  try {
    const [rows]: any = await pool.query(
      `SELECT COALESCE(t.tier, p.tier, 'Professional') as tier
       FROM Tenants t
       LEFT JOIN Tenants p ON t.parent_tenant_id = p.tenant_id
       WHERE t.tenant_id = ?
       LIMIT 1`,
      [tenantId]
    );
    tier = rows?.[0]?.tier || "Professional";
  } catch {
    try {
      const [rows]: any = await pool.query(
        `SELECT t.tier FROM Tenants t WHERE t.tenant_id = ? LIMIT 1`,
        [tenantId]
      );
      tier = rows?.[0]?.tier || "Professional";
    } catch {
      tier = "Professional";
    }
  }

  try {
    const limit = getSubscriptionLimit(tier);
    if (Number.isFinite(limit) && subList.length > limit) {
      console.warn(
        `[azure] Tenant ${tenantId} (${tier}): ${subList.length} suscripciones visibles, límite del plan es ${limit}. Truncando (orden estable por ID).`
      );
      return [...subList].sort().slice(0, limit);
    }
  } catch (e) {
    console.warn(
      `[azure] No se pudo verificar el límite de suscripciones para ${tenantId}, devolviendo lista completa:`,
      errorMessage(e)
    );
  }

  return subList;
}

/**
 * Get ALL subscriptions accessible by the Service Principal, WITHOUT plan limits.
 */
export async function getAllSubscriptionsForTenant(
  tenantId: string,
  credential?: ClientSecretCredential
): Promise<string[]> {
  const cred = credential || (await getAzureCredential(tenantId));
  const subs = new Set<string>();

  try {
    const discovered = await listAccessibleSubscriptions(cred);
    for (const sub of discovered) {
      if (sub.subscriptionId && isSubscriptionStateEligible(sub.state)) {
        subs.add(String(sub.subscriptionId));
      }
    }
    console.log(`[azure] getAllSubscriptionsForTenant(${tenantId}): Found ${subs.size} subscriptions via Management API`);
  } catch (e) {
    console.error(`[azure] Error fetching subscriptions for tenant ${tenantId}:`, e);
  }

  for (const subId of await getStoredSubscriptionsForTenant(tenantId)) {
    subs.add(subId);
  }

  if (subs.size === 0) {
    console.log(`[azure] getAllSubscriptionsForTenant(${tenantId}): WARNING - No subscriptions found`);
  }

  return Array.from(subs);
}

async function getStoredSubscriptionsForTenant(tenantId: string): Promise<string[]> {
  const fromDb = new Set<string>();

  try {
    const [rows]: any = await pool.query(
      `SELECT DISTINCT managed_subscription_id AS subscription_id
       FROM TenantDelegations
       WHERE tenant_id = ? AND managed_subscription_id IS NOT NULL AND managed_subscription_id <> ''`,
      [tenantId]
    );
    for (const row of rows || []) {
      if (row?.subscription_id) fromDb.add(String(row.subscription_id));
    }
  } catch (e) {
    console.warn(`[azure] TenantDelegations subscription lookup failed for ${tenantId}:`, errorMessage(e));
  }

  try {
    const [rows]: any = await pool.query(
      `SELECT DISTINCT subscription_id
       FROM CostSnapshots
       WHERE tenant_id = ? AND subscription_id IS NOT NULL AND subscription_id NOT IN ('', 'default', 'mg-aggregated')`,
      [tenantId]
    );
    for (const row of rows || []) {
      if (row?.subscription_id) fromDb.add(String(row.subscription_id));
    }
  } catch (e) {
    console.warn(`[azure] CostSnapshots subscription lookup failed for ${tenantId}:`, errorMessage(e));
  }

  return Array.from(fromDb);
}

export async function getComputeClient(tenantId: string, subscriptionId: string) {
  const credential = await getAzureCredential(tenantId);
  return new ComputeManagementClient(credential, subscriptionId);
}

export async function getNetworkClient(tenantId: string, subscriptionId: string) {
  const credential = await getAzureCredential(tenantId);
  return new NetworkManagementClient(credential, subscriptionId);
}

/**
 * Cliente de Resource Graph instrumentado.
 *
 * El policy de cuota se engancha acá y no en cada call site porque esta factory
 * ya es el punto único: la usan 130 lugares. Cada respuesta de ARG trae
 * `x-ms-user-quota-remaining`, que antes se descartaba.
 */
export async function getResourceGraphClient(tenantId: string) {
  const credential = await getAzureCredential(tenantId);
  return attachQuotaTracking(new ResourceGraphClient(credential), tenantId, 'RESOURCE_GRAPH');
}

/**
 * Cliente de Cost Management instrumentado.
 *
 * No existía factory: cada colector hacía `new CostManagementClient(credential)`
 * por su cuenta. Los call sites que se migren a esta empiezan a reportar cuota;
 * los que no, siguen funcionando igual (sólo no aportan mediciones).
 */
export async function getCostManagementClient(tenantId: string) {
  const credential = await getAzureCredential(tenantId);
  return attachQuotaTracking(new CostManagementClient(credential), tenantId, 'COST_MANAGEMENT');
}
