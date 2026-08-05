// Route: /api/intelligence/billing
// Purpose: Real consumption data with breakdown by resource type
// Auth: requireTenantAccess
// Tier: Professional+

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";

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

        // Real data: aggregate from CostMeterSnapshots
        const conn = await pool.getConnection();
        try {
            const query = `
                SELECT 
                    COALESCE(SUM(cost_usd), 0) as total_cost,
                    COUNT(DISTINCT date) as days_with_data
                FROM CostMeterSnapshots
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
                    MeterCategory,
                    COALESCE(SUM(cost_usd), 0) as cost,
                    ROUND(COALESCE(SUM(cost_usd), 0) / ?, 4) * 100 as pct
                FROM CostMeterSnapshots
                WHERE 
                    tenant_id = ?
                    AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                GROUP BY MeterCategory
                ORDER BY cost DESC
            `;
            const [breakdown]: any = await conn.execute(breakdownQuery, [totalCost || 1, tenantId, days]);

            return NextResponse.json({
                mock: false,
                totalCost: Number(totalCost),
                breakdown: breakdown.map((row: any) => ({
                    name: row.MeterCategory || "Other",
                    cost: Number(row.cost),
                    pct: Number(row.pct),
                })),
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
