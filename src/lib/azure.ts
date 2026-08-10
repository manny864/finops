import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { ClientSecretCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import pool, { initializeDatabase } from '@/modules/storage/db';
import { getTenantCredentials } from '@/lib/secrets/tenantCredentials';
import { getSubscriptionLimit } from '@/lib/tierLogic';

export async function getAzureCredential(tenantId: string) {
  // Ensure DB schema exists before querying (KV fallback path may hit DB).
  await initializeDatabase();

  const clean = (v: string | undefined): string =>
    (v ?? '').trim().replace(/^["']+|["']+$/g, '');
  const cleanTid = clean(tenantId);

  const creds = await getTenantCredentials(cleanTid);

  // Fallback al SP global de la plataforma (env) si el tenant no tiene
  // credenciales propias todavía. Útil en dev/demo.
  const clientId = creds?.clientId || clean(process.env.AZURE_CLIENT_ID);
  const clientSecret = creds?.clientSecret || clean(process.env.AZURE_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    throw new Error(`Faltan credenciales (Client ID o Secret) para el tenant ${tenantId}. Verifique el Onboarding.`);
  }

  return new ClientSecretCredential(cleanTid, clientId, clientSecret);
}

/**
 * Suscripciones de Azure visibles para el Service Principal del tenant,
 * truncadas al límite de plan (Essential=1, Professional=5, Business=20,
 * Enterprise=sin límite — ver SUBSCRIPTION_LIMITS en tierLogic.ts). El SP
 * puede tener Reader en más suscripciones de las que el plan permite
 * monitorear (el cliente le asigna el rol en Azure IAM, fuera de nuestro
 * control); el corte pasa acá para que TODO lo que consume esta función
 * (cost snapshots, tags compliance, zombies, rightsizing, etc. — ~16
 * llamadores) respete el límite de forma consistente sin tener que tocar
 * cada caller individualmente.
 */
export async function getSubscriptionsForTenant(tenantId: string, credential?: ClientSecretCredential): Promise<string[]> {
  const cred = credential || await getAzureCredential(tenantId);
  const subs: string[] = [];
  try {
    const tokenResponse = await cred.getToken("https://management.azure.com/.default");
    const fetchRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
      headers: { "Authorization": `Bearer ${tokenResponse.token}` }
    });
    if (fetchRes.ok) {
      const data = await fetchRes.json();
      for (const sub of (data.value || [])) {
        if (sub.subscriptionId) subs.push(sub.subscriptionId);
      }
    }
  } catch (e) {
    console.error(`[azure] Error fetching subscriptions for tenant ${tenantId}:`, e);
  }

  if (subs.length === 0) return subs;

  try {
    const [rows]: any = await pool.query("SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1", [tenantId]);
    const tier = rows?.[0]?.tier || "Essential";
    const limit = getSubscriptionLimit(tier);
    if (Number.isFinite(limit) && subs.length > limit) {
      console.warn(`[azure] Tenant ${tenantId} (${tier}): ${subs.length} suscripciones visibles, límite del plan es ${limit}. Truncando (orden estable por ID).`);
      return [...subs].sort().slice(0, limit);
    }
  } catch (e: any) {
    console.warn(`[azure] No se pudo verificar el límite de suscripciones para ${tenantId}, devolviendo lista completa:`, e?.message);
  }

  return subs;
}

/**
 * Get ALL subscriptions accessible by the Service Principal, WITHOUT applying plan limits.
 * Used by resource discovery endpoints that need to find resources across all subscriptions
 * the SP can access, regardless of the plan tier.
 */
export async function getAllSubscriptionsForTenant(tenantId: string, credential?: ClientSecretCredential): Promise<string[]> {
  const cred = credential || await getAzureCredential(tenantId);
  const subs: string[] = [];
  try {
    const tokenResponse = await cred.getToken("https://management.azure.com/.default");
    const fetchRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
      headers: { "Authorization": `Bearer ${tokenResponse.token}` }
    });
    if (fetchRes.ok) {
      const data = await fetchRes.json();
      for (const sub of (data.value || [])) {
        if (sub.subscriptionId) subs.push(sub.subscriptionId);
      }
      console.log(`[azure] getAllSubscriptionsForTenant(${tenantId}): Found ${subs.length} subscriptions (no plan limit applied)`);
    }
  } catch (e) {
    console.error(`[azure] Error fetching all subscriptions for tenant ${tenantId}:`, e);
  }
  return subs;
}

export async function getComputeClient(tenantId: string, subscriptionId: string) {
  const credential = await getAzureCredential(tenantId);
  return new ComputeManagementClient(credential, subscriptionId);
}

export async function getNetworkClient(tenantId: string, subscriptionId: string) {
  const credential = await getAzureCredential(tenantId);
  return new NetworkManagementClient(credential, subscriptionId);
}

export async function getResourceGraphClient(tenantId: string) {
  const credential = await getAzureCredential(tenantId);
  return new ResourceGraphClient(credential);
}
