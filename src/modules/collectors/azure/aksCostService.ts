import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";

export const getAksChargebackCost = async (tenantId: string, subscriptionId: string, clusterName: string, nodeResourceGroup: string) => {
    if (isMockTenant(tenantId)) {
        const totalClusterCost = 10000;
        const totalClusterCpuCores = 100;
        const costPerCore = totalClusterCost / totalClusterCpuCores;

        const namespaceMetrics = [
            { namespace: 'default', cpuRequests: 5, storageGb: 100 },
            { namespace: 'kube-system', cpuRequests: 10, storageGb: 50 },
            { namespace: 'frontend', cpuRequests: 20, storageGb: 200 },
            { namespace: 'backend-api', cpuRequests: 40, storageGb: 500 },
            { namespace: 'data-processing', cpuRequests: 15, storageGb: 1000 },
            { namespace: 'idle-capacity', cpuRequests: 10, storageGb: 0 },
        ];

        const storageCostPerGb = 0.15;

        const chargebackData = namespaceMetrics.map(ns => {
            const computeCost = ns.cpuRequests * costPerCore;
            const storageCost = ns.storageGb * storageCostPerGb;
            return {
                namespace: ns.namespace,
                cpuCores: ns.cpuRequests,
                computeCost,
                storageCost,
                totalCost: computeCost + storageCost
            };
        });

        return {
            clusterName: clusterName || "demo-aks-cluster",
            totalClusterCost,
            totalClusterCpuCores,
            chargebackData
        };
    }

    let totalClusterCost = 0;
    
    try {
        const credential = await getAzureCredential(tenantId);
        const costClient = new CostManagementClient(credential);
        
        const scope = `/subscriptions/${subscriptionId}/resourceGroups/${nodeResourceGroup}`;
        
        const costRes = await costClient.query.usage(scope, {
            type: "ActualCost",
            timeframe: "MonthToDate",
            dataset: {
                granularity: "None",
                aggregation: {
                    totalCost: {
                        name: "Cost",
                        function: "Sum"
                    }
                }
            }
        });

        if (costRes.rows && costRes.rows.length > 0) {
            totalClusterCost = costRes.rows[0][0] as number;
        }
    } catch (e) {
        console.warn(`Could not fetch cost for node resource group ${nodeResourceGroup}, defaulting to 0`, e);
    }

    let totalClusterCpuCores = 0;
    try {
        const argClient = await getResourceGraphClient(tenantId);
        const query = `
            Resources
            | where type =~ 'microsoft.compute/virtualmachinescalesets'
            | where resourceGroup =~ '${nodeResourceGroup}'
            | project skuCapacity = toint(sku.capacity), vmSize = tostring(sku.name)
        `;
        const resARG = await argClient.resources({ query });
        const vmss = resARG.data as any[];
        
        for (const set of vmss) {
            const match = set.vmSize.match(/_([a-zA-Z]+)?(\d+)/);
            const coresPerInstance = match ? parseInt(match[2], 10) : 2;
            totalClusterCpuCores += (set.skuCapacity || 1) * coresPerInstance;
        }
        
        if (totalClusterCpuCores === 0) totalClusterCpuCores = 4;
    } catch (e) {
        console.warn("Could not fetch VMSS from ARG, defaulting CPU cores", e);
        totalClusterCpuCores = 10;
    }

    const chargebackData = [
        {
            namespace: 'all-namespaces-aggregate',
            cpuCores: totalClusterCpuCores,
            computeCost: totalClusterCost,
            storageCost: 0,
            totalCost: totalClusterCost
        }
    ];

    await pool.query(
        `INSERT INTO ActionLogs (tenant_id, action_type, resource_id, resource_type, status, details, user_email) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tenantId, 'AksChargebackReport', clusterName, 'AKSCluster', 'Success', JSON.stringify({ clusterName, totalClusterCost }), 'system@aks-cost']
    );

    return {
        clusterName,
        totalClusterCost,
        totalClusterCpuCores,
        chargebackData
    };
};
