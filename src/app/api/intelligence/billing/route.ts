// Route: /api/intelligence/billing
// Purpose: Real consumption data with breakdown by resource type
// Auth: requireTenantAccess
// Tier: Professional+

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getCachedCarbonFootprint } from "@/lib/carbonFootprint";

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

        // Real data: aggregate from CostSnapshots (same source as whiteboard KPIs)
        const conn = await pool.getConnection();
        try {
            const query = `
                SELECT 
                    COALESCE(SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)), 0) as total_cost,
                    COUNT(DISTINCT date) as days_with_data
                FROM CostSnapshots
                WHERE 
                    tenant_id = ?
                    AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                LIMIT 1
            `;
            const [rows]: any = await conn.execute(query, [tenantId, days]);
            const totalCost = rows[0]?.total_cost || 0;

            // Breakdown by category
            const breakdownQuery = `
                SELECT 
                    COALESCE(NULLIF(service_name, ''), 'Other') as service_name,
                    COALESCE(SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)), 0) as cost,
                    ROUND(COALESCE(SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)), 0) / ?, 4) * 100 as pct
                FROM CostSnapshots
                WHERE 
                    tenant_id = ?
                    AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                GROUP BY service_name
                ORDER BY cost DESC
                LIMIT 10
            `;
            const [breakdown]: any = await conn.execute(breakdownQuery, [totalCost || 1, tenantId, days]);
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
                totalCost: Number(totalCost),
                breakdown: breakdown.map((row: any) => ({
                    name: row.service_name || "Other",
                    cost: Number(row.cost),
                    pct: Number(row.pct),
                })),
                environmentalImpact,
                environmentalImpactSource,
                byRegion: carbonFootprint?.byRegion || [],
                period: {
                    start: new Date(Date.now() - days * 86400000).toISOString().split("T")[0],
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
