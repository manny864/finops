/**
 * realConsumptionService.ts
 * Servicio para el cómputo y enriquecimiento del Consumo Real:
 * - Share of Wallet (% sobre total)
 * - Velocidad de gasto (Daily Burn Rate y Proyección a fin de mes)
 * - Variación MoM y detección de anomalías (Spikes en últimas 48h)
 * - Desglose FOCUS a nivel de recurso (BilledCost vs. EffectiveCost)
 * - Remediaciones resolutivas por servicio dominante
 */

import Decimal from "decimal.js";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { getCurrentMonthAmortizedCosts } from "@/modules/collectors/azure/billingService";
import type {
    RealConsumptionOverview,
    ServiceConsumptionSummary,
    ServiceResourceDetail,
    ShareOfWalletItem,
} from "@/lib/realConsumptionTypes";

const THEME_COLORS = [
    "#0054A6", // Brand Deep Blue
    "#00AEEF", // Brand Bright Cyan
    "#10B981", // Emerald Green
    "#8B5CF6", // Purple
    "#F59E0B", // Amber
    "#EC4899", // Pink
    "#64748B", // Slate
    "#3B82F6", // Blue
];

/**
 * Mapeo de reglas de optimización resolutivas por tipo de servicio
 */
export function getServiceRemediationRule(serviceName: string, costMtd: number, sku?: string) {
    const s = serviceName.toLowerCase();
    if (s.includes("redis")) {
        return {
            remediationActionKey: "redis_downgrade",
            potentialSavings: Math.min(40.0, Number(new Decimal(costMtd).times(0.45).toFixed(2))),
        };
    }
    if (s.includes("search")) {
        return {
            remediationActionKey: "search_tier_review",
            potentialSavings: Math.min(50.0, Number(new Decimal(costMtd).times(0.5).toFixed(2))),
        };
    }
    if (s.includes("registry") || s.includes("acr")) {
        return {
            remediationActionKey: "acr_downgrade_basic",
            potentialSavings: Math.min(15.0, Number(new Decimal(costMtd).times(0.55).toFixed(2))),
        };
    }
    if (s.includes("container apps") || s.includes("containerapp")) {
        return {
            remediationActionKey: "container_apps_scale_to_zero",
            potentialSavings: Math.min(25.0, Number(new Decimal(costMtd).times(0.35).toFixed(2))),
        };
    }
    if (s.includes("foundry") || s.includes("cognitive") || s.includes("openai") || s.includes("ai")) {
        return {
            remediationActionKey: "foundry_quota_limit",
            potentialSavings: Math.min(30.0, Number(new Decimal(costMtd).times(0.4).toFixed(2))),
        };
    }
    if (s.includes("virtual network") || s.includes("network") || s.includes("load balancer") || s.includes("ip")) {
        return {
            remediationActionKey: "vnet_ip_audit",
            potentialSavings: Math.min(30.0, Number(new Decimal(costMtd).times(0.55).toFixed(2))),
        };
    }
    if (s.includes("virtual machine") || s.includes("compute")) {
        return {
            remediationActionKey: "vm_power_schedule",
            potentialSavings: Math.min(35.0, Number(new Decimal(costMtd).times(0.4).toFixed(2))),
        };
    }
    if (s.includes("storage")) {
        return {
            remediationActionKey: "storage_lifecycle",
            potentialSavings: Math.min(20.0, Number(new Decimal(costMtd).times(0.3).toFixed(2))),
        };
    }
    return {
        remediationActionKey: "generic_optimize",
        potentialSavings: Math.min(10.0, Number(new Decimal(costMtd).times(0.15).toFixed(2))),
    };
}

/**
 * Obtiene el icono representativo del servicio
 */
export function getServiceIconName(serviceName: string): string {
    const s = serviceName.toLowerCase();
    if (s.includes("redis")) return "database";
    if (s.includes("search")) return "search";
    if (s.includes("registry") || s.includes("acr")) return "archive";
    if (s.includes("container app") || s.includes("containerapp")) return "box";
    if (s.includes("foundry") || s.includes("openai") || s.includes("ai")) return "brain";
    if (s.includes("network") || s.includes("virtual network") || s.includes("load balancer")) return "network";
    if (s.includes("virtual machine") || s.includes("compute")) return "server";
    if (s.includes("storage")) return "hard-drive";
    if (s.includes("sql") || s.includes("postgres") || s.includes("mysql") || s.includes("cosmos")) return "database";
    if (s.includes("kubernetes") || s.includes("aks")) return "boxes";
    return "layers";
}

/**
 * Retorna datos calibrados y de alta fidelidad para el tenant de demostración/mock
 */
export function getMockRealConsumptionOverview(tenantId: string): RealConsumptionOverview {
    const now = new Date();
    const daysElapsed = Math.max(1, now.getDate());
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const mockServices: ServiceConsumptionSummary[] = [
        {
            serviceKey: "redis",
            serviceName: "Redis Cache",
            category: "Databases & Caching",
            iconName: "database",
            totalCost: 86.92,
            percentageOfTotal: 23.36,
            dailyBurnRate: Number(new Decimal(86.92).dividedBy(daysElapsed).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            projectedCost: Number(new Decimal(86.92).dividedBy(daysElapsed).times(daysInMonth).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            momVariation: 14.2,
            resourceCount: 1,
            hasAnomaly: false,
            primarySku: "Standard C1 (eastus)",
            remediationActionKey: "redis_downgrade",
            potentialSavings: 40.0,
            resources: [
                {
                    id: "/subscriptions/demo-sub-prod/resourceGroups/rg-prod-data/providers/Microsoft.Cache/Redis/redis-prod-cache-01",
                    resourceName: "redis-prod-cache-01",
                    resourceGroup: "rg-prod-data",
                    region: "eastus",
                    sku: "Standard C1 (1 GB)",
                    costMtd: 86.92,
                    billedCost: 86.92,
                    effectiveCost: 86.92,
                    tags: { Environment: "prod", Owner: "data-team@cscloud.com" },
                    remediationSuggestedKey: "rr_redis_basic_c1",
                    remediationActionKey: "redis_downgrade",
                },
            ],
        },
        {
            serviceKey: "container_apps",
            serviceName: "Azure Container Apps",
            category: "Containers & Serverless",
            iconName: "box",
            totalCost: 72.77,
            percentageOfTotal: 19.56,
            dailyBurnRate: Number(new Decimal(72.77).dividedBy(daysElapsed).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            projectedCost: Number(new Decimal(72.77).dividedBy(daysElapsed).times(daysInMonth).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            momVariation: 8.5,
            resourceCount: 3,
            hasAnomaly: false,
            primarySku: "Consumption / Workload D4 (westeurope)",
            remediationActionKey: "container_apps_scale_to_zero",
            potentialSavings: 25.0,
            resources: [
                {
                    id: "/subscriptions/demo-sub-prod/resourceGroups/rg-prod-apps/providers/Microsoft.App/containerApps/ca-api-gateway",
                    resourceName: "ca-api-gateway",
                    resourceGroup: "rg-prod-apps",
                    region: "westeurope",
                    sku: "Workload D4 (4 vCPU, 16 GB)",
                    costMtd: 38.5,
                    billedCost: 38.5,
                    effectiveCost: 38.5,
                    tags: { Environment: "prod", Service: "Gateway" },
                    remediationSuggestedKey: "rr_aca_minreplicas",
                    remediationActionKey: "container_apps_scale_to_zero",
                },
                {
                    id: "/subscriptions/demo-sub-prod/resourceGroups/rg-prod-apps/providers/Microsoft.App/containerApps/ca-auth-service",
                    resourceName: "ca-auth-service",
                    resourceGroup: "rg-prod-apps",
                    region: "westeurope",
                    sku: "Consumption (0.5 vCPU, 1 GB)",
                    costMtd: 21.27,
                    billedCost: 21.27,
                    effectiveCost: 21.27,
                    tags: { Environment: "prod", Service: "Auth" },
                    remediationSuggestedKey: "rr_aca_keda",
                    remediationActionKey: "container_apps_scale_to_zero",
                },
                {
                    id: "/subscriptions/demo-sub-dev/resourceGroups/rg-dev-microservices/providers/Microsoft.App/containerApps/ca-worker-dev",
                    resourceName: "ca-worker-dev",
                    resourceGroup: "rg-dev-microservices",
                    region: "eastus",
                    sku: "Consumption (1 vCPU, 2 GB)",
                    costMtd: 13.0,
                    billedCost: 13.0,
                    effectiveCost: 13.0,
                    tags: { Environment: "dev", Owner: "dev-lead@cscloud.com" },
                    remediationSuggestedKey: "rr_aca_scale_zero",
                    remediationActionKey: "container_apps_scale_to_zero",
                },
            ],
        },
        {
            serviceKey: "virtual_machines",
            serviceName: "Virtual Machines",
            category: "Compute",
            iconName: "server",
            totalCost: 67.93,
            percentageOfTotal: 18.25,
            dailyBurnRate: Number(new Decimal(67.93).dividedBy(daysElapsed).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            projectedCost: Number(new Decimal(67.93).dividedBy(daysElapsed).times(daysInMonth).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            momVariation: -3.4,
            resourceCount: 2,
            hasAnomaly: false,
            primarySku: "Standard_B2ms / D2s_v5 (eastus)",
            remediationActionKey: "vm_power_schedule",
            potentialSavings: 28.0,
            resources: [
                {
                    id: "/subscriptions/demo-sub-prod/resourceGroups/rg-prod-compute/providers/Microsoft.Compute/virtualMachines/vm-legacy-app",
                    resourceName: "vm-legacy-app",
                    resourceGroup: "rg-prod-compute",
                    region: "eastus",
                    sku: "Standard_D2s_v5 (2 vCPU, 8 GB)",
                    costMtd: 45.2,
                    billedCost: 45.2,
                    effectiveCost: 39.8,
                    tags: { Environment: "prod", Workload: "Legacy" },
                    remediationSuggestedKey: "rr_vm_ahub",
                    remediationActionKey: "vm_power_schedule",
                },
                {
                    id: "/subscriptions/demo-sub-dev/resourceGroups/rg-dev-test/providers/Microsoft.Compute/virtualMachines/vm-dev-build-01",
                    resourceName: "vm-dev-build-01",
                    resourceGroup: "rg-dev-test",
                    region: "eastus",
                    sku: "Standard_B2ms (2 vCPU, 8 GB)",
                    costMtd: 22.73,
                    billedCost: 22.73,
                    effectiveCost: 22.73,
                    tags: { Environment: "dev", Owner: "ci@cscloud.com" },
                    remediationSuggestedKey: "rr_vm_schedule",
                    remediationActionKey: "vm_power_schedule",
                },
            ],
        },
        {
            serviceKey: "storage_accounts",
            serviceName: "Storage Accounts",
            category: "Storage",
            iconName: "hard-drive",
            totalCost: 45.12,
            percentageOfTotal: 12.12,
            dailyBurnRate: Number(new Decimal(45.12).dividedBy(daysElapsed).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            projectedCost: Number(new Decimal(45.12).dividedBy(daysElapsed).times(daysInMonth).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            momVariation: 2.1,
            resourceCount: 4,
            hasAnomaly: false,
            primarySku: "Standard_LRS / Hot (eastus)",
            remediationActionKey: "storage_lifecycle",
            potentialSavings: 14.5,
            resources: [
                {
                    id: "/subscriptions/demo-sub-prod/resourceGroups/rg-prod-data/providers/Microsoft.Storage/storageAccounts/stprodbackups01",
                    resourceName: "stprodbackups01",
                    resourceGroup: "rg-prod-data",
                    region: "eastus",
                    sku: "Standard_LRS (Hot)",
                    costMtd: 26.4,
                    billedCost: 26.4,
                    effectiveCost: 26.4,
                    tags: { Tier: "Hot", Purpose: "Backups" },
                    remediationSuggestedKey: "rr_sto_backup_tiers",
                    remediationActionKey: "storage_lifecycle",
                },
                {
                    id: "/subscriptions/demo-sub-prod/resourceGroups/rg-prod-data/providers/Microsoft.Storage/storageAccounts/stprodappassets",
                    resourceName: "stprodappassets",
                    resourceGroup: "rg-prod-data",
                    region: "eastus",
                    sku: "Standard_GRS (Hot)",
                    costMtd: 18.72,
                    billedCost: 18.72,
                    effectiveCost: 18.72,
                    tags: { Tier: "Hot", Purpose: "Assets" },
                    remediationSuggestedKey: "rr_sto_grs_vs_zrs",
                    remediationActionKey: "storage_lifecycle",
                },
            ],
        },
        {
            serviceKey: "foundry_models",
            serviceName: "Foundry Models / AI Tokens",
            category: "AI & Machine Learning",
            iconName: "brain",
            totalCost: 37.78,
            percentageOfTotal: 10.15,
            dailyBurnRate: Number(new Decimal(37.78).dividedBy(daysElapsed).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            projectedCost: Number(new Decimal(37.78).dividedBy(daysElapsed).times(daysInMonth).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            momVariation: 48.3,
            resourceCount: 2,
            hasAnomaly: true,
            primarySku: "gpt-4o-mini / text-embedding-3 (eastus2)",
            remediationActionKey: "foundry_quota_limit",
            potentialSavings: 15.0,
            resources: [
                {
                    id: "/subscriptions/demo-sub-prod/resourceGroups/rg-prod-ai/providers/Microsoft.CognitiveServices/accounts/cog-ai-foundry-prod",
                    resourceName: "cog-ai-foundry-prod",
                    resourceGroup: "rg-prod-ai",
                    region: "eastus2",
                    sku: "Standard S0 (Pay-as-you-go)",
                    costMtd: 28.5,
                    billedCost: 28.5,
                    effectiveCost: 28.5,
                    tags: { Model: "gpt-4o-mini", Environment: "prod" },
                    remediationSuggestedKey: "rr_ai_tpm_limit",
                    remediationActionKey: "foundry_quota_limit",
                    isAnomaly: true,
                },
                {
                    id: "/subscriptions/demo-sub-prod/resourceGroups/rg-prod-ai/providers/Microsoft.CognitiveServices/accounts/cog-embeddings-01",
                    resourceName: "cog-embeddings-01",
                    resourceGroup: "rg-prod-ai",
                    region: "eastus2",
                    sku: "text-embedding-3-small",
                    costMtd: 9.28,
                    billedCost: 9.28,
                    effectiveCost: 9.28,
                    tags: { Model: "embeddings", Environment: "prod" },
                    remediationSuggestedKey: "rr_ai_semantic_cache",
                    remediationActionKey: "foundry_quota_limit",
                },
            ],
        },
        {
            serviceKey: "networking",
            serviceName: "Virtual Network / Load Balancer",
            category: "Networking",
            iconName: "network",
            totalCost: 32.29,
            percentageOfTotal: 8.68,
            dailyBurnRate: Number(new Decimal(32.29).dividedBy(daysElapsed).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            projectedCost: Number(new Decimal(32.29).dividedBy(daysElapsed).times(daysInMonth).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            momVariation: 1.8,
            resourceCount: 3,
            hasAnomaly: false,
            primarySku: "Standard LB + Public IPs (eastus)",
            remediationActionKey: "vnet_ip_audit",
            potentialSavings: 18.0,
            resources: [
                {
                    id: "/subscriptions/demo-sub-prod/resourceGroups/rg-prod-net/providers/Microsoft.Network/loadBalancers/lb-app-ingress",
                    resourceName: "lb-app-ingress",
                    resourceGroup: "rg-prod-net",
                    region: "eastus",
                    sku: "Standard Load Balancer",
                    costMtd: 18.25,
                    billedCost: 18.25,
                    effectiveCost: 18.25,
                    tags: { Environment: "prod" },
                    remediationSuggestedKey: "rr_net_health_probes",
                    remediationActionKey: "vnet_ip_audit",
                },
                {
                    id: "/subscriptions/demo-sub-prod/resourceGroups/rg-prod-net/providers/Microsoft.Network/publicIPAddresses/pip-egress-nat",
                    resourceName: "pip-egress-nat",
                    resourceGroup: "rg-prod-net",
                    region: "eastus",
                    sku: "Standard Static IPv4",
                    costMtd: 7.2,
                    billedCost: 7.2,
                    effectiveCost: 7.2,
                    tags: { Usage: "NAT Gateway" },
                    remediationSuggestedKey: "rr_net_nat_consolidate",
                    remediationActionKey: "vnet_ip_audit",
                },
                {
                    id: "/subscriptions/demo-sub-dev/resourceGroups/rg-dev-net/providers/Microsoft.Network/publicIPAddresses/pip-dev-unattached",
                    resourceName: "pip-dev-unattached",
                    resourceGroup: "rg-dev-net",
                    region: "eastus",
                    sku: "Standard Static IPv4 (Unattached)",
                    costMtd: 6.84,
                    billedCost: 6.84,
                    effectiveCost: 6.84,
                    tags: { Environment: "dev" },
                    remediationSuggestedKey: "rr_net_orphan_ip",
                    remediationActionKey: "vnet_ip_audit",
                    isAnomaly: false,
                },
            ],
        },
        {
            serviceKey: "cognitive_search",
            serviceName: "Azure Cognitive Search",
            category: "AI & Search",
            iconName: "search",
            totalCost: 18.48,
            percentageOfTotal: 4.97,
            dailyBurnRate: Number(new Decimal(18.48).dividedBy(daysElapsed).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            projectedCost: Number(new Decimal(18.48).dividedBy(daysElapsed).times(daysInMonth).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            momVariation: 0.4,
            resourceCount: 1,
            hasAnomaly: false,
            primarySku: "Standard S1 (eastus)",
            remediationActionKey: "search_tier_review",
            potentialSavings: 12.0,
            resources: [
                {
                    id: "/subscriptions/demo-sub-prod/resourceGroups/rg-prod-search/providers/Microsoft.Search/searchServices/search-kb-prod",
                    resourceName: "search-kb-prod",
                    resourceGroup: "rg-prod-search",
                    region: "eastus",
                    sku: "Standard S1 (1 partition, 1 replica)",
                    costMtd: 18.48,
                    billedCost: 18.48,
                    effectiveCost: 18.48,
                    tags: { Service: "RAG" },
                    remediationSuggestedKey: "rr_search_basic_tier",
                    remediationActionKey: "search_tier_review",
                },
            ],
        },
        {
            serviceKey: "container_registry",
            serviceName: "Container Registry",
            category: "Containers",
            iconName: "archive",
            totalCost: 10.84,
            percentageOfTotal: 2.91,
            dailyBurnRate: Number(new Decimal(10.84).dividedBy(daysElapsed).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            projectedCost: Number(new Decimal(10.84).dividedBy(daysElapsed).times(daysInMonth).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            momVariation: -1.2,
            resourceCount: 1,
            hasAnomaly: false,
            primarySku: "Standard (eastus)",
            remediationActionKey: "acr_downgrade_basic",
            potentialSavings: 5.84,
            resources: [
                {
                    id: "/subscriptions/demo-sub-prod/resourceGroups/rg-prod-acr/providers/Microsoft.ContainerRegistry/registries/acrprodregistry01",
                    resourceName: "acrprodregistry01",
                    resourceGroup: "rg-prod-acr",
                    region: "eastus",
                    sku: "Standard",
                    costMtd: 10.84,
                    billedCost: 10.84,
                    effectiveCost: 10.84,
                    tags: { Usage: "Docker images" },
                    remediationSuggestedKey: "rr_acr_basic_tier",
                    remediationActionKey: "acr_downgrade_basic",
                },
            ],
        },
    ];

    const totalCost = 372.13;
    const projectedCost = Number(new Decimal(totalCost).dividedBy(daysElapsed).times(daysInMonth).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
    const dailyBurnRate = Number(new Decimal(totalCost).dividedBy(daysElapsed).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());

    // Top 5 Share of Wallet for stacked bar
    const top5ShareOfWallet: ShareOfWalletItem[] = mockServices.slice(0, 5).map((s, idx) => ({
        name: s.serviceName,
        serviceKey: s.serviceKey,
        percentage: s.percentageOfTotal,
        cost: s.totalCost,
        color: THEME_COLORS[idx % THEME_COLORS.length],
    }));

    const otherCost = mockServices.slice(5).reduce((acc, s) => acc.plus(s.totalCost), new Decimal(0));
    if (otherCost.gt(0)) {
        const otherPct = Number(otherCost.dividedBy(totalCost).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
        top5ShareOfWallet.push({
            name: "",  // la UI lo resuelve por serviceKey === "others"
            serviceKey: "others",
            percentage: otherPct,
            cost: Number(otherCost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
            color: "#64748B",
        });
    }

    return {
        totalCost,
        projectedCost,
        dailyBurnRate,
        momVariation: 11.4,
        daysElapsed,
        daysInMonth,
        hasAnomalies: true,
        anomalyCount: 1,
        topServices: mockServices.slice(0, 5),
        services: mockServices,
        top5ShareOfWallet,
        billedCostTotal: totalCost,
        effectiveCostTotal: totalCost - 5.4,
        currency: "USD",
        source: "mock",
        period: {
            start: `${year}-${String(month + 1).padStart(2, "0")}-01`,
            end: now.toISOString().split("T")[0],
            daysElapsed,
            daysInMonth,
        },
    };
}

import { ResourceManagementClient } from "@azure/arm-resources";
import { getAzureCredential, getAllSubscriptionsForTenant } from "@/lib/azure";
import { getMtdCostByResourceId } from "@/app/api/intelligence/databases/diagnosticsShared";
import { errorMessage } from '@/lib/apiErrors';

export interface DiscoveredTenantResource {
    id: string;
    name: string;
    type: string;
    resourceGroup: string;
    region: string;
    sku: string;
    serviceName: string;
    subscriptionId?: string;
}

export interface TenantInventoryContext {
    resourceGroups: string[];
    primaryRegion: string;
    resources: DiscoveredTenantResource[];
}

export function mapResourceTypeToServiceName(type: string): string {
    const t = (type || "").toLowerCase();
    if (t.includes("microsoft.sql") || t.includes("sqldatabase") || t.includes("sql/servers")) return "SQL Database";
    if (t.includes("microsoft.cache/redis")) return "Redis Cache";
    if (t.includes("microsoft.dbformysql")) return "Azure Database for MySQL";
    if (t.includes("microsoft.dbforpostgresql")) return "Azure Database for PostgreSQL";
    if (t.includes("microsoft.documentdb")) return "Azure Cosmos DB";
    if (t.includes("microsoft.compute/virtualmachines")) return "Virtual Machines";
    if (t.includes("microsoft.compute/virtualmachinescalesets")) return "Virtual Machine Scale Sets";
    if (t.includes("microsoft.app/containerapps")) return "Azure Container Apps";
    if (t.includes("microsoft.containerservice/managedclusters")) return "Azure Kubernetes Service";
    if (t.includes("microsoft.containerregistry")) return "Container Registry";
    if (t.includes("microsoft.web/sites") || t.includes("microsoft.web/serverfarms")) return "Azure App Service";
    if (t.includes("microsoft.cognitiveservices") || t.includes("microsoft.openai")) return "Foundry Models";
    if (t.includes("microsoft.search")) return "Azure Cognitive Search";
    if (t.includes("microsoft.storage")) return "Azure Blob Storage";
    if (t.includes("microsoft.network/virtualnetworks")) return "Virtual Network";
    if (t.includes("microsoft.network/loadbalancers")) return "Azure Load Balancer";
    if (t.includes("microsoft.network/natgateways")) return "NAT Gateway";
    if (t.includes("microsoft.network/applicationgateways")) return "Application Gateway";
    if (t.includes("microsoft.keyvault")) return "Azure Key Vault";
    return "Other";
}

export async function fetchTenantRealResourceInventory(tenantId: string): Promise<TenantInventoryContext> {
    const rgs = new Set<string>();
    const resources: DiscoveredTenantResource[] = [];
    let primaryRegion = "eastus2";

    try {
        const credential = await getAzureCredential(tenantId);
        const subscriptions = await getAllSubscriptionsForTenant(tenantId, credential);

        // En paralelo: en serie, cada suscripción pagina TODOS sus recursos y
        // 10 suscripciones sumaban minutos — Cloudflare cortaba con 524 antes
        // de que la ruta contestara.
        await Promise.all(subscriptions.slice(0, 10).map(async (subId) => {
            try {
                const client = new ResourceManagementClient(credential, subId);

                // 1. Resource Groups
                for await (const rg of client.resourceGroups.list()) {
                    if (rg.name) {
                        rgs.add(rg.name);
                        if (rg.location && rg.location !== "global") {
                            primaryRegion = rg.location;
                        }
                    }
                }

                // 2. Resources
                for await (const r of client.resources.list()) {
                    if (!r.id || !r.name) continue;
                    const rgMatch = r.id.match(/\/resourceGroups\/([^\/]+)/i);
                    const rgName = rgMatch ? rgMatch[1] : (Array.from(rgs)[0] || "rg-production");
                    if (rgName) rgs.add(rgName);

                    const location = r.location && r.location !== "global" ? r.location : primaryRegion;
                    const sku = r.sku?.name || r.plan?.name || "Standard";

                    resources.push({
                        id: r.id,
                        name: r.name,
                        type: r.type || "",
                        resourceGroup: rgName,
                        region: location,
                        sku,
                        serviceName: mapResourceTypeToServiceName(r.type || ""),
                        subscriptionId: subId,
                    });
                }
            } catch (subErr) {
                console.warn(`[realConsumptionService] Sub ${subId} resource discovery:`, errorMessage(subErr));
            }
        }));
    } catch (e) {
        console.warn(`[realConsumptionService] ARM inventory error for tenant ${tenantId}:`, errorMessage(e));
    }

    // Fallback if ARM discovery returned 0: check database CostSnapshots for real RG names & regions
    if (rgs.size === 0) {
        try {
            const [dbRgs]: any = await pool.query(
                `SELECT DISTINCT resource_group FROM CostSnapshots WHERE tenant_id = ? AND resource_group NOT IN ('*', 'default-rg', 'null', '')`,
                [tenantId]
            );
            for (const row of dbRgs || []) {
                if (row.resource_group) rgs.add(row.resource_group);
            }

            const [dbRegions]: any = await pool.query(
                `SELECT DISTINCT region FROM CostMeterSnapshots WHERE tenant_id = ? AND region NOT IN ('', 'global', 'null') LIMIT 1`,
                [tenantId]
            );
            if (dbRegions?.[0]?.region) {
                primaryRegion = dbRegions[0].region;
            }
        } catch {
            // ignore
        }
    }

    return {
        resourceGroups: Array.from(rgs),
        primaryRegion,
        resources,
    };
}

/**
 * Consulta de datos de consumo real para tenants en producción
 */
export async function getRealConsumptionOverview(
    tenantId: string,
    subscriptionId: string = "All"
): Promise<RealConsumptionOverview> {
    if (isMockTenant(tenantId)) {
        return getMockRealConsumptionOverview(tenantId);
    }

    const now = new Date();
    const daysElapsed = Math.max(1, now.getDate());
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Descubrir inventario real de Azure para el tenant activo
    const inventory = await fetchTenantRealResourceInventory(tenantId);
    const defaultTenantRg = inventory.resourceGroups[0] || "rg-production";
    const defaultRegion = inventory.primaryRegion || "eastus2";

    // Obtener costos reales granulares por ResourceId directamente desde Azure Cost Management
    // Misma foto cacheada por suscripción que usa el resto del cockpit (10 min):
    // `getResourceCostsById` filtraba por los miles de ResourceId del inventario,
    // una consulta propia con reintentos por cada carga de esta página.
    let realResourceCosts = new Map<string, number>();
    try {
        const queryResources = inventory.resources.map((r) => ({
            id: r.id,
            subscriptionId: r.subscriptionId || (subscriptionId === "All" ? "" : subscriptionId),
        }));
        if (queryResources.length > 0) {
            const credential = await getAzureCredential(tenantId);
            realResourceCosts = await getMtdCostByResourceId(tenantId, credential, queryResources);
        }
    } catch (costErr) {
        console.warn(`[realConsumptionService] getMtdCostByResourceId fallback:`, errorMessage(costErr));
    }

    let totalCostDecimal = new Decimal(0);
    let billedCostTotalDecimal = new Decimal(0);
    let effectiveCostTotalDecimal = new Decimal(0);
    const serviceMap = new Map<string, {
        cost: Decimal;
        billedCost: Decimal;
        effectiveCost: Decimal;
        resources: Map<string, ServiceResourceDetail>;
    }>();

    let source: "live-cost-management" | "snapshot-fallback" = "live-cost-management";

    try {
        const entries = await getCurrentMonthAmortizedCosts(tenantId, subscriptionId, "ActualCost");
        if (entries && entries.length > 0) {
            // Cada recurso se asigna a UNA sola tarjeta de servicio.
            //
            // El filtro era difuso (nombre exacto, o el servicio contiene al
            // nombre mapeado, o el tipo ARM contiene al servicio sin espacios) y
            // un mismo recurso caía en varias tarjetas a la vez: una cuenta de
            // Cognitive Services aparecía en "Foundry Models" Y en "Cognitive
            // Services", una storage account en "Storage" Y en "Azure Blob
            // Storage". Como `getMtdCostByResourceId` agrupa sólo por ResourceId
            // —devuelve el costo del recurso sumado sobre TODOS los servicios—,
            // cada tarjeta mostraba ese total completo y el desglose contradecía
            // al total de la tarjeta.
            //
            // Se resuelve acá y no pidiendo costo por (recurso × servicio)
            // porque la Query API de Cost Management admite 2 dimensiones de
            // agrupación y la foto compartida ya usa las dos (ResourceId +
            // ResourceType); una consulta extra por suscripción reabriría el
            // throttling que motivó esa caché.
            const serviceNames = Array.from(
                new Set(entries.map((e) => ((e.ServiceName || "Other").trim() || "Other")))
            );
            const bestServiceForResource = new Map<string, string>();
            for (const r of inventory.resources) {
                let bestScore = 0;
                let bestName = "";
                for (const svc of serviceNames) {
                    const svcLower = svc.toLowerCase();
                    const mapped = r.serviceName.toLowerCase();
                    // Más específico gana: nombre exacto > el servicio contiene al
                    // nombre mapeado > el tipo ARM contiene al servicio.
                    const score = mapped === svcLower ? 3
                        : svcLower.includes(mapped) ? 2
                        : r.type.toLowerCase().includes(svcLower.replace(/\s+/g, "")) ? 1
                        : 0;
                    // Ante empate gana el nombre más largo (el más específico).
                    if (score > bestScore || (score > 0 && score === bestScore && svc.length > bestName.length)) {
                        bestScore = score;
                        bestName = svc;
                    }
                }
                if (bestScore > 0) bestServiceForResource.set(r.id, bestName);
            }

            for (const entry of entries) {
                const effective = new Decimal(entry.EffectiveCost || entry.BilledCost || 0);
                const billed = new Decimal(entry.BilledCost || entry.EffectiveCost || 0);
                if (effective.lte(0) && billed.lte(0)) continue;

                totalCostDecimal = totalCostDecimal.plus(effective);
                billedCostTotalDecimal = billedCostTotalDecimal.plus(billed);
                effectiveCostTotalDecimal = effectiveCostTotalDecimal.plus(effective);

                const rawService = (entry.ServiceName || "Other").trim() || "Other";
                const svcData = serviceMap.get(rawService) || {
                    cost: new Decimal(0),
                    billedCost: new Decimal(0),
                    effectiveCost: new Decimal(0),
                    resources: new Map<string, ServiceResourceDetail>(),
                };

                svcData.cost = svcData.cost.plus(effective);
                svcData.billedCost = svcData.billedCost.plus(billed);
                svcData.effectiveCost = svcData.effectiveCost.plus(effective);

                // Sólo los recursos cuya MEJOR coincidencia es este servicio.
                const matchingArmResources = inventory.resources.filter(
                    (r) => bestServiceForResource.get(r.id) === rawService
                );

                if (matchingArmResources.length > 0) {
                    const hasIndividualCosts = matchingArmResources.some((r) => realResourceCosts.has(r.id.toLowerCase()));

                    for (const armRes of matchingArmResources) {
                        const rawCost = realResourceCosts.get(armRes.id.toLowerCase());
                        let costForRes: Decimal;
                        let billedForRes: Decimal;

                        // ¿El valor de `costForRes` ya es el total del MES, o es la
                        // porción de UNA fila diaria? Este bucle recorre `entries`,
                        // que viene con granularity "Daily" (ver
                        // getCurrentMonthAmortizedCosts): hay una fila por día con
                        // gasto. `realResourceCosts` en cambio es month-to-date por
                        // recurso, una sola cifra para todo el mes.
                        let isMonthToDateTotal: boolean;

                        if (rawCost !== undefined && rawCost >= 0) {
                            // Costo real exacto de Azure Cost Management para este recurso
                            costForRes = new Decimal(rawCost);
                            billedForRes = new Decimal(rawCost);
                            isMonthToDateTotal = true;
                        } else if (hasIndividualCosts) {
                            // Recurso en ARM sin consumo facturado este mes (ej. F0, tier gratuito o inactivo)
                            costForRes = new Decimal(0);
                            billedForRes = new Decimal(0);
                            isMonthToDateTotal = true;
                        } else {
                            // Fallback solo si Cost Management no devolvió desglose a nivel ResourceId
                            costForRes = effective.dividedBy(matchingArmResources.length);
                            billedForRes = billed.dividedBy(matchingArmResources.length);
                            isMonthToDateTotal = false;
                        }

                        const rule = getServiceRemediationRule(rawService, costForRes.toNumber(), armRes.sku);
                        const existing = svcData.resources.get(armRes.id);
                        if (existing) {
                            // Acumular SÓLO el prorrateo diario. Sumar el total
                            // month-to-date una vez por fila diaria multiplicaba el
                            // costo del recurso por la cantidad de días facturados:
                            // un recurso de $184.01 aparecía en $2,760.15 (15 días)
                            // dentro de una tarjeta cuyo total decía $184.01.
                            if (!isMonthToDateTotal) {
                                existing.costMtd = Number(new Decimal(existing.costMtd).plus(costForRes).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
                                existing.billedCost = Number(new Decimal(existing.billedCost).plus(billedForRes).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
                                existing.effectiveCost = Number(new Decimal(existing.effectiveCost).plus(costForRes).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
                            }
                        } else {
                            svcData.resources.set(armRes.id, {
                                id: armRes.id,
                                resourceName: armRes.name,
                                resourceGroup: armRes.resourceGroup || defaultTenantRg,
                                region: armRes.region || defaultRegion,
                                sku: armRes.sku || "Standard",
                                costMtd: Number(costForRes.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                                billedCost: Number(billedForRes.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                                effectiveCost: Number(costForRes.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                                tags: {},
                                remediationSuggestedKey: `rc_rec_${rule.remediationActionKey}`,
                                remediationActionKey: rule.remediationActionKey,
                            });
                        }
                    }
                } else {
                    // Fallback con datos reales del tenant
                    const cleanSlug = rawService.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
                    const resRg = defaultTenantRg;
                    const resName = `${cleanSlug}-${resRg.replace(/^rg-/, "") || "primary"}`;
                    const resId = `/subscriptions/${subscriptionId === "All" ? "sub-primary" : subscriptionId}/resourceGroups/${resRg}/providers/Microsoft.Custom/${cleanSlug}/${resName}`;
                    const rule = getServiceRemediationRule(rawService, effective.toNumber(), "Standard");

                    const existing = svcData.resources.get(resId);
                    if (existing) {
                        existing.costMtd = Number(new Decimal(existing.costMtd).plus(effective).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
                        existing.billedCost = Number(new Decimal(existing.billedCost).plus(billed).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
                        existing.effectiveCost = Number(new Decimal(existing.effectiveCost).plus(effective).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
                    } else {
                        svcData.resources.set(resId, {
                            id: resId,
                            resourceName: resName,
                            resourceGroup: resRg,
                            region: defaultRegion,
                            sku: "Standard",
                            costMtd: Number(effective.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                            billedCost: Number(billed.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                            effectiveCost: Number(effective.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                            tags: {},
                            remediationSuggestedKey: `rc_rec_${rule.remediationActionKey}`,
                            remediationActionKey: rule.remediationActionKey,
                        });
                    }
                }

                serviceMap.set(rawService, svcData);
            }
        } else {
            throw new Error("No live entries returned, checking snapshots");
        }
    } catch {
        source = "snapshot-fallback";
        const conn = await pool.getConnection();
        try {
            const query = `
                SELECT 
                    COALESCE(NULLIF(service_name, ''), 'Other') as service_name,
                    COALESCE(resource_id, '') as resource_id,
                    COALESCE(NULLIF(resource_group, ''), '') as resource_group,
                    COALESCE(NULLIF(region, ''), '') as region,
                    COALESCE(NULLIF(sku, ''), '') as sku,
                    COALESCE(NULLIF(MeterName, ''), '') as meter_name,
                    COALESCE(SUM(COALESCE(EffectiveCost, cost_usd, 0)), 0) as effective_cost,
                    COALESCE(SUM(COALESCE(BilledCost, cost_usd, 0)), 0) as billed_cost
                FROM CostSnapshots
                WHERE 
                    tenant_id = ?
                    AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
                GROUP BY service_name, resource_id, resource_group, region, sku, MeterName
                ORDER BY effective_cost DESC
            `;
            const [rows] = await conn.execute<any[]>(query, [tenantId]);
            for (const row of rows || []) {
                const effective = new Decimal(row.effective_cost || 0);
                const billed = new Decimal(row.billed_cost || 0);
                if (effective.lte(0)) continue;

                totalCostDecimal = totalCostDecimal.plus(effective);
                billedCostTotalDecimal = billedCostTotalDecimal.plus(billed);
                effectiveCostTotalDecimal = effectiveCostTotalDecimal.plus(effective);

                const rawService = row.service_name || "Other";
                const svcData = serviceMap.get(rawService) || {
                    cost: new Decimal(0),
                    billedCost: new Decimal(0),
                    effectiveCost: new Decimal(0),
                    resources: new Map<string, ServiceResourceDetail>(),
                };

                svcData.cost = svcData.cost.plus(effective);
                svcData.billedCost = svcData.billedCost.plus(billed);
                svcData.effectiveCost = svcData.effectiveCost.plus(effective);

                // Resolver Resource Group real
                let rowRg = row.resource_group;
                if (!rowRg || rowRg === "*" || rowRg === "default-rg" || rowRg === "null") {
                    rowRg = defaultTenantRg;
                }

                // Resolver Región real
                let rowRegion = row.region;
                if (!rowRegion || rowRegion === "global" || rowRegion === "null") {
                    rowRegion = defaultRegion;
                }

                // Resolver SKU real
                const rowSku = row.sku || row.meter_name || "Standard";

                // Resolver nombre de recurso real
                let resId = row.resource_id;
                let resName = "";
                if (resId && resId.length > 5 && !resId.startsWith("res-")) {
                    resName = resId.split("/").pop() || rawService;
                } else {
                    const cleanSlug = rawService.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
                    resName = `${cleanSlug}-${rowRg.replace(/^rg-/, "") || "primary"}`;
                    resId = `/subscriptions/${subscriptionId === "All" ? "sub-primary" : subscriptionId}/resourceGroups/${rowRg}/providers/Microsoft.Custom/${cleanSlug}/${resName}`;
                }

                const rule = getServiceRemediationRule(rawService, effective.toNumber(), rowSku);

                svcData.resources.set(resId, {
                    id: resId,
                    resourceName: resName,
                    resourceGroup: rowRg,
                    region: rowRegion,
                    sku: rowSku,
                    costMtd: Number(effective.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                    billedCost: Number(billed.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                    effectiveCost: Number(effective.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                    remediationSuggestedKey: `rc_rec_${rule.remediationActionKey}`,
                    remediationActionKey: rule.remediationActionKey,
                });

                serviceMap.set(rawService, svcData);
            }
        } finally {
            conn.release();
        }
    }

    // Real historical comparison & anomaly detection from database
    let prevMonthTotalCostDecimal = new Decimal(0);
    const prevServiceCostMap = new Map<string, Decimal>();
    let dbAnomalyCount = 0;

    const queryConn = await pool.getConnection();
    try {
        // 1. Previous month total and per-service cost
        const prevMonthQuery = `
            SELECT 
                COALESCE(NULLIF(service_name, ''), 'Other') as service_name,
                COALESCE(SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)), 0) as cost
            FROM CostSnapshots
            WHERE 
                tenant_id = ?
                AND date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)
                AND date < DATE_FORMAT(CURDATE(), '%Y-%m-01')
            GROUP BY service_name
        `;
        const [prevRows] = await queryConn.execute<any[]>(prevMonthQuery, [tenantId]);
        for (const row of prevRows || []) {
            const rowCost = new Decimal(row.cost || 0);
            prevMonthTotalCostDecimal = prevMonthTotalCostDecimal.plus(rowCost);
            prevServiceCostMap.set(row.service_name || "Other", rowCost);
        }

        // 2. Real anomalies from Anomalies table
        try {
            const [anomalyRows] = await queryConn.execute<any[]>(
                `SELECT COUNT(*) as cnt FROM Anomalies WHERE tenant_id = ? AND status = 'open' AND date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)`,
                [tenantId]
            );
            dbAnomalyCount = Number(anomalyRows[0]?.cnt || 0);
        } catch {
            // Table may not exist or be empty in some environments
            dbAnomalyCount = 0;
        }
    } catch (dbErr) {
        console.warn("[realConsumptionService] Historical MoM query fallback:", (dbErr as Error)?.message);
    } finally {
        queryConn.release();
    }

    const totalCost = Number(totalCostDecimal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
    const dailyBurnRate = totalCost > 0
        ? Number(totalCostDecimal.dividedBy(daysElapsed).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString())
        : 0;
    const projectedCost = totalCost > 0
        ? Number(totalCostDecimal.dividedBy(daysElapsed).times(daysInMonth).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString())
        : 0;

    const overallMomVariation = prevMonthTotalCostDecimal.gt(0)
        ? Number(totalCostDecimal.minus(prevMonthTotalCostDecimal).dividedBy(prevMonthTotalCostDecimal).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toString())
        : 0;

    let anomalyCount = dbAnomalyCount;
    const services: ServiceConsumptionSummary[] = [];

    for (const [serviceName, data] of serviceMap.entries()) {
        const costNum = Number(data.cost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
        const pct = totalCost > 0
            ? Number(data.cost.dividedBy(totalCostDecimal).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString())
            : 0;
        const svcBurn = Number(data.cost.dividedBy(daysElapsed).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
        const svcProj = Number(data.cost.dividedBy(daysElapsed).times(daysInMonth).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());

        const resourcesList = Array.from(data.resources.values()).sort((a, b) => b.costMtd - a.costMtd);
        const primarySku = resourcesList[0]?.sku || "Standard";
        const rule = getServiceRemediationRule(serviceName, costNum, primarySku);

        // Real MoM per service
        const prevSvcCost = prevServiceCostMap.get(serviceName);
        let svcMom = 0;
        if (prevSvcCost && prevSvcCost.gt(0)) {
            svcMom = Number(data.cost.minus(prevSvcCost).dividedBy(prevSvcCost).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toString());
        }

        const hasAnomaly = svcMom > 35 && costNum > 10;
        if (hasAnomaly && dbAnomalyCount === 0) anomalyCount++;

        services.push({
            serviceKey: serviceName.toLowerCase().replace(/[^a-z0-9]/g, "_"),
            serviceName,
            category: "Azure Infrastructure",
            iconName: getServiceIconName(serviceName),
            totalCost: costNum,
            percentageOfTotal: pct,
            dailyBurnRate: svcBurn,
            projectedCost: svcProj,
            momVariation: svcMom,
            resourceCount: resourcesList.length,
            hasAnomaly,
            primarySku,
            remediationActionKey: rule.remediationActionKey,
            potentialSavings: rule.potentialSavings,
            resources: resourcesList,
        });
    }

    services.sort((a, b) => b.totalCost - a.totalCost);

    const top5 = services.slice(0, 5);
    const top5ShareOfWallet: ShareOfWalletItem[] = top5.map((s, idx) => ({
        name: s.serviceName,
        serviceKey: s.serviceKey,
        percentage: s.percentageOfTotal,
        cost: s.totalCost,
        color: THEME_COLORS[idx % THEME_COLORS.length],
    }));

    const restCost = services.slice(5).reduce((acc, s) => acc + s.totalCost, 0);
    if (restCost > 0 && totalCost > 0) {
        top5ShareOfWallet.push({
            name: "",  // la UI lo resuelve por serviceKey === "others"
            serviceKey: "others",
            percentage: Number(((restCost / totalCost) * 100).toFixed(2)),
            cost: Number(restCost.toFixed(2)),
            color: "#64748B",
        });
    }

    return {
        totalCost,
        projectedCost,
        dailyBurnRate,
        momVariation: overallMomVariation,
        daysElapsed,
        daysInMonth,
        hasAnomalies: anomalyCount > 0,
        anomalyCount,
        topServices: top5,
        services,
        top5ShareOfWallet,
        billedCostTotal: Number(billedCostTotalDecimal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
        effectiveCostTotal: Number(effectiveCostTotalDecimal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
        currency: "USD",
        source,
        period: {
            start: `${year}-${String(month + 1).padStart(2, "0")}-01`,
            end: now.toISOString().split("T")[0],
            daysElapsed,
            daysInMonth,
        },
    };
}
