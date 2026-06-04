import { ClientSecretCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";

/**
 * Instancia una credencial dinámicamente basada en el Tenant solicitado.
 * Requiere que la aplicación FinOps (Service Principal) esté registrada globalmente
 * y las variables de entorno AZURE_CLIENT_ID y AZURE_CLIENT_SECRET estén configuradas.
 */
export function getAzureCredential(tenantId: string) {
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("AZURE_CLIENT_ID y AZURE_CLIENT_SECRET deben estar definidos en las variables de entorno (.env)");
  }

  return new ClientSecretCredential(tenantId, clientId, clientSecret);
}

export function getComputeClient(tenantId: string, subscriptionId: string) {
  const credential = getAzureCredential(tenantId);
  return new ComputeManagementClient(credential, subscriptionId);
}

export function getNetworkClient(tenantId: string, subscriptionId: string) {
  const credential = getAzureCredential(tenantId);
  return new NetworkManagementClient(credential, subscriptionId);
}
