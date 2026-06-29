import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";

/**
 * Mapa de SKUs de VM Azure → vCPUs.
 * Cubre familias B / D / E / F / Dasv5 / Easv5, etc.
 * Si no hay match, se cae a un parser regex conservador.
 */
const VM_CORES_OVERRIDES: Record<string, number> = {
    // B-series burstable
    "Standard_B1s": 1, "Standard_B1ms": 1, "Standard_B2s": 2, "Standard_B2ms": 2,
    "Standard_B4ms": 4, "Standard_B8ms": 8, "Standard_B12ms": 12, "Standard_B16ms": 16, "Standard_B20ms": 20,
    // DS v2 (irregular: el número NO == vCPUs)
    "Standard_DS11_v2": 2, "Standard_DS12_v2": 4, "Standard_DS13_v2": 8, "Standard_DS14_v2": 16, "Standard_DS15_v2": 20,
    "Standard_D11_v2": 2, "Standard_D12_v2": 4, "Standard_D13_v2": 8, "Standard_D14_v2": 16, "Standard_D15_v2": 20,
    // E v2 irregulares
    "Standard_E16_v2": 16, "Standard_E32_v2": 32, "Standard_E64_v2": 64,
};

export function vmSizeToCores(vmSize: string | undefined | null): number {
    if (!vmSize || typeof vmSize !== 'string') return 2;
    if (VM_CORES_OVERRIDES[vmSize]) return VM_CORES_OVERRIDES[vmSize];
    // Genérico: Standard_<Family><Size><Features>_<Gen>. Para la mayoría de SKUs Dv3+, Ev3+, Fv2 el "Size" == vCPUs.
    const m = vmSize.match(/^Standard_[A-Za-z]+(\d+)[A-Za-z]*(_v\d+)?(_Promo)?$/i);
    if (m && m[1]) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > 0 && n <= 256) return n;
    }
    return 2;
}

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
            chargebackData,
            namespaceBreakdownAvailable: true,
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
                    totalCost: { name: "Cost", function: "Sum" }
                }
            }
        });

        if (costRes.rows && costRes.rows.length > 0) {
            totalClusterCost = Number(costRes.rows[0][0]) || 0;
        }
    } catch (e: any) {
        console.warn(`[AKS Chargeback] Sin costo para nodeRG ${nodeResourceGroup}:`, e?.message);
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
        const vmss = (resARG.data as any[]) || [];

        for (const set of vmss) {
            const coresPerInstance = vmSizeToCores(set?.vmSize);
            const capacity = Number(set?.skuCapacity) || 1;
            totalClusterCpuCores += capacity * coresPerInstance;
        }
    } catch (e: any) {
        console.warn("[AKS Chargeback] No se pudo obtener VMSS del nodeRG:", e?.message);
    }

    // Sin integración con OpenCost / Prometheus / Kube API no podemos atribuir costo por namespace.
    // Devolvemos el agregado del cluster y una bandera honesta para que la UI muestre el aviso.
    const chargebackData = [
        {
            namespace: 'cluster-aggregate',
            cpuCores: totalClusterCpuCores,
            computeCost: totalClusterCost,
            storageCost: 0,
            totalCost: totalClusterCost
        }
    ];

    // Log de auditoría (esquema actual de ActionLogs: tenant_id, user_email, action_type, resource_id, status).
    try {
        await pool.query(
            `INSERT INTO ActionLogs (tenant_id, user_email, action_type, resource_id, status)
             VALUES (?, ?, ?, ?, ?)`,
            [tenantId, 'system@aks-cost', 'AksChargebackReport', clusterName, 'Success']
        );
    } catch (e: any) {
        console.warn("[AKS Chargeback] No se pudo registrar el log de auditoría:", e?.message);
    }

    return {
        clusterName,
        totalClusterCost,
        totalClusterCpuCores,
        chargebackData,
        namespaceBreakdownAvailable: false,
    };
};
