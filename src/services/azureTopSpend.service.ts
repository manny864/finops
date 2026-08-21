/**
 * Service: Azure FinOps TOP Gastos / Dominant Spend Analysis
 * Agregación multi-dimensional de costos (Cost Groups, Suscripciones, Grupos de Recursos, Recursos).
 */

import { getAzureCredential } from "@/lib/azure";
import { getSubscriptionNameMap, resolveSubscriptionName, isUnattributedSubscriptionId } from "@/lib/azureSubscriptionNames";
import pool from "@/modules/storage/db";
import type { TopSpendItem, TopSpendSummary } from "@/types/topSpend.types";
import { errorMessage } from '@/lib/apiErrors';

export type TopSpendTimeframe = "mtd" | "30d";

export function generateMockTopSpend(
    tier: string = "Professional",
    timeframe: TopSpendTimeframe = "30d",
    limit: number = 5
): TopSpendSummary {
    const t = (tier || "Professional").toLowerCase();
    const multiplier = t === "enterprise" ? 50 : t === "business" ? 10 : t === "pro" || t === "professional" ? 3 : 1;
    const timeFactor = timeframe === "mtd" ? 0.72 : 1.0;
    const round2 = (x: number) => Math.round(x * 100) / 100;

    const baseCostGroups = [
        { name: "Engineering Core", subText: "Tag CostCenter: Engineering", baseCost: 4800 },
        { name: "Data & Analytics Platform", subText: "Tag CostCenter: Data-Platform", baseCost: 3600 },
        { name: "Customer Experience", subText: "Tag CostCenter: CX-Apps", baseCost: 2400 },
        { name: "Shared Infrastructure", subText: "Tag CostCenter: Shared-Infra", baseCost: 1800 },
        { name: "Security & Operations", subText: "Tag CostCenter: SecOps", baseCost: 1200 },
        { name: "Marketing Cloud", subText: "Tag CostCenter: Marketing", baseCost: 950 },
        { name: "E-Commerce Frontend", subText: "Tag CostCenter: E-Commerce", baseCost: 820 },
        { name: "QA & Automation", subText: "Tag CostCenter: QA", baseCost: 640 },
        { name: "Dev Labs Sandbox", subText: "Tag CostCenter: Sandbox", baseCost: 450 },
        { name: "Untagged Spend", subText: "Sin etiqueta CostCenter asignada", baseCost: 380 },
    ];

    const baseSubscriptions = [
        { name: "CSCS-LandingZone-Production", subText: "sub-prod-eastus-01", baseCost: 5600 },
        { name: "CSCS-LandingZone-DataPlatform", subText: "sub-data-westeurope-02", baseCost: 4100 },
        { name: "CSCS-LandingZone-SharedServices", subText: "sub-shared-hub-03", baseCost: 2900 },
        { name: "CSCS-LandingZone-Staging", subText: "sub-stg-brazilsouth-04", baseCost: 1950 },
        { name: "CSCS-LandingZone-Sandbox", subText: "sub-dev-sandbox-05", baseCost: 1100 },
        { name: "CSCS-Security-Workloads", subText: "sub-security-hub-06", baseCost: 850 },
        { name: "CSCS-Connectivity-Transit", subText: "sub-network-transit-07", baseCost: 720 },
        { name: "CSCS-Disaster-Recovery", subText: "sub-dr-secondary-08", baseCost: 590 },
        { name: "CSCS-AI-Foundry-Labs", subText: "sub-ai-foundry-09", baseCost: 480 },
        { name: "CSCS-Legacy-Decommission", subText: "sub-legacy-archive-10", baseCost: 310 },
    ];

    const baseResourceGroups = [
        { name: "rg-prod-compute-core", subText: "Suscripción: Producción Core", baseCost: 3900 },
        { name: "rg-data-platform-analytics", subText: "Suscripción: Data Platform", baseCost: 3200 },
        { name: "rg-shared-network-hub", subText: "Suscripción: Shared Services", baseCost: 2450 },
        { name: "rg-prod-database-tier", subText: "Suscripción: Producción Core", baseCost: 2100 },
        { name: "rg-stg-appservice-frontend", subText: "Suscripción: Staging", baseCost: 1650 },
        { name: "rg-monitoring-loganalytics", subText: "Suscripción: Shared Services", baseCost: 1300 },
        { name: "rg-ai-models-foundry", subText: "Suscripción: Data Platform", baseCost: 980 },
        { name: "rg-security-perimeter-afw", subText: "Suscripción: Security Hub", baseCost: 820 },
        { name: "rg-dev-sandbox-microservices", subText: "Suscripción: Sandbox", baseCost: 650 },
        { name: "rg-storage-backups-archive", subText: "Suscripción: Producción Core", baseCost: 510 },
    ];

    const baseResources = [
        { name: "vm-app-frontend-cluster", subText: "Virtual Machines — rg-prod-compute-core", baseCost: 2400 },
        { name: "sqldb-core-business-critical", subText: "Azure SQL Database — rg-prod-database-tier", baseCost: 1950 },
        { name: "sa-analytics-datalake-zrs", subText: "Storage Accounts — rg-data-platform-analytics", baseCost: 1600 },
        { name: "redis-cache-premium-p2", subText: "Azure Cache for Redis — rg-prod-compute-core", baseCost: 1350 },
        { name: "azfw-perimeter-hub-01", subText: "Azure Firewall — rg-security-perimeter-afw", baseCost: 1100 },
        { name: "ca-payments-microservice", subText: "Azure Container Apps — rg-prod-compute-core", baseCost: 920 },
        { name: "search-enterprise-ai-s2", subText: "Azure AI Search — rg-ai-models-foundry", baseCost: 810 },
        { name: "er-circuit-direct-1gbps", subText: "ExpressRoute — rg-shared-network-hub", baseCost: 720 },
        { name: "law-centralized-telemetry", subText: "Log Analytics Workspace — rg-monitoring-loganalytics", baseCost: 630 },
        { name: "bastion-shared-hub-host", subText: "Azure Bastion — rg-shared-network-hub", baseCost: 450 },
    ];

    const totalAnalyzedCostUSD = round2(
        baseCostGroups.reduce((sum, item) => sum + item.baseCost * multiplier * timeFactor, 0)
    );

    const mapItems = (arr: typeof baseCostGroups): TopSpendItem[] => {
        return arr.slice(0, limit).map((item, idx) => {
            const costUSD = round2(item.baseCost * multiplier * timeFactor);
            const sharePercentage = totalAnalyzedCostUSD > 0 ? round2((costUSD / totalAnalyzedCostUSD) * 100) : 0;
            return {
                id: `item-${idx + 1}-${item.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
                name: item.name,
                subText: item.subText,
                costUSD,
                sharePercentage,
            };
        });
    };

    return {
        topCostGroups: mapItems(baseCostGroups),
        topSubscriptions: mapItems(baseSubscriptions),
        topResourceGroups: mapItems(baseResourceGroups),
        topResources: mapItems(baseResources),
        totalAnalyzedCostUSD,
        unattributedSubscriptionCost: round2(120 * multiplier * timeFactor),
        timeframe,
        topLimit: limit,
        mock: true,
    };
}

export async function getLiveTopSpend(
    tenantId: string,
    timeframe: TopSpendTimeframe = "30d",
    limit: number = 5
): Promise<TopSpendSummary> {
    const timeCondition = timeframe === "mtd"
        ? "DATE(COALESCE(ChargePeriodStart, date)) >= DATE_FORMAT(NOW(), '%Y-%m-01')"
        : "DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)";

    // 1. Total Analizado
    const [totalRows]: any = await pool.query(
        `SELECT SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS totalCost
         FROM CostSnapshots
         WHERE tenant_id = ? AND ${timeCondition}`,
        [tenantId]
    );
    const totalAnalyzedCostUSD = Number(Number(totalRows?.[0]?.totalCost || 0).toFixed(2));

    const round2 = (x: number) => Math.round(x * 100) / 100;

    // 2. Cost Groups (agrupado por tag CostCenter o Project)
    const [costGroupRows]: any = await pool.query(
        `SELECT COALESCE(
                    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')), 'null'),
                    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.Costcenter')), 'null'),
                    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.Project')), 'null'),
                    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.Environment')), 'null'),
                    'Untagged'
                ) AS name,
                SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS cost
         FROM CostSnapshots
         WHERE tenant_id = ? AND ${timeCondition}
         GROUP BY name
         ORDER BY cost DESC
         LIMIT ?`,
        [tenantId, limit]
    );

    const topCostGroups: TopSpendItem[] = (costGroupRows || []).map((r: any, idx: number) => {
        const costUSD = round2(Number(r.cost) || 0);
        const isUntagged = r.name === "Untagged" || !r.name;
        return {
            id: `cg-${idx + 1}-${String(r.name || "untagged").toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
            name: r.name || "Untagged",
            subText: isUntagged ? "Sin centro de costo asignado" : `Cost Center: ${r.name}`,
            costUSD,
            sharePercentage: totalAnalyzedCostUSD > 0 ? round2((costUSD / totalAnalyzedCostUSD) * 100) : 0,
        };
    });

    // 3. Suscripciones (con resolución de nombres y manejo de unattributed)
    const [allSubRows]: any = await pool.query(
        `SELECT subscription_id AS name, SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS cost
         FROM CostSnapshots
         WHERE tenant_id = ? AND ${timeCondition}
         GROUP BY subscription_id
         ORDER BY cost DESC`,
        [tenantId]
    );

    const allSubs: Array<{ name: string; cost: number }> = (allSubRows || []).map((r: any) => ({
        name: String(r.name || "unknown"),
        cost: Number(r.cost) || 0,
    }));

    const unattributedSubscriptionCost = Number(
        allSubs.filter((s: { name: string; cost: number }) => isUnattributedSubscriptionId(s.name)).reduce((sum: number, s: { name: string; cost: number }) => sum + s.cost, 0).toFixed(2)
    );

    const filteredSubs = allSubs.filter((s: { name: string; cost: number }) => !isUnattributedSubscriptionId(s.name)).slice(0, limit);

    let subMap: Map<string, string> = new Map<string, string>();
    try {
        const credential = await getAzureCredential(tenantId);
        subMap = await getSubscriptionNameMap(tenantId, credential);
    } catch (e) {
        console.warn("[azureTopSpend.service] subscriptionNameMap error:", errorMessage(e));
    }

    const topSubscriptions: TopSpendItem[] = filteredSubs.map((s: { name: string; cost: number }, idx: number) => {
        const resolvedName = resolveSubscriptionName(s.name, subMap);
        const costUSD = round2(s.cost);
        return {
            id: `sub-${idx + 1}-${s.name}`,
            name: resolvedName,
            subText: resolvedName !== s.name ? `ID: ${s.name}` : undefined,
            costUSD,
            sharePercentage: totalAnalyzedCostUSD > 0 ? round2((costUSD / totalAnalyzedCostUSD) * 100) : 0,
        };
    });

    // 4. Grupos de Recursos
    const [rgRows]: any = await pool.query(
        `SELECT resource_group AS name,
                subscription_id AS sub_id,
                SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS cost
         FROM CostSnapshots
         WHERE tenant_id = ? AND ${timeCondition} AND resource_group IS NOT NULL AND resource_group != ''
         GROUP BY resource_group, subscription_id
         ORDER BY cost DESC
         LIMIT ?`,
        [tenantId, limit]
    );

    const topResourceGroups: TopSpendItem[] = (rgRows || []).map((r: any, idx: number) => {
        const costUSD = round2(Number(r.cost) || 0);
        const subLabel = r.sub_id ? resolveSubscriptionName(r.sub_id, subMap) : undefined;
        return {
            id: `rg-${idx + 1}-${String(r.name).toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
            name: r.name || "unknown-rg",
            subText: subLabel ? `Suscripción: ${subLabel}` : undefined,
            costUSD,
            sharePercentage: totalAnalyzedCostUSD > 0 ? round2((costUSD / totalAnalyzedCostUSD) * 100) : 0,
        };
    });

    // 5. Recursos Individuales / Servicios Específicos
    const [resourceRows]: any = await pool.query(
        `SELECT service_name,
                resource_group,
                SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS cost
         FROM CostSnapshots
         WHERE tenant_id = ? AND ${timeCondition}
         GROUP BY service_name, resource_group
         ORDER BY cost DESC
         LIMIT ?`,
        [tenantId, limit]
    );

    const topResources: TopSpendItem[] = (resourceRows || []).map((r: any, idx: number) => {
        const costUSD = round2(Number(r.cost) || 0);
        const svc = r.service_name || "Servicio Azure";
        const rg = r.resource_group || "rg-default";
        return {
            id: `res-${idx + 1}-${String(svc).toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
            name: svc,
            subText: `Grupo: ${rg}`,
            costUSD,
            sharePercentage: totalAnalyzedCostUSD > 0 ? round2((costUSD / totalAnalyzedCostUSD) * 100) : 0,
        };
    });

    return {
        topCostGroups,
        topSubscriptions,
        topResourceGroups,
        topResources,
        totalAnalyzedCostUSD,
        unattributedSubscriptionCost,
        timeframe,
        topLimit: limit,
        mock: false,
    };
}
