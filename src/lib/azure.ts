import { DefaultAzureCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";

// La creacion de DefaultAzureCredential utilizará el entorno (variables, Managed Identity, Azure CLI)
export const credential = new DefaultAzureCredential();

export function getComputeClient(subscriptionId: string) {
  return new ComputeManagementClient(credential, subscriptionId);
}

export function getNetworkClient(subscriptionId: string) {
  return new NetworkManagementClient(credential, subscriptionId);
}
