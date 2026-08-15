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
            breakdownType: 'namespace',
        };
    }

    let totalClusterCost = 0;
    const costByResourceId = new Map<string, number>();
    const costByResourceType = new Map<string, number>();

    try {
        const credential = await getAzureCredential(tenantId);
        const costClient = new CostManagementClient(credential);
        const scope = `/subscriptions/${subscriptionId}/resourceGroups/${nodeResourceGroup}`;

        // 1. Intentar consulta agregada y por ResourceId / ResourceType
        try {
            const costRes = await costClient.query.usage(scope, {
                type: "ActualCost",
                timeframe: "MonthToDate",
                dataset: {
                    granularity: "None",
                    aggregation: {
                        totalCost: { name: "Cost", function: "Sum" }
                    },
                    grouping: [
                        { type: "Dimension", name: "ResourceId" },
                        { type: "Dimension", name: "ResourceType" }
                    ]
                }
            });

            if (costRes.rows && costRes.rows.length > 0) {
                for (const row of costRes.rows) {
                    const costVal = Number(row[0]) || 0;
                    const resId = String(row[1] || "").toLowerCase();
                    const resType = String(row[2] || "").toLowerCase();

                    totalClusterCost += costVal;
                    if (resId) costByResourceId.set(resId, (costByResourceId.get(resId) || 0) + costVal);
                    if (resType) costByResourceType.set(resType, (costByResourceType.get(resType) || 0) + costVal);
                }
            }
        } catch {
            // Fallback a consulta simple sin agrupación si la API rechaza dimensiones compuestas
            const simpleCostRes = await costClient.query.usage(scope, {
                type: "ActualCost",
                timeframe: "MonthToDate",
                dataset: {
                    granularity: "None",
                    aggregation: {
                        totalCost: { name: "Cost", function: "Sum" }
                    }
                }
            });
            if (simpleCostRes.rows && simpleCostRes.rows.length > 0) {
                totalClusterCost = Number(simpleCostRes.rows[0][0]) || 0;
            }
        }
    } catch (e: any) {
        console.warn(`[AKS Chargeback] Sin costo para nodeRG ${nodeResourceGroup}:`, e?.message);
    }

    // 2. Consultar Azure Resource Graph para obtener todos los Node Pools (VMSS), discos y networking del clúster
    let totalClusterCpuCores = 0;
    interface NodePoolInfo {
        name: string;
        resourceId: string;
        cores: number;
        nodeCount: number;
        sku: string;
    }
    const nodePools: NodePoolInfo[] = [];
    let totalStorageCost = 0;
    let totalNetworkCost = 0;

    try {
        const argClient = await getResourceGraphClient(tenantId);
        const query = `
            Resources
            | where resourceGroup =~ '${nodeResourceGroup}'
            | project id, name, type, skuCapacity = toint(sku.capacity), vmSize = tostring(sku.name), tags, poolName = tostring(tags['aks-managed-poolName'])
        `;
        const resARG = await argClient.resources({ query });
        const items = (resARG.data as any[]) || [];

        for (const item of items) {
            const rType = String(item?.type || "").toLowerCase();
            const rId = String(item?.id || "").toLowerCase();
            const rName = String(item?.name || "");

            if (rType === 'microsoft.compute/virtualmachinescalesets') {
                const coresPerInstance = vmSizeToCores(item?.vmSize);
                const capacity = Number(item?.skuCapacity) || 1;
                const poolCores = capacity * coresPerInstance;
                totalClusterCpuCores += poolCores;

                // Extraer el nombre amigable del Node Pool
                let poolName = String(item?.poolName || "").trim();
                if (!poolName) {
                    // Si no tiene tag, extraer del prefijo aks-<poolName>-...
                    const match = rName.match(/^aks-([a-zA-Z0-9]+)-/i);
                    poolName = match ? match[1] : rName;
                }

                nodePools.push({
                    name: poolName,
                    resourceId: rId,
                    cores: poolCores,
                    nodeCount: capacity,
                    sku: String(item?.vmSize || "Standard"),
                });
            } else if (rType.includes('disks') || rType.includes('storage')) {
                totalStorageCost += costByResourceId.get(rId) || 0;
            } else if (rType.includes('loadbalancers') || rType.includes('publicipaddresses') || rType.includes('virtualnetworks')) {
                totalNetworkCost += costByResourceId.get(rId) || 0;
            }
        }
    } catch (e: any) {
        console.warn("[AKS Chargeback] Error en ARG para nodeRG:", e?.message);
    }

    // 3. Atribución granular de costos por Node Pool & Cargas de Trabajo (Opción 3)
    const chargebackData: Array<{
        namespace: string;
        cpuCores: number;
        computeCost: number;
        storageCost: number;
        totalCost: number;
    }> = [];

    if (nodePools.length > 0) {
        // Distribuir el costo de almacenamiento y networking proporcionalmente o como categorías dedicadas
        const storagePerCore = totalClusterCpuCores > 0 ? totalStorageCost / totalClusterCpuCores : 0;

        for (const poolItem of nodePools) {
            let computeCost = costByResourceId.get(poolItem.resourceId) || 0;
            
            // Si el costo no vino por ResourceId exacto, asignar proporcional a los núcleos de cómputo
            if (computeCost === 0 && totalClusterCost > 0 && totalClusterCpuCores > 0) {
                const basePoolFraction = poolItem.cores / totalClusterCpuCores;
                computeCost = Number((totalClusterCost * basePoolFraction * 0.85).toFixed(2));
            }

            const poolStorageCost = Number((poolItem.cores * storagePerCore).toFixed(2));
            const poolTotal = Number((computeCost + poolStorageCost).toFixed(2));

            chargebackData.push({
                namespace: `nodepool: ${poolItem.name}`,
                cpuCores: poolItem.cores,
                computeCost: Number(computeCost.toFixed(2)),
                storageCost: poolStorageCost,
                totalCost: poolTotal,
            });
        }

        // Si hay costos de red o infraestructura compartida detectados, agregarlos claramente
        if (totalNetworkCost > 0 || totalStorageCost > 0) {
            const otherCost = Number((totalNetworkCost).toFixed(2));
            if (otherCost > 0) {
                chargebackData.push({
                    namespace: "infra: networking & load-balancers",
                    cpuCores: 0,
                    computeCost: 0,
                    storageCost: 0,
                    totalCost: otherCost,
                });
            }
        }
    } else {
        // Si no se encontraron VMSS directamente, mostrar costo del clúster con desglose de cómputo base
        chargebackData.push({
            namespace: "nodepool: systempool (default)",
            cpuCores: totalClusterCpuCores || 2,
            computeCost: Number((totalClusterCost * 0.85).toFixed(2)),
            storageCost: Number((totalClusterCost * 0.15).toFixed(2)),
            totalCost: Number(totalClusterCost.toFixed(2)),
        });
    }

    // Log de auditoría
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
        totalClusterCost: Number(totalClusterCost.toFixed(2)),
        totalClusterCpuCores,
        chargebackData,
        namespaceBreakdownAvailable: true,
        breakdownType: 'nodepool',
    };
};
