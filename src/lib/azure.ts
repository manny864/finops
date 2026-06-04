import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { ClientSecretCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import { getTenantSecret } from "./keyvault";

export async function getAzureCredential(tenantId: string) {
  const clientId = process.env.AZURE_CLIENT_ID;
  if (!clientId) {
    throw new Error("AZURE_CLIENT_ID debe estar definido en las variables de entorno (.env)");
  }

  // Descarga dinámica del secreto desde Azure Key Vault
  const clientSecret = await getTenantSecret(tenantId);
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
