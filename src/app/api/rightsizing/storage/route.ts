import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";

const MOCK_ITEMS = [
    { accountName: 'stproddata01', containerName: 'archives', subscriptionId: 'sub-1', resourceGroup: 'rg-prod', currentTier: 'Hot', recommendedTier: 'Cool', usedGb: 18500, monthlyCost: 340, estimatedSavings: 155, reason: '<1 access/day, ideal for Cool' },
    { accountName: 'stbackups', containerName: 'snapshots', subscriptionId: 'sub-1', resourceGroup: 'rg-backups', currentTier: 'Hot', recommendedTier: 'Archive', usedGb: 42000, monthlyCost: 775, estimatedSavings: 734, reason: 'Backups read <1x/month, candidate for Archive' },
    { accountName: 'stmedia', containerName: 'thumbnails', subscriptionId: 'sub-2', resourceGroup: 'rg-media', currentTier: 'Cool', recommendedTier: 'Hot', usedGb: 850, monthlyCost: 8.50, estimatedSavings: -3, reason: 'Frequently accessed; move back to Hot' },
];

const MOCK_RESPONSE = {
    success: true, mock: true, items: MOCK_ITEMS,
    totalSavings: MOCK_ITEMS.reduce((s, i) => s + i.estimatedSavings, 0),
};

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        try {
            await requireTenantRole(request, tenantId, ['Admin', 'Owner']);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        if (isMockTenant(tenantId)) return NextResponse.json(MOCK_RESPONSE);

        try {
            const [rows]: any = await pool.query(
                'SELECT * FROM StorageRecommendations WHERE tenant_id = ? ORDER BY estimated_savings DESC',
                [tenantId]
            );
            const items = rows || [];
            const totalSavings = items.reduce((sum: number, r: any) => sum + Number(r.estimated_savings || 0), 0);
            return NextResponse.json({ success: true, mock: false, items, totalSavings });
        } catch (dbErr: any) {
            console.error("[rightsizing/storage] DB error for real tenant:", tenantId, dbErr?.message);
            return NextResponse.json({ success: false, mock: false, items: [], totalSavings: 0, error: `Sin datos: ${dbErr?.message || "error"}` });
        }
    } catch (err: unknown) {
        console.error("[rightsizing/storage] handler error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, mock: false, items: [], totalSavings: 0, error: "Internal server error" }, { status: 500 });
    }
}
