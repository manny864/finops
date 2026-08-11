// Route: /api/intelligence/billing
// Purpose: Real consumption data with breakdown by resource type
// Auth: requireTenantAccess
// Tier: Professional+

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getCachedCarbonFootprint } from "@/lib/carbonFootprint";
import { getCurrentMonthAmortizedCosts } from "@/modules/collectors/azure/billingService";
import Decimal from "decimal.js";
import type { RowDataPacket } from "mysql2";

type TotalCostRow = RowDataPacket & { total_cost: string | number | null };
type BreakdownRow = RowDataPacket & {
    service_name: string | null;
    cost: string | number | null;
};

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        const days = Math.min(parseInt(searchParams.get("days") || "30"), 90);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("billing", tenantId));
        }

        // Real data: fuente primaria = Cost Management live (MTD).
        // Fallback = CostSnapshots para resiliencia cuando Azure no responde.
        const conn = await pool.getConnection();
        try {
            const subscriptionId = searchParams.get("subscriptionId") || "All";
            let totalCost = new Decimal(0);
            let breakdownRows: Array<{ name: string; cost: Decimal }> = [];
            let source: "live-cost-management" | "snapshot-fallback" = "live-cost-management";

            try {
                const entries = await getCurrentMonthAmortizedCosts(tenantId, subscriptionId, "ActualCost");
                const byService = new Map<string, Decimal>();
                for (const entry of entries || []) {
                    const cost = new Decimal(entry.EffectiveCost || entry.BilledCost || 0);
                    if (cost.lte(0)) continue;
                    totalCost = totalCost.plus(cost);
                    const serviceName = (entry.ServiceName || "Other").trim() || "Other";
                    byService.set(serviceName, (byService.get(serviceName) || new Decimal(0)).plus(cost));
                }
                breakdownRows = Array.from(byService.entries())
                    .map(([name, cost]) => ({ name, cost }))
                    .sort((a, b) => b.cost.minus(a.cost).toNumber())
                    .slice(0, 10);
            } catch (azureErr) {
                source = "snapshot-fallback";
                const query = `
                    SELECT 
                        COALESCE(SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)), 0) as total_cost
                    FROM CostSnapshots
                    WHERE 
                        tenant_id = ?
                        AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
                    LIMIT 1
                `;
                const [rows] = await conn.execute<TotalCostRow[]>(query, [tenantId]);
                totalCost = new Decimal(rows[0]?.total_cost || 0);

                const breakdownQuery = `
                    SELECT 
                        COALESCE(NULLIF(service_name, ''), 'Other') as service_name,
                        COALESCE(SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)), 0) as cost
                    FROM CostSnapshots
                    WHERE 
                        tenant_id = ?
                        AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
                    GROUP BY service_name
                    ORDER BY cost DESC
                    LIMIT 10
                `;
                const [breakdown] = await conn.execute<BreakdownRow[]>(breakdownQuery, [tenantId]);
                breakdownRows = (breakdown || []).map((row) => ({
                    name: row.service_name || "Other",
                    cost: new Decimal(row.cost || 0),
                }));
                console.warn("[/api/intelligence/billing] Falling back to snapshots:", (azureErr as Error)?.message);
            }

            const carbonFootprint = await getCachedCarbonFootprint(tenantId, "All").catch(() => null);
            let environmentalImpact = 0;
            let environmentalImpactSource: "avoided" | "footprint" | "none" = "none";
            if (carbonFootprint && !carbonFootprint.degraded) {
                const avoided = Number(carbonFootprint.avoided || 0);
                const footprint = Number(carbonFootprint.footprint || 0);
                if (avoided > 0) {
                    environmentalImpact = avoided;
                    environmentalImpactSource = "avoided";
                } else if (footprint > 0) {
                    environmentalImpact = footprint;
                    environmentalImpactSource = "footprint";
                }
            }

            return NextResponse.json({
                mock: false,
                source,
                totalCost: Number(totalCost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                breakdown: breakdownRows.map((row) => {
                    const pct = totalCost.gt(0) ? row.cost.dividedBy(totalCost).times(100) : new Decimal(0);
                    return {
                        name: row.name,
                        cost: Number(row.cost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                        pct: Number(pct.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                    };
                }),
                environmentalImpact,
                environmentalImpactSource,
                byRegion: carbonFootprint?.byRegion || [],
                period: {
                    start: `${new Date().toISOString().slice(0, 7)}-01`,
                    end: new Date().toISOString().split("T")[0],
                    days,
                },
            });
        } finally {
            conn.release();
        }
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[/api/intelligence/billing]", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
