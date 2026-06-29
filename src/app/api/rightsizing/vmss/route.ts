import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";

const MOCK_ITEMS = [
    { vmssName: 'vmss-web-prod', subscriptionId: 'sub-1', resourceGroup: 'rg-prod', currentSku: 'Standard_D8s_v5', currentCapacity: 6, recommendedCapacity: 4, avgCpuPercent: 18.5, hasAutoscale: false, monthlyCost: 1840, estimatedSavings: 613, reason: 'Avg CPU <20% for 30d and no autoscale' },
    { vmssName: 'vmss-api', subscriptionId: 'sub-1', resourceGroup: 'rg-prod', currentSku: 'Standard_E4s_v5', currentCapacity: 4, recommendedCapacity: 3, avgCpuPercent: 42, hasAutoscale: true, monthlyCost: 760, estimatedSavings: 190, reason: 'Min instances could drop from 4 to 3' },
    { vmssName: 'vmss-batch', subscriptionId: 'sub-2', resourceGroup: 'rg-data', currentSku: 'Standard_F8s_v2', currentCapacity: 2, recommendedCapacity: 2, avgCpuPercent: 8, hasAutoscale: false, monthlyCost: 485, estimatedSavings: 340, reason: 'Downsize SKU from F8s_v2 to F4s_v2' },
];

const MOCK_RESPONSE = { success: true, mock: true, items: MOCK_ITEMS, totalSavings: 1143 };

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
                'SELECT * FROM VmssRecommendations WHERE tenant_id = ? ORDER BY estimated_savings DESC',
                [tenantId]
            );
            const items = rows || [];
            const totalSavings = items.reduce((sum: number, r: any) => sum + Number(r.estimated_savings || 0), 0);
            return NextResponse.json({ success: true, mock: false, items, totalSavings });
        } catch {
            return NextResponse.json(MOCK_RESPONSE);
        }
    } catch (error: any) {
        return NextResponse.json(MOCK_RESPONSE);
    }
}
