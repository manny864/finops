// Route: /api/intelligence/billing
// Purpose: Real consumption data with breakdown by resource type
// Auth: requireTenantAccess
// Tier: Professional+

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/requestAuth";
import { pool } from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";

export async function GET(request: NextRequest) {
    try {
        const { tenantId, isValid } = await requireTenantAccess(request);
        if (!isValid) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

        const searchParams = request.nextUrl.searchParams;
        const days = Math.min(parseInt(searchParams.get("days") || "30"), 90);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({
                mock: true,
                totalCost: 12543.75,
                breakdown: [
                    { name: "Compute", cost: 6250.00, pct: 49.8 },
                    { name: "Storage", cost: 3125.00, pct: 24.9 },
                    { name: "Networking", cost: 1562.50, pct: 12.4 },
                    { name: "Other", cost: 1606.25, pct: 12.8 },
                ],
                period: { start: new Date(Date.now() - days * 86400000).toISOString().split("T")[0], end: new Date().toISOString().split("T")[0], days },
            });
        }

        // Real data: aggregate from CostMeterSnapshots
        const conn = await pool.getConnection();
        try {
            const query = `
                SELECT 
                    COALESCE(SUM(CAST(billed_cost AS DECIMAL(19,2))), 0) as total_cost,
                    COUNT(DISTINCT DATE(snapshot_date)) as days_with_data
                FROM CostMeterSnapshots
                WHERE 
                    tenant_id = ?
                    AND snapshot_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
                LIMIT 1
            `;
            const [rows] = await conn.execute(query, [tenantId, days]);
            const totalCost = rows[0]?.total_cost || 0;

            // Breakdown by category
            const breakdownQuery = `
                SELECT 
                    meter_category,
                    COALESCE(SUM(CAST(billed_cost AS DECIMAL(19,2))), 0) as cost,
                    ROUND(COALESCE(SUM(CAST(billed_cost AS DECIMAL(19,2))), 0) / ? * 100, 1) as pct
                FROM CostMeterSnapshots
                WHERE 
                    tenant_id = ?
                    AND snapshot_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
                GROUP BY meter_category
                ORDER BY cost DESC
            `;
            const [breakdown] = await conn.execute(breakdownQuery, [totalCost || 1, tenantId, days]);

            conn.release();

            return NextResponse.json({
                mock: false,
                totalCost: Number(totalCost),
                breakdown: breakdown.map((row: any) => ({
                    name: row.meter_category || "Other",
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
    } catch (err: any) {
        console.error("[/api/intelligence/billing]", err);
        return NextResponse.json(
            { error: err.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
