/**
 * GET /api/intelligence/cost-centers/resources — lista de recursos
 * individuales (id/name/type/resourceGroup) que componen un Centro de Costos
 * (o el bucket especial 'Sin asignar'), para poblar el drawer de detalle y
 * — en el caso de 'Sin asignar' — alimentar BulkTagModal con IDs reales para
 * la remediación "Aplicar Tags".
 */
import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockCostCenterResources } from "@/lib/mockData";
import { fetchResourcesInResourceGroups } from "@/lib/azureResourceCounts";

const UNASSIGNED_NAME = "Sin asignar";

async function getResourceGroupsForCostCenter(tenantId: string, costCenterName: string): Promise<string[]> {
    const tagPredicate = costCenterName === UNASSIGNED_NAME
        ? "(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')) IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')) = 'null')"
        : "JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')) = ?";
    const params = costCenterName === UNASSIGNED_NAME ? [tenantId] : [tenantId, costCenterName];

    const [rows]: any = await pool.query(
        `SELECT DISTINCT resource_group AS rg
         FROM CostSnapshots
         WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 2 MONTH)
           AND ${tagPredicate}`,
        params
    );
    return (rows as any[]).map(r => r.rg).filter(Boolean);
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const costCenterName = request.nextUrl.searchParams.get("costCenterName");
        if (!tenantId || !costCenterName) return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });

        await requireTenantRole(request, tenantId, ["Admin", "Owner", "Reader", "Colaborador"]);
        await requireTenantTier(request, tenantId, "Business");

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockCostCenterResources(costCenterName, "enterprise"));
        }

        const rgNames = await getResourceGroupsForCostCenter(tenantId, costCenterName);
        const resources = await fetchResourcesInResourceGroups(tenantId, rgNames);

        return NextResponse.json({ success: true, costCenterName, resourceGroups: rgNames, resources });
    } catch (err: unknown) {
        if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
        console.error("[cost-centers/resources] GET error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
