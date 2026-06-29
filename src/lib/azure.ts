import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { ClientSecretCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import pool, { initializeDatabase } from '@/modules/storage/db';
import { RowDataPacket } from "mysql2";

export async function getAzureCredential(tenantId: string) {
  // Ensure DB schema exists before querying
  await initializeDatabase();

  // Query DB to find client credentials for this tenant
  const [rows] = await pool.query<RowDataPacket[]>('SELECT client_id, client_secret FROM Tenants WHERE tenant_id = ?', [tenantId]);

  if (rows.length === 0) {
    throw new Error(`Tenant no registrado en la base de datos: ${tenantId}`);
  }

  const clean = (v: any) => (typeof v === 'string' ? v.trim().replace(/^["']+|["']+$/g, '') : v);
  const cleanTid = clean(tenantId);
  const clientId = clean(rows[0].client_id) || clean(process.env.AZURE_CLIENT_ID);
  const clientSecret = clean(rows[0].client_secret) || clean(process.env.AZURE_CLIENT_SECRET);

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
