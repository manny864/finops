import { CloudProvider } from './types';
import { getAzureCredential } from '@/lib/azure';
import { CostManagementClient } from "@azure/arm-costmanagement";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";

export class AzureProvider implements CloudProvider {
    async getBillingData(tenantId: string, subscriptionId: string, timeframe: string = 'MonthToDate'): Promise<any> {
        const credential = await getAzureCredential(tenantId);
        const client = new CostManagementClient(credential);
        const scope = subscriptionId === 'All' 
            ? `/providers/Microsoft.Management/managementGroups/${tenantId}` 
            : `/subscriptions/${subscriptionId}`;

        const parameters = {
            type: "Usage",
            timeframe: timeframe,
            dataset: {
                granularity: "None",
                aggregation: {
                    totalCost: { name: "PreTaxCost", function: "Sum" }
                }
            }
        };

        return await client.query.usage(scope, parameters as any);
    }

    async getActiveResources(tenantId: string, subscriptionId: string, resourceType: string = 'Microsoft.Compute/virtualMachines'): Promise<any[]> {
        const credential = await getAzureCredential(tenantId);
        const client = new ResourceGraphClient(credential);
        
        let subFilter = `| where subscriptionId =~ '${subscriptionId}'`;
        if (subscriptionId === 'All') subFilter = '';

        const query = `
            Resources
            | where type =~ '${resourceType}'
            ${subFilter}
            | project name, type, location, tags, sku, properties
        `;
        
        const result = await client.resources({ query });
        return result.data as any[];
    }

    async getRecommendations(tenantId: string, subscriptionId: string): Promise<any[]> {
        // Implement generic recommendations fetcher bridging Advisor APIs
        return [];
    }
}
