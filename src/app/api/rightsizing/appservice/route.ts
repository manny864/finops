import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { errorMessage } from '@/lib/apiErrors';

const MOCK_ITEMS = [
    { planName: 'asp-web-prod', subscriptionId: 'sub-1', resourceGroup: 'rg-prod', currentSku: 'P2v3', recommendedSku: 'P1v3', avgCpuPercent: 22, avgMemPercent: 35, monthlyCost: 280, estimatedSavings: 140, reason: 'CPU<30% and MEM<40% 30d' },
    { planName: 'asp-api-dev', subscriptionId: 'sub-1', resourceGroup: 'rg-dev', currentSku: 'S2', recommendedSku: 'B2', avgCpuPercent: 5, avgMemPercent: 18, monthlyCost: 140, estimatedSavings: 90, reason: 'Dev env can use Basic tier' },
    { planName: 'asp-internal', subscriptionId: 'sub-1', resourceGroup: 'rg-internal', currentSku: 'P1v2', recommendedSku: 'P1v3', avgCpuPercent: 55, avgMemPercent: 60, monthlyCost: 150, estimatedSavings: 25, reason: 'Migrate from v2 to v3 (same perf, lower cost)' },
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
                'SELECT * FROM AppServiceRecommendations WHERE tenant_id = ? ORDER BY estimated_savings DESC',
                [tenantId]
            );
            const items = rows || [];
            const totalSavings = items.reduce((sum: number, r: any) => sum + Number(r.estimated_savings || 0), 0);
            return NextResponse.json({ success: true, mock: false, items, totalSavings });
        } catch (dbErr) {
            console.error("[rightsizing/appservice] DB error for real tenant:", tenantId, errorMessage(dbErr));
            return NextResponse.json({ success: false, mock: false, items: [], totalSavings: 0, error: `Sin datos: ${errorMessage(dbErr) || "error"}` });
        }
    } catch (err: unknown) {
        console.error("[rightsizing/appservice] handler error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, mock: false, items: [], totalSavings: 0, error: "Internal server error" }, { status: 500 });
    }
}
