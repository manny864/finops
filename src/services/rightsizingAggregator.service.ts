import { getSqlDbRightsizingRecommendations } from "@/modules/collectors/azure/sqlDbRightsizingService";
import { getVmssRightsizingRecommendations } from "@/modules/collectors/azure/vmssRightsizingService";
import { isMockTenant } from "@/lib/mockData";

export interface RightsizingItem {
    resourceName: string;
    currentSku: string;
    recommendedSku: string;
    monthlySavingsUSD: number;
}

export interface AggregatedRightsizingResult {
    recommendations: RightsizingItem[];
    totalSavingsUSD: number;
    candidatesCount: number;
}

const round2 = (n: number) => Math.round(Number(n) * 100) / 100;

/**
 * Agrega recomendaciones reales de rightsizing (SQL DBs y VMSS).
 */
export async function getRealRightsizingRecommendations(tenantId: string): Promise<AggregatedRightsizingResult> {
    if (isMockTenant(tenantId)) {
        const mockRecs: RightsizingItem[] = [
            { resourceName: "vm-app-frontend-01", currentSku: "Standard_D8s_v5", recommendedSku: "Standard_D4s_v5", monthlySavingsUSD: 240.0 },
            { resourceName: "vm-batch-processor-02", currentSku: "Standard_E8s_v5", recommendedSku: "Standard_D4s_v5", monthlySavingsUSD: 380.5 },
            { resourceName: "sqldb-analytics-lake", currentSku: "BusinessCritical_8vCore", recommendedSku: "GeneralPurpose_8vCore", monthlySavingsUSD: 493.0 },
        ];
        return {
            recommendations: mockRecs,
            totalSavingsUSD: 1113.5,
            candidatesCount: 6,
        };
    }

    const recommendations: RightsizingItem[] = [];

    // 1. SQL Database Rightsizing
    try {
        const sqlRes = await getSqlDbRightsizingRecommendations(tenantId);
        for (const row of sqlRes?.items || []) {
            if (row.estimatedSavings > 0) {
                recommendations.push({
                    resourceName: `${row.serverName}/${row.dbName}`,
                    currentSku: row.currentTier || "Standard",
                    recommendedSku: row.recommendedTier || "Optimized",
                    monthlySavingsUSD: round2(row.estimatedSavings),
                });
            }
        }
    } catch {
        // Aislamiento de falla
    }

    // 2. VMSS Rightsizing
    try {
        const vmssRes = await getVmssRightsizingRecommendations(tenantId, "");
        for (const row of vmssRes?.items || []) {
            if (row.estimatedSavings > 0) {
                recommendations.push({
                    resourceName: row.vmssName,
                    currentSku: `${row.currentSku} (${row.currentCapacity} inst.)`,
                    recommendedSku: `${row.currentSku} (${row.recommendedCapacity} inst.)`,
                    monthlySavingsUSD: round2(row.estimatedSavings),
                });
            }
        }
    } catch {
        // Aislamiento de falla
    }

    const totalSavingsUSD = round2(recommendations.reduce((acc, r) => acc + r.monthlySavingsUSD, 0));

    return {
        recommendations,
        totalSavingsUSD,
        candidatesCount: recommendations.length,
    };
}
