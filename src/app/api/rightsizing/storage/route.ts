import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
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
                'SELECT * FROM StorageRecommendations WHERE tenant_id = ? ORDER BY estimated_savings DESC',
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
