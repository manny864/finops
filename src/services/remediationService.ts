import { getAzureCredential } from "@/lib/azure";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import { WebSiteManagementClient } from "@azure/arm-appservice";

export async function deleteResource(tenantId: string, subscriptionId: string, resourceGroup: string, resourceName: string, resourceType: string) {
    const credential = await getAzureCredential(tenantId);
    const type = resourceType.toLowerCase();

    if (type.includes("disks") || type.includes("snapshots")) {
        const client = new ComputeManagementClient(credential, subscriptionId);
        if (type.includes("disks")) {
            return await client.disks.beginDeleteAndWait(resourceGroup, resourceName);
        } else if (type.includes("virtualmachines")) {
        const client = new ComputeManagementClient(credential, subscriptionId);
        return await client.virtualMachines.beginDeleteAndWait(resourceGroup, resourceName);
    } else {
            return await client.snapshots.beginDeleteAndWait(resourceGroup, resourceName);
        }
    } else if (type.includes("networkinterfaces")) {
        const client = new NetworkManagementClient(credential, subscriptionId);
        return await client.networkInterfaces.beginDeleteAndWait(resourceGroup, resourceName);
    } else if (type.includes("networksecuritygroups")) {
        const client = new NetworkManagementClient(credential, subscriptionId);
        return await client.networkSecurityGroups.beginDeleteAndWait(resourceGroup, resourceName);
    } else if (type.includes("publicipaddresses")) {
        const client = new NetworkManagementClient(credential, subscriptionId);
        return await client.publicIPAddresses.beginDeleteAndWait(resourceGroup, resourceName);
    } else if (type.includes("serverfarms")) {
        const client = new WebSiteManagementClient(credential, subscriptionId);
        return await client.appServicePlans.delete(resourceGroup, resourceName);
    } else if (type.includes("virtualmachines")) {
        const client = new ComputeManagementClient(credential, subscriptionId);
        return await client.virtualMachines.beginDeleteAndWait(resourceGroup, resourceName);
    } else {
        throw new Error(`Tipo de recurso no soportado para borrado automático: ${resourceType}`);
    }
}

export async function deallocateVirtualMachine(tenantId: string, subscriptionId: string, resourceGroup: string, vmName: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new ComputeManagementClient(credential, subscriptionId);
    return await client.virtualMachines.beginDeallocate(resourceGroup, vmName);
}

export async function startVirtualMachine(tenantId: string, subscriptionId: string, resourceGroup: string, vmName: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new ComputeManagementClient(credential, subscriptionId);
    return await client.virtualMachines.beginStart(resourceGroup, vmName);
}
