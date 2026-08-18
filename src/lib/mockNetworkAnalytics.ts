import {
    NetworkAnalyticsKpis,
    NetworkAnalyticsResponse,
    NetworkRemediationAction,
    NetworkResourceDetail,
    NetworkServiceCostBreakdown,
} from "@/types/networkAnalytics.types";

export const NETWORK_SERVICE_COLORS: Record<string, string> = {
    "Load Balancers": "#0078D4",           // Azul corporativo profundo
    "Virtual Networks": "#2563EB",         // Azul cobalto
    "Private Endpoints": "#0284C7",        // Azul cian intermedio
    "Public IP": "#38BDF8",                // Azul cielo suave
    "NAT Gateway": "#60A5FA",              // Azul cielo intermedio
    "Virtual Network Gateway": "#1D4ED8",  // Azul marino
    "Application Gateway": "#0369A1",      // Azul petróleo
    "Azure Firewall": "#1E40AF",           // Azul real oscuro
    "Private DNS Zones": "#93C5FD",        // Azul hielo
    "Route Tables (UDR)": "#94A3B8",       // Slate suave
    "Network Security Groups (NSG)": "#CBD5E1", // Gris azulado claro
    "Other": "#64748B",
};

/**
 * Genera el payload de demostración para Análisis de Red, escalado por tier.
 * Código 100% aislado de dependencias de Node.js (seguro para Client Components).
 */
export function getMockNetworkAnalyticsResponse(tierParam?: string | number): NetworkAnalyticsResponse {
    const tier = typeof tierParam === "string" ? tierParam.toLowerCase() : tierParam === 3 ? "enterprise" : tierParam === 2 ? "business" : "pro";
    const multiplier = tier === "enterprise" ? 50 : tier === "business" ? 10 : tier === "pro" || tier === "professional" ? 3 : 1;

    const baseCost = 13.24 * multiplier;
    const projectedRunRate = Number((baseCost * 1.08).toFixed(2));
    const billableEgressGb = Number((145.8 * multiplier).toFixed(1));

    const resources: NetworkResourceDetail[] = [
        {
            id: "/subscriptions/mock-sub-1/resourceGroups/rg-prod-network/providers/Microsoft.Network/loadBalancers/lb-prod-app-01",
            name: "lb-prod-app-01",
            serviceType: "Load Balancers",
            serviceLabel: "Load Balancer",
            publicIpAddress: "20.40.10.45",
            resourceGroup: "rg-prod-network",
            subscriptionId: "mock-sub-1",
            subscriptionName: "Corporate Production",
            costCenterOwner: "Platform Team",
            creationDate: "2025-11-10T14:20:00Z",
            location: "eastus",
            monthlyCostUSD: Number((4.80 * (multiplier > 1 ? multiplier * 0.4 : 1)).toFixed(2)),
            isOrphan: false,
            details: {
                sku: "Standard",
                provisioningState: "Succeeded",
                backendPoolCount: 3,
                processedGbMtd: Number((450 * multiplier).toFixed(1)),
                associatedResource: "vmss-payment-gateway",
            },
        },
        {
            id: "/subscriptions/mock-sub-1/resourceGroups/rg-prod-network/providers/Microsoft.Network/virtualNetworks/vnet-hub-prod",
            name: "vnet-hub-prod",
            serviceType: "Virtual Networks",
            serviceLabel: "Virtual Network",
            publicIpAddress: "-",
            resourceGroup: "rg-prod-network",
            subscriptionId: "mock-sub-1",
            subscriptionName: "Corporate Production",
            costCenterOwner: "Core Networking",
            creationDate: "2025-10-01T08:00:00Z",
            location: "eastus",
            monthlyCostUSD: Number((3.50 * (multiplier > 1 ? multiplier * 0.3 : 1)).toFixed(2)),
            isOrphan: false,
            details: {
                subnetsCount: 6,
                linkedVnetsCount: 4,
                egressGbMtd: Number((820 * multiplier).toFixed(1)),
            },
        },
        {
            id: "/subscriptions/mock-sub-2/resourceGroups/rg-staging/providers/Microsoft.Network/publicIPAddresses/pip-legacy-ingress",
            name: "pip-legacy-ingress",
            serviceType: "Public IP",
            serviceLabel: "Public IP",
            publicIpAddress: "51.140.88.12",
            resourceGroup: "rg-staging",
            subscriptionId: "mock-sub-2",
            subscriptionName: "Staging Workloads",
            costCenterOwner: "DevOps Operations",
            creationDate: "2025-12-04T11:15:00Z",
            location: "westeurope",
            monthlyCostUSD: Number((3.65 * (multiplier > 1 ? multiplier * 0.25 : 1)).toFixed(2)),
            isOrphan: true,
            orphanReason: "IP pública sin asociación a NIC, Load Balancer ni Application Gateway (properties.ipConfiguration es nulo).",
            details: {
                sku: "Standard",
                provisioningState: "Succeeded",
                associatedResource: "Ninguno (Desvinculada)",
            },
        },
        {
            id: "/subscriptions/mock-sub-1/resourceGroups/rg-data-platform/providers/Microsoft.Network/privateEndpoints/pe-datalake-blob",
            name: "pe-datalake-blob",
            serviceType: "Private Endpoints",
            serviceLabel: "Private Endpoint",
            publicIpAddress: "10.240.4.12",
            resourceGroup: "rg-data-platform",
            subscriptionId: "mock-sub-1",
            subscriptionName: "Corporate Production",
            costCenterOwner: "Data Engineering",
            creationDate: "2026-01-15T09:30:00Z",
            location: "eastus",
            monthlyCostUSD: Number((1.29 * (multiplier > 1 ? multiplier * 0.15 : 1)).toFixed(2)),
            isOrphan: false,
            details: {
                provisioningState: "Succeeded",
                associatedResource: "stfinancedatalake.blob.core.windows.net",
                processedGbMtd: Number((1200 * multiplier).toFixed(1)),
            },
        },
        {
            id: "/subscriptions/mock-sub-1/resourceGroups/rg-data-platform/providers/Microsoft.Network/privateDnsZones/privatelink.blob.core.windows.net",
            name: "privatelink.blob.core.windows.net",
            serviceType: "Private DNS Zones",
            serviceLabel: "Private DNS Zone",
            publicIpAddress: "-",
            resourceGroup: "rg-data-platform",
            subscriptionId: "mock-sub-1",
            subscriptionName: "Corporate Production",
            costCenterOwner: "Core Networking",
            creationDate: "2025-10-01T08:00:00Z",
            location: "global",
            monthlyCostUSD: Number((0.50 * (multiplier > 1 ? multiplier * 0.1 : 1)).toFixed(2)),
            isOrphan: false,
            details: {
                linkedVnetsCount: 5,
            },
        },
    ];

    if (multiplier >= 3) {
        resources.push(
            {
                id: "/subscriptions/mock-sub-2/resourceGroups/rg-dev-sandbox/providers/Microsoft.Network/publicIPAddresses/pip-test-vm-02",
                name: "pip-test-vm-02",
                serviceType: "Public IP",
                serviceLabel: "Public IP",
                publicIpAddress: "40.114.33.91",
                resourceGroup: "rg-dev-sandbox",
                subscriptionId: "mock-sub-2",
                subscriptionName: "Staging Workloads",
                costCenterOwner: "QA Team",
                creationDate: "2026-02-01T16:00:00Z",
                location: "eastus2",
                monthlyCostUSD: 3.65,
                isOrphan: true,
                orphanReason: "IP pública reservada huérfana de VM de pruebas dada de baja.",
                details: {
                    sku: "Standard",
                    provisioningState: "Succeeded",
                    associatedResource: "Ninguno",
                },
            },
            {
                id: "/subscriptions/mock-sub-3/resourceGroups/rg-hybrid-core/providers/Microsoft.Network/natGateways/nat-dev-outbound",
                name: "nat-dev-outbound",
                serviceType: "NAT Gateway",
                serviceLabel: "NAT Gateway",
                publicIpAddress: "20.50.12.99",
                resourceGroup: "rg-hybrid-core",
                subscriptionId: "mock-sub-3",
                subscriptionName: "Enterprise Shared Infrastructure",
                costCenterOwner: "Infrastructure",
                creationDate: "2026-01-20T10:00:00Z",
                location: "eastus",
                monthlyCostUSD: Number((32.50 * (multiplier > 10 ? 2 : 1)).toFixed(2)),
                isOrphan: false,
                details: {
                    sku: "Standard",
                    processedGbMtd: 0.4,
                    associatedResource: "subnet-dev-isolated",
                },
            }
        );
    }

    const orphanIps = resources.filter((r) => r.serviceType === "Public IP" && r.isOrphan);
    const orphanIpsCount = orphanIps.length;
    const orphanIpsSavings = Number(orphanIps.reduce((acc, r) => acc + r.monthlyCostUSD, 0).toFixed(2));

    const remediations: NetworkRemediationAction[] = [
        {
            id: "rem-pip-01",
            resourceId: "/subscriptions/mock-sub-2/resourceGroups/rg-staging/providers/Microsoft.Network/publicIPAddresses/pip-legacy-ingress",
            resourceName: "pip-legacy-ingress",
            title: "Eliminar IP Pública Huérfana",
            description: "La dirección IP 51.140.88.12 no tiene ninguna interfaz de red, balanceador ni Application Gateway vinculado. Genera costo fijo continuo sin transferir tráfico.",
            category: "ORPHAN_IP",
            estimatedSavingsUSD: 3.65 * (multiplier > 1 ? 2 : 1),
            confidence: "HIGH",
            actionType: "DELETE",
            commandPayload: {
                cli: `az network public-ip delete \\\n  --name "pip-legacy-ingress" \\\n  --resource-group "rg-staging" \\\n  --subscription "mock-sub-2"`,
                powershell: `Remove-AzPublicIpAddress \`\n  -Name "pip-legacy-ingress" \`\n  -ResourceGroupName "rg-staging" \`\n  -Force`,
                impactSummary: "Sin impacto operacional. El recurso no tiene tráfico ni endpoints vinculados.",
            },
        },
        {
            id: "rem-nat-01",
            resourceId: "/subscriptions/mock-sub-3/resourceGroups/rg-hybrid-core/providers/Microsoft.Network/natGateways/nat-dev-outbound",
            resourceName: "nat-dev-outbound",
            title: "Racionalizar NAT Gateway en Ambiente Dev",
            description: "NAT Gateway con costo fijo de $32.50/mes procesando menos de 1 GB/mes. Reemplazar por Default Outbound o desasociar en horarios no laborables.",
            category: "NAT_RIGHTSIZING",
            estimatedSavingsUSD: 32.50,
            confidence: "MEDIUM",
            actionType: "DOWNSIZE",
            commandPayload: {
                cli: `# Desvincular NAT Gateway de la subnet no productiva\naz network vnet subnet update \\\n  --name "subnet-dev-isolated" \\\n  --vnet-name "vnet-dev" \\\n  --resource-group "rg-hybrid-core" \\\n  --nat-gateway null`,
                powershell: `$subnet = Get-AzVirtualNetworkSubnetConfig -Name "subnet-dev-isolated" -VirtualNetwork (Get-AzVirtualNetwork -Name "vnet-dev" -ResourceGroupName "rg-hybrid-core")\n$subnet.NatGateway = $null\nSet-AzVirtualNetwork -VirtualNetwork (Get-AzVirtualNetwork -Name "vnet-dev" -ResourceGroupName "rg-hybrid-core")`,
                impactSummary: "Las instancias en la subnet usarán Azure Default Outbound si no requieren IP pública estática.",
            },
        },
        {
            id: "rem-pe-01",
            resourceId: "/subscriptions/mock-sub-1/resourceGroups/rg-data-platform/providers/Microsoft.Network/privateEndpoints/pe-datalake-blob",
            resourceName: "pe-datalake-blob",
            title: "Revisar Private Endpoint vs Service Endpoints",
            description: "Evaluar el uso de Service Endpoints (gratuitos) para tráfico interno dentro de la misma región Azure.",
            category: "PE_OPTIMIZATION",
            estimatedSavingsUSD: 7.20,
            confidence: "LOW",
            actionType: "RECONFIGURE",
            commandPayload: {
                cli: `# Habilitar Service Endpoint para Microsoft.Storage en la VNet interna\naz network vnet subnet update \\\n  --name "snet-backend" \\\n  --vnet-name "vnet-hub-prod" \\\n  --resource-group "rg-prod-network" \\\n  --service-endpoints "Microsoft.Storage"`,
                powershell: `Get-AzVirtualNetwork -Name "vnet-hub-prod" -ResourceGroupName "rg-prod-network" | Set-AzVirtualNetworkSubnetConfig -Name "snet-backend" -ServiceEndpoint "Microsoft.Storage" | Set-AzVirtualNetwork`,
                impactSummary: "Tráfico de alta velocidad sobre backbone de Azure sin costo de procesamiento de datos por GB.",
            },
        },
    ];

    const serviceCostMap = new Map<string, { cost: number; count: number }>();
    for (const res of resources) {
        const entry = serviceCostMap.get(res.serviceType) || { cost: 0, count: 0 };
        entry.cost += res.monthlyCostUSD;
        entry.count += 1;
        serviceCostMap.set(res.serviceType, entry);
    }

    const totalCalculatedCost = Array.from(serviceCostMap.values()).reduce((sum, v) => sum + v.cost, 0);

    const serviceBreakdown: NetworkServiceCostBreakdown[] = Array.from(serviceCostMap.entries()).map(([serviceName, data]) => ({
        serviceName,
        totalCostUSD: Number(data.cost.toFixed(2)),
        percentage: totalCalculatedCost > 0 ? Number(((data.cost / totalCalculatedCost) * 100).toFixed(1)) : 0,
        colorHex: NETWORK_SERVICE_COLORS[serviceName] || "#0078D4",
        resourceCount: data.count,
    })).sort((a, b) => b.totalCostUSD - a.totalCostUSD);

    const kpis: NetworkAnalyticsKpis = {
        totalMonthlyCostUSD: Number(totalCalculatedCost.toFixed(2)),
        projectedRunRateUSD: projectedRunRate,
        totalResourcesCount: resources.length,
        orphanIpsCount,
        orphanIpsPotentialSavingsUSD: orphanIpsSavings,
        billableEgressGb,
        potentialTotalSavingsUSD: Number(remediations.reduce((sum, r) => sum + r.estimatedSavingsUSD, 0).toFixed(2)),
    };

    return {
        success: true,
        mock: true,
        kpis,
        serviceBreakdown,
        resources,
        remediations,
    };
}
