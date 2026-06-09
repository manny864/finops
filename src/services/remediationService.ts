import { getAzureCredential } from "@/lib/azure";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import { WebSiteManagementClient } from "@azure/arm-appservice";
import pool from "@/lib/db";

async function logAction(tenantId: string, userEmail: string, actionType: string, resourceId: string, status: string) {
    try {
        await pool.query(
            "INSERT INTO ActionLogs (tenant_id, user_email, action_type, resource_id, status) VALUES (?, ?, ?, ?, ?)",
            [tenantId, userEmail, actionType, resourceId, status]
        );
    } catch (e) {
        console.error("Error logging action to Audit Trail:", e);
    }
}

export async function deleteResource(tenantId: string, userEmail: string, subscriptionId: string, resourceGroup: string, resourceName: string, resourceType: string) {
    const credential = await getAzureCredential(tenantId);
    const type = resourceType.toLowerCase();
    const fullResourceId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/${resourceType}/${resourceName}`;

    try {
        let result;
        if (type.includes("disks") || type.includes("snapshots")) {
            const client = new ComputeManagementClient(credential, subscriptionId);
            if (type.includes("disks")) {
                result = await client.disks.beginDeleteAndWait(resourceGroup, resourceName);
            } else if (type.includes("virtualmachines")) {
                result = await client.virtualMachines.beginDeleteAndWait(resourceGroup, resourceName);
            } else {
                result = await client.snapshots.beginDeleteAndWait(resourceGroup, resourceName);
            }
        } else if (type.includes("networkinterfaces")) {
            const client = new NetworkManagementClient(credential, subscriptionId);
            result = await client.networkInterfaces.beginDeleteAndWait(resourceGroup, resourceName);
        } else if (type.includes("networksecuritygroups")) {
            const client = new NetworkManagementClient(credential, subscriptionId);
            result = await client.networkSecurityGroups.beginDeleteAndWait(resourceGroup, resourceName);
        } else if (type.includes("publicipaddresses")) {
            const client = new NetworkManagementClient(credential, subscriptionId);
            result = await client.publicIPAddresses.beginDeleteAndWait(resourceGroup, resourceName);
        } else if (type.includes("serverfarms")) {
            const client = new WebSiteManagementClient(credential, subscriptionId);
            result = await client.appServicePlans.delete(resourceGroup, resourceName);
        } else if (type.includes("virtualmachines")) {
            const client = new ComputeManagementClient(credential, subscriptionId);
            result = await client.virtualMachines.beginDeleteAndWait(resourceGroup, resourceName);
        } else {
            throw new Error(`Tipo de recurso no soportado para borrado automático: ${resourceType}`);
        }
        await logAction(tenantId, userEmail, "DELETE_RESOURCE", fullResourceId, "SUCCESS");
        return result;
    } catch (error) {
        await logAction(tenantId, userEmail, "DELETE_RESOURCE", fullResourceId, "FAILED");
        throw error;
    }
}

export async function deallocateVirtualMachine(tenantId: string, userEmail: string, subscriptionId: string, resourceGroup: string, vmName: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new ComputeManagementClient(credential, subscriptionId);
    const fullResourceId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}`;
    try {
        const result = await client.virtualMachines.beginDeallocateAndWait(resourceGroup, vmName);
        await logAction(tenantId, userEmail, "STOP_VM", fullResourceId, "SUCCESS");
        return result;
    } catch (e) {
        await logAction(tenantId, userEmail, "STOP_VM", fullResourceId, "FAILED");
        throw e;
    }
}

export async function startVirtualMachine(tenantId: string, userEmail: string, subscriptionId: string, resourceGroup: string, vmName: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new ComputeManagementClient(credential, subscriptionId);
    const fullResourceId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}`;
    try {
        const result = await client.virtualMachines.beginStartAndWait(resourceGroup, vmName);
        await logAction(tenantId, userEmail, "START_VM", fullResourceId, "SUCCESS");
        return result;
    } catch (e) {
        await logAction(tenantId, userEmail, "START_VM", fullResourceId, "FAILED");
        throw e;
    }
}

export async function restartVirtualMachine(tenantId: string, userEmail: string, subscriptionId: string, resourceGroup: string, vmName: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new ComputeManagementClient(credential, subscriptionId);
    const fullResourceId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}`;
    try {
        const result = await client.virtualMachines.beginRestartAndWait(resourceGroup, vmName);
        await logAction(tenantId, userEmail, "RESTART_VM", fullResourceId, "SUCCESS");
        return result;
    } catch (e) {
        await logAction(tenantId, userEmail, "RESTART_VM", fullResourceId, "FAILED");
        throw e;
    }
}

export async function downgradeVirtualMachine(tenantId: string, userEmail: string, subscriptionId: string, resourceGroup: string, vmName: string, newSku: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new ComputeManagementClient(credential, subscriptionId);
    const fullResourceId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}`;
    try {
        const result = await client.virtualMachines.beginUpdateAndWait(resourceGroup, vmName, {
            hardwareProfile: { vmSize: newSku }
        });
        await logAction(tenantId, userEmail, "DOWNGRADE_VM", fullResourceId, "SUCCESS");
        return result;
    } catch (e) {
        await logAction(tenantId, userEmail, "DOWNGRADE_VM", fullResourceId, "FAILED");
        throw e;
    }
}
