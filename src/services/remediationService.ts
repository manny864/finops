import { getAzureCredential } from "@/lib/azure";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import { WebSiteManagementClient } from "@azure/arm-appservice";
import pool from "@/modules/storage/db";

/** Traza en ActionLogs. Exportada para que otras mutaciones de gobernanza
 *  (asignación y borrado de Azure Policy) escriban en el mismo audit trail. */
export async function logAction(tenantId: string, userEmail: string, actionType: string, resourceId: string, status: string) {
    try {
        await pool.query(
            "INSERT INTO ActionLogs (tenant_id, user_email, action_type, resource_id, status) VALUES (?, ?, ?, ?, ?)",
            [tenantId, userEmail, actionType, resourceId, status]
        );
    } catch (e) {
        console.error("Error logging action to Audit Trail:", e);
    }
}

const apiVersionMap: Record<string, string> = {
    'microsoft.compute/disks': '2023-01-02',
    'microsoft.compute/snapshots': '2023-01-02',
    'microsoft.compute/virtualmachines': '2023-03-01',
    'microsoft.network/publicipaddresses': '2023-05-01',
    'microsoft.network/networkinterfaces': '2023-05-01',
    'microsoft.network/networksecuritygroups': '2023-05-01',
    'microsoft.network/routetables': '2023-05-01',
    'microsoft.network/loadbalancers': '2023-05-01',
    'microsoft.network/frontdoorwebapplicationfirewallpolicies': '2022-05-01',
    'microsoft.network/trafficmanagerprofiles': '2022-04-01',
    'microsoft.network/applicationgateways': '2023-05-01',
    'microsoft.network/virtualnetworks': '2023-05-01',
    'microsoft.network/natgateways': '2023-05-01',
    'microsoft.network/ipgroups': '2023-05-01',
    'microsoft.network/privatednszones': '2020-06-01',
    'microsoft.network/privateendpoints': '2023-05-01',
    'microsoft.network/virtualnetworkgateways': '2023-05-01',
    'microsoft.network/ddosprotectionplans': '2023-05-01',
    'microsoft.web/serverfarms': '2022-09-01',
    'microsoft.web/connections': '2016-06-01',
    'microsoft.web/certificates': '2022-09-01',
    'microsoft.sql/servers/elasticpools': '2021-11-01',
    'microsoft.compute/availabilitysets': '2023-03-01',
    'microsoft.resources/subscriptions/resourcegroups': '2021-04-01',
    // Networking Zombies (expansión): resto de tipos de red soportados por Delete.
    'microsoft.network/virtualnetworks/subnets': '2023-05-01',
    'microsoft.network/virtualhubs': '2023-05-01',
    'microsoft.network/virtualnetworks/virtualnetworkpeerings': '2023-05-01',
    'microsoft.network/azurefirewalls': '2023-05-01',
    'microsoft.network/applicationsecuritygroups': '2023-05-01',
    'microsoft.network/bastionhosts': '2023-05-01',
    'microsoft.network/frontdoors': '2022-05-01',
    'microsoft.cdn/profiles': '2023-05-01',
    'microsoft.network/dnszones': '2018-05-01',
    'microsoft.network/networkwatchers': '2023-05-01',
    'microsoft.network/networkwatchers/flowlogs': '2023-05-01',
    'microsoft.network/expressroutecircuits': '2023-05-01',
    'microsoft.network/applicationgatewaywebapplicationfirewallpolicies': '2023-05-01',
};

export async function deleteResource(tenantId: string, userEmail: string, subscriptionId: string, resourceGroup: string, resourceName: string, resourceType: string, resourceId?: string) {
    const credential = await getAzureCredential(tenantId);
    const type = resourceType.toLowerCase();
    // Si el caller ya tiene el ARM ID completo (ej. subrecursos anidados como
    // subnets, peerings o flow logs, cuyo path real no es
    // /providers/{type}/{name}), lo usamos tal cual en vez de reconstruirlo.
    const fullResourceId = resourceId || `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/${resourceType}/${resourceName}`;

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
            // Fallback genérico para cualquier recurso mediante API REST DELETE
            const apiVersion = apiVersionMap[type] || '2021-04-01';
            const tokenData = await credential.getToken("https://management.azure.com/.default");
            const url = `https://management.azure.com${fullResourceId}?api-version=${apiVersion}`;
            
            console.log(`[RemediationService] Deleting resource via REST API: ${url}`);
            const res = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${tokenData.token}`
                }
            });
            
            if (!res.ok) {
                const bodyText = await res.text().catch(() => "No response body");
                console.error(`[RemediationService] Azure REST API returned ${res.status}: ${bodyText}`);
                throw new Error(`Azure API error ${res.status}: ${bodyText}`);
            }
            result = { success: true };
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
        // `beginUpdate` (no `beginUpdateAndWait`): el PATCH inicial se envía y
        // los errores sincrónicos de Azure (SKU no disponible en la región, VM
        // que debe estar desasignada, cuota) siguen llegando acá, pero no se
        // espera a que termine el resize. Esperarlo tardaba minutos y el proxy
        // cortaba el request antes de que la UI supiera si había arrancado.
        await client.virtualMachines.beginUpdate(resourceGroup, vmName, {
            hardwareProfile: { vmSize: newSku }
        });
        await logAction(tenantId, userEmail, "DOWNGRADE_VM", fullResourceId, "SUCCESS");
        return { started: true, resourceId: fullResourceId, newSku };
    } catch (e) {
        await logAction(tenantId, userEmail, "DOWNGRADE_VM", fullResourceId, "FAILED");
        throw e;
    }
}
