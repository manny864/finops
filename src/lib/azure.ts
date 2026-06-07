import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { ClientSecretCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import pool from "./db";
import { RowDataPacket } from "mysql2";

export async function getAzureCredential(tenantId: string) {
  // Query DB to find client credentials for this tenant
  const [rows] = await pool.query<RowDataPacket[]>('SELECT client_id, client_secret FROM Tenants WHERE tenant_id = ?', [tenantId]);
  
  if (rows.length === 0) {
      throw new Error(`Tenant no registrado en la base de datos: ${tenantId}`);
  }
  
  const clientId = rows[0].client_id || process.env.AZURE_CLIENT_ID;
  const clientSecret = rows[0].client_secret || process.env.AZURE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(`Faltan credenciales (Client ID o Secret) para el tenant ${tenantId}. Verifique el Onboarding.`);
  }

  return new ClientSecretCredential(tenantId, clientId, clientSecret);
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
