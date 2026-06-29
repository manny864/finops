import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";

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

        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        const decoded = jwt.decode(authHeader.split(" ")[1]) as any;
        if (!decoded?.tid) return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        const email = (decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "").toLowerCase();
        const isSuperAdmin = email.endsWith("@cscloudsolutions.com.ar");
        if (decoded.tid !== tenantId && !isSuperAdmin) return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });

        if (isMockTenant(tenantId)) return NextResponse.json(MOCK_RESPONSE);

        try {
            const [rows]: any = await pool.query(
                'SELECT * FROM AppServiceRecommendations WHERE tenant_id = ? ORDER BY estimated_savings DESC',
                [tenantId]
            );
            const items = rows || [];
            const totalSavings = items.reduce((sum: number, r: any) => sum + Number(r.estimated_savings || 0), 0);
            return NextResponse.json({ success: true, mock: false, items, totalSavings });
        } catch {
            return NextResponse.json(MOCK_RESPONSE);
        }
    } catch {
        return NextResponse.json(MOCK_RESPONSE);
    }
}
