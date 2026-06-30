import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { ClientSecretCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import { initializeDatabase } from '@/modules/storage/db';
import { getTenantCredentials } from '@/lib/secrets/tenantCredentials';

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
