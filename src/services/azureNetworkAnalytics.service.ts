import { getResourceGraphClient, getAzureCredential } from "@/lib/azure";
import pool from "@/modules/storage/db";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { getResourceCostsById } from "@/modules/collectors/azure/resourceInventoryService";
import { getCurrentMonthAmortizedCosts } from "@/modules/collectors/azure/billingService";
import {
    NetworkAnalyticsKpis,
    NetworkAnalyticsResponse,
    NetworkRemediationAction,
    NetworkResourceDetail,
    NetworkServiceCostBreakdown,
    NetworkServiceType,
} from "@/types/networkAnalytics.types";
import {
    getMockNetworkAnalyticsResponse,
    NETWORK_SERVICE_COLORS,
} from "@/lib/mockNetworkAnalytics";
import { errorMessage } from '@/lib/apiErrors';

export { getMockNetworkAnalyticsResponse, NETWORK_SERVICE_COLORS };

/**
 * Extrae el inventario completo de recursos de red desde Azure Resource Graph.
 */
export async function fetchLiveNetworkInventory(tenantId: string, subscriptionIds?: string[]): Promise<any[]> {
    try {
        const arg = await getResourceGraphClient(tenantId);
        const subFilter = subscriptionIds && subscriptionIds.length > 0
            ? `| where subscriptionId in~ (${subscriptionIds.map((s) => `'${s}'`).join(",")})`
            : "";

        const query = `
            Resources
            ${subFilter}
            | where type in~ (
                'microsoft.network/loadbalancers',
                'microsoft.network/virtualnetworks',
                'microsoft.network/publicipaddresses',
                'microsoft.network/privateendpoints',
                'microsoft.network/natgateways',
                'microsoft.network/virtualnetworkgateways',
                'microsoft.network/privatednszones',
                'microsoft.network/applicationgateways',
                'microsoft.network/azurefirewalls',
                'microsoft.network/networksecuritygroups',
                'microsoft.network/routetables'
            )
            | project id, name, type, resourceGroup, subscriptionId, location, tags, properties,
                     skuName = tostring(sku.name),
                     skuTier = tostring(sku.tier),
                     publicIp = tostring(properties.ipAddress),
                     ipConfig = properties.ipConfiguration,
                     provisioningState = tostring(properties.provisioningState),
                     createdAt = tostring(coalesce(
                        properties.creationTime,
                        properties.createdTime,
                        properties.timeCreated,
                        properties.provisioningTime,
                        properties.metadata.createdAt
                     ))
        `;

        const res: any = await arg.resources({ query, options: { resultFormat: "objectArray", top: 1000 } });
        return (res.data as any[]) || [];
    } catch (e) {
        console.error("[azureNetworkAnalytics] Error querying ARG:", e);
        return [];
    }
}

/**
 * Consulta los costos de red MTD por resourceId y por resourceType desde MySQL y Azure Cost Management.
 */
export async function fetchLiveNetworkCosts(tenantId: string, rawResources: any[] = []) {
    const costByResourceId = new Map<string, number>();
    const costByResourceType = new Map<string, number>();
    let totalEgressGb = 0;
    let totalNetworkCategoryCost = 0;

    try {
        // 1. Costos directos por ResourceId desde CostSnapshots
        const [resourceCostRows]: any = await pool.query(
            `SELECT LOWER(COALESCE(ResourceId, resource_id, '')) AS resourceId, SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS total
             FROM CostSnapshots
             WHERE tenant_id = ?
               AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
               AND COALESCE(ResourceId, resource_id, '') <> ''
             GROUP BY LOWER(COALESCE(ResourceId, resource_id, ''))`,
            [tenantId]
        ).catch(() => [[]]);

        for (const row of resourceCostRows || []) {
            const rid = String(row.resourceId || "").toLowerCase();
            if (rid) {
                costByResourceId.set(rid, Number(row.total || 0));
            }
        }

        // 2. Costos por tipo de recurso desde CostCategorySnapshots
        const [categoryCostRows]: any = await pool.query(
            `SELECT LOWER(resource_type) AS resourceType, SUM(cost_usd) AS total
             FROM CostCategorySnapshots
             WHERE tenant_id = ?
               AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
             GROUP BY LOWER(resource_type)`,
            [tenantId]
        ).catch(() => [[]]);

        for (const row of categoryCostRows || []) {
            const rt = String(row.resourceType || "").toLowerCase();
            const cost = Number(row.total || 0);
            costByResourceType.set(rt, cost);
            if (rt.includes("network") || rt.includes("bandwidth") || rt.includes("ip")) {
                totalNetworkCategoryCost += cost;
            }
        }

        // 3. Telemetría de medidores de red y Egress / Bandwidth desde CostMeterSnapshots
        const [meterRows]: any = await pool.query(
            `SELECT 
                LOWER(MeterName) AS meterName,
                LOWER(MeterCategory) AS meterCategory,
                LOWER(MeterSubCategory) AS meterSubCategory,
                LOWER(service_name) AS serviceName,
                SUM(cost_usd) AS totalCost,
                SUM(COALESCE(Quantity, 0)) AS totalQuantity
             FROM CostMeterSnapshots
             WHERE tenant_id = ?
               AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
               AND (
                   LOWER(service_name) LIKE '%network%'
                   OR LOWER(service_name) LIKE '%virtual network%'
                   OR LOWER(service_name) LIKE '%bandwidth%'
                   OR LOWER(MeterCategory) LIKE '%network%'
                   OR LOWER(MeterCategory) LIKE '%bandwidth%'
               )
             GROUP BY LOWER(MeterName), LOWER(MeterCategory), LOWER(MeterSubCategory), LOWER(service_name)`,
            [tenantId]
        ).catch(() => [[]]);

        for (const row of meterRows || []) {
            const meterName = String(row.meterName || "");
            const meterCategory = String(row.meterCategory || "");
            const meterSub = String(row.meterSubCategory || "");
            const isEgress = meterName.includes("egress") ||
                meterName.includes("data transfer") ||
                meterName.includes("outbound") ||
                meterCategory.includes("bandwidth") ||
                meterSub.includes("bandwidth");

            if (isEgress) {
                totalEgressGb += Number(row.totalQuantity || 0);
            }
        }

        // 4. Si no hay costos en base de datos local para los ResourceIds descubiertos,
        // consultar en vivo directamente a Azure Cost Management API
        if (costByResourceId.size === 0 && rawResources.length > 0) {
            try {
                const queryItems = rawResources.map((r) => ({
                    id: String(r.id || ""),
                    subscriptionId: String(r.subscriptionId || ""),
                })).filter((r) => Boolean(r.id && r.subscriptionId));

                if (queryItems.length > 0) {
                    const liveCosts = await getResourceCostsById(tenantId, queryItems);
                    for (const [rid, cost] of liveCosts.entries()) {
                        costByResourceId.set(rid.toLowerCase(), cost);
                    }
                }
            } catch (e) {
                console.warn("[azureNetworkAnalytics] Error querying live getResourceCostsById:", errorMessage(e));
            }
        }

        // 5. Consulta en vivo a nivel de servicio si aún no hay costos MTD registrados
        if (costByResourceId.size === 0 && totalNetworkCategoryCost === 0) {
            try {
                const liveAmortized = await getCurrentMonthAmortizedCosts(tenantId, "All", "ActualCost");
                for (const entry of liveAmortized || []) {
                    const svc = String(entry.ServiceName || "").toLowerCase();
                    if (svc.includes("network") || svc.includes("virtual network") || svc.includes("bandwidth") || svc.includes("load balancer")) {
                        const cost = Number(entry.EffectiveCost || entry.BilledCost || 0);
                        if (cost > 0) {
                            totalNetworkCategoryCost += cost;
                        }
                    }
                }
            } catch (e) {
                console.warn("[azureNetworkAnalytics] Error querying live getCurrentMonthAmortizedCosts:", errorMessage(e));
            }
        }

        return {
            costByResourceId,
            costByResourceType,
            totalEgressGb: Number(totalEgressGb.toFixed(1)),
            totalNetworkCategoryCost: Number(totalNetworkCategoryCost.toFixed(2)),
        };
    } catch {
        return {
            costByResourceId: new Map<string, number>(),
            costByResourceType: new Map<string, number>(),
            totalEgressGb: 0,
            totalNetworkCategoryCost: 0,
        };
    }
}

function mapArmTypeToServiceType(armType: string): { serviceType: NetworkServiceType; serviceLabel: string } {
    const t = armType.toLowerCase();
    if (t.includes("loadbalancers")) return { serviceType: "Load Balancers", serviceLabel: "Load Balancer" };
    if (t.includes("virtualnetworks")) return { serviceType: "Virtual Networks", serviceLabel: "Virtual Network" };
    if (t.includes("publicipaddresses")) return { serviceType: "Public IP", serviceLabel: "Public IP" };
    if (t.includes("privateendpoints")) return { serviceType: "Private Endpoints", serviceLabel: "Private Endpoint" };
    if (t.includes("privatednszones")) return { serviceType: "Private DNS Zones", serviceLabel: "Private DNS Zone" };
    if (t.includes("natgateways")) return { serviceType: "NAT Gateway", serviceLabel: "NAT Gateway" };
    if (t.includes("virtualnetworkgateways")) return { serviceType: "Virtual Network Gateway", serviceLabel: "Virtual Network Gateway" };
    if (t.includes("applicationgateways")) return { serviceType: "Application Gateway", serviceLabel: "Application Gateway" };
    if (t.includes("azurefirewalls")) return { serviceType: "Azure Firewall", serviceLabel: "Azure Firewall" };
    if (t.includes("routetables")) return { serviceType: "Route Tables (UDR)", serviceLabel: "Route Table" };
    if (t.includes("networksecuritygroups")) return { serviceType: "Network Security Groups (NSG)", serviceLabel: "Network Security Group" };
    return { serviceType: "Other", serviceLabel: armType };
}

function parseResourceTags(tags: unknown): Record<string, string> {
    if (!tags) return {};
    if (typeof tags === "object") {
        return Object.fromEntries(Object.entries(tags as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]));
    }
    if (typeof tags === "string") {
        try {
            const parsed = JSON.parse(tags);
            if (parsed && typeof parsed === "object") {
                return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]));
            }
        } catch {
            return {};
        }
    }
    return {};
}

function resolveOwnerFromTags(tags: Record<string, string>): string {
    const entries = Object.entries(tags);
    const get = (key: string) => entries.find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
    return get("CostOwner") || get("Owner") || get("CostCenterOwner") || get("CostCenter") || get("OwnerGroup") || "-";
}

/**
 * Procesa recursos de red reales y genera el análisis FinOps sin fallbacks a mock.
 */
export async function computeLiveNetworkAnalytics(tenantId: string, subscriptionIds?: string[]): Promise<NetworkAnalyticsResponse> {
    const rawResources = await fetchLiveNetworkInventory(tenantId, subscriptionIds);
    const { costByResourceId, costByResourceType, totalEgressGb, totalNetworkCategoryCost } = await fetchLiveNetworkCosts(tenantId, rawResources);

    if (!rawResources || rawResources.length === 0) {
        // Zero-fallback: devolver estado vacío real
        return {
            success: true,
            mock: false,
            kpis: {
                totalMonthlyCostUSD: 0,
                projectedRunRateUSD: 0,
                totalResourcesCount: 0,
                orphanIpsCount: 0,
                orphanIpsPotentialSavingsUSD: 0,
                billableEgressGb: totalEgressGb,
                potentialTotalSavingsUSD: 0,
            },
            serviceBreakdown: [],
            resources: [],
            remediations: [],
        };
    }

    const credential = await getAzureCredential(tenantId).catch(() => null);
    const subNameMap = credential ? await getSubscriptionNameMap(tenantId, credential).catch(() => new Map<string, string>()) : new Map<string, string>();

    // Contar cuántos recursos hay por tipo para distribuir costos de categoría si no hay costo por ResourceId
    const countByArmType = new Map<string, number>();
    for (const r of rawResources) {
        const t = String(r.type || "").toLowerCase();
        countByArmType.set(t, (countByArmType.get(t) || 0) + 1);
    }

    const resources: NetworkResourceDetail[] = [];
    const remediations: NetworkRemediationAction[] = [];

    for (const raw of rawResources) {
        const id = String(raw.id || "");
        const normId = id.toLowerCase();
        const armType = String(raw.type || "").toLowerCase();
        const { serviceType, serviceLabel } = mapArmTypeToServiceType(armType);
        const name = String(raw.name || "");
        const resourceGroup = String(raw.resourceGroup || "");
        const subscriptionId = String(raw.subscriptionId || "");
        const subscriptionName = resolveSubscriptionName(subscriptionId, subNameMap);
        const tags = parseResourceTags(raw.tags);
        const costCenterOwner = resolveOwnerFromTags(tags);
        const location = String(raw.location || "");
        const creationDate = String(raw.createdAt || "");

        // Costo directo o atribuido proporcionalmente
        let monthlyCostUSD = costByResourceId.get(normId) || 0;
        if (monthlyCostUSD === 0 && costByResourceType.has(armType)) {
            const categoryCost = costByResourceType.get(armType) || 0;
            const count = countByArmType.get(armType) || 1;
            monthlyCostUSD = categoryCost / Math.max(count, 1);
        }
        monthlyCostUSD = Number(monthlyCostUSD.toFixed(2));

        let isOrphan = false;
        let orphanReason: string | undefined;

        // Detección 1: IPs Públicas Huérfanas
        if (serviceType === "Public IP") {
            const hasIpConfig = Boolean(raw.ipConfig && (raw.ipConfig.id || typeof raw.ipConfig === "string"));
            if (!hasIpConfig) {
                isOrphan = true;
                orphanReason = "IP pública no asociada a ninguna NIC, Load Balancer ni Application Gateway.";
                remediations.push({
                    id: `rem-pip-${name}`,
                    resourceId: id,
                    resourceName: name,
                    title: `Eliminar IP Pública Huérfana (${name})`,
                    description: `La IP pública ${raw.publicIp || name} en el RG ${resourceGroup} no tiene interfaz asociada. Genera costo fijo sin uso.`,
                    category: "ORPHAN_IP",
                    estimatedSavingsUSD: monthlyCostUSD > 0 ? monthlyCostUSD : 3.65,
                    confidence: "HIGH",
                    actionType: "DELETE",
                    commandPayload: {
                        cli: `az network public-ip delete \\\n  --name "${name}" \\\n  --resource-group "${resourceGroup}" \\\n  --subscription "${subscriptionId}"`,
                        powershell: `Remove-AzPublicIpAddress -Name "${name}" -ResourceGroupName "${resourceGroup}" -Force`,
                        impactSummary: "Sin impacto operacional. No existe vínculo activo con servicios de cómputo o balanceo.",
                    },
                });
            }
        }

        // Detección 2: Load Balancers Huérfanos
        if (serviceType === "Load Balancers") {
            const backendPools = raw.properties?.backendAddressPools || [];
            const backendCount = Array.isArray(backendPools) ? backendPools.length : 0;
            if (backendCount === 0) {
                isOrphan = true;
                orphanReason = "Load Balancer sin ningún Backend Address Pool configurado.";
                remediations.push({
                    id: `rem-lb-${name}`,
                    resourceId: id,
                    resourceName: name,
                    title: `Revisar Load Balancer sin Miembros (${name})`,
                    description: `Load Balancer ${name} no tiene instancias de backend asociadas.`,
                    category: "ORPHAN_LB",
                    estimatedSavingsUSD: monthlyCostUSD > 0 ? monthlyCostUSD : 18.0,
                    confidence: "MEDIUM",
                    actionType: "DELETE",
                    commandPayload: {
                        cli: `az network lb delete \\\n  --name "${name}" \\\n  --resource-group "${resourceGroup}" \\\n  --subscription "${subscriptionId}"`,
                        powershell: `Remove-AzLoadBalancer -Name "${name}" -ResourceGroupName "${resourceGroup}" -Force`,
                        impactSummary: "Elimina el balanceador ocioso y sus reglas de NAT frontend.",
                    },
                });
            }
        }

        // Detección 3: VNet Gateways sin Conexiones
        if (serviceType === "Virtual Network Gateway") {
            if (monthlyCostUSD > 50) {
                remediations.push({
                    id: `rem-gw-${name}`,
                    resourceId: id,
                    resourceName: name,
                    title: `Auditar Virtual Network Gateway (${name})`,
                    description: `VNet Gateway con costo mensual activo ($${monthlyCostUSD}/mes). Verificar conexiones VPN/ExpressRoute vigentes.`,
                    category: "UNUSED_GATEWAY",
                    estimatedSavingsUSD: monthlyCostUSD,
                    confidence: "LOW",
                    actionType: "RECONFIGURE",
                    commandPayload: {
                        cli: `az network vnet-gateway show \\\n  --name "${name}" \\\n  --resource-group "${resourceGroup}" \\\n  --subscription "${subscriptionId}"`,
                        powershell: `Get-AzVirtualNetworkGateway -Name "${name}" -ResourceGroupName "${resourceGroup}"`,
                        impactSummary: "Verificar conexiones activas antes de cualquier acción de baja.",
                    },
                });
            }
        }

        resources.push({
            id,
            name,
            serviceType,
            serviceLabel,
            publicIpAddress: String(raw.publicIp || "-"),
            resourceGroup,
            subscriptionId,
            subscriptionName,
            costCenterOwner,
            creationDate,
            location,
            monthlyCostUSD,
            isOrphan,
            orphanReason,
            details: {
                sku: raw.skuName || raw.skuTier || undefined,
                provisioningState: raw.provisioningState || undefined,
                backendPoolCount: raw.properties?.backendAddressPools?.length,
                subnetsCount: raw.properties?.subnets?.length,
            },
        });
    }

    // Calcular distribución por servicio
    const serviceCostMap = new Map<string, { cost: number; count: number }>();
    for (const res of resources) {
        const entry = serviceCostMap.get(res.serviceType) || { cost: 0, count: 0 };
        entry.cost += res.monthlyCostUSD;
        entry.count += 1;
        serviceCostMap.set(res.serviceType, entry);
    }

    let totalCalculatedCost = Array.from(serviceCostMap.values()).reduce((sum, v) => sum + v.cost, 0);

    // Si el total acumulado de la categoría de red en facturación general supera la suma de recursos físicos
    // (por ejemplo debido a tráfico de salida / Bandwidth no asociado a un ARM ID), reflejar el remanente
    if (totalNetworkCategoryCost > totalCalculatedCost) {
        const bandwidthCost = totalNetworkCategoryCost - totalCalculatedCost;
        const entry = serviceCostMap.get("Other") || { cost: 0, count: 0 };
        entry.cost += bandwidthCost;
        serviceCostMap.set("Other", entry);
        totalCalculatedCost = totalNetworkCategoryCost;
    }

    const serviceBreakdown: NetworkServiceCostBreakdown[] = Array.from(serviceCostMap.entries()).map(([serviceName, data]) => ({
        serviceName,
        totalCostUSD: Number(data.cost.toFixed(2)),
        percentage: totalCalculatedCost > 0 ? Number(((data.cost / totalCalculatedCost) * 100).toFixed(1)) : 0,
        colorHex: NETWORK_SERVICE_COLORS[serviceName] || "#0078D4",
        resourceCount: data.count,
    })).sort((a, b) => b.totalCostUSD - a.totalCostUSD);

    const orphanIps = resources.filter((r) => r.serviceType === "Public IP" && r.isOrphan);
    const orphanIpsCount = orphanIps.length;
    const orphanIpsSavings = Number(orphanIps.reduce((acc, r) => acc + (r.monthlyCostUSD > 0 ? r.monthlyCostUSD : 3.65), 0).toFixed(2));

    const totalMonthlyCostUSD = Number(totalCalculatedCost.toFixed(2));
    const now = new Date();
    const daysElapsed = Math.max(1, now.getDate());
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const projectedRunRateUSD = totalMonthlyCostUSD > 0
        ? Number(((totalMonthlyCostUSD / daysElapsed) * daysInMonth).toFixed(2))
        : 0;

    const kpis: NetworkAnalyticsKpis = {
        totalMonthlyCostUSD,
        projectedRunRateUSD,
        totalResourcesCount: resources.length,
        orphanIpsCount,
        orphanIpsPotentialSavingsUSD: orphanIpsSavings,
        billableEgressGb: totalEgressGb,
        potentialTotalSavingsUSD: Number(remediations.reduce((sum, r) => sum + r.estimatedSavingsUSD, 0).toFixed(2)),
    };

    return {
        success: true,
        mock: false,
        kpis,
        serviceBreakdown,
        resources,
        remediations,
    };
}
