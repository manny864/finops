import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";

/**
 * GET /api/intelligence/applied-savings?tenantId=&days=30
 *
 * "Ahorro Aplicado": a diferencia del ahorro POTENCIAL de Advisor (recomendaciones
 * sin ejecutar), esto suma el ahorro estimado de los recursos zombie que el
 * usuario YA eliminó vía /api/remediation (ActionLogs.action_type='DELETE_RESOURCE',
 * status='SUCCESS'), inferido por tipo de recurso a partir del resource_id.
 * No requiere una columna de costo nueva: reutiliza los mismos estimados por
 * tipo que ya se muestran como "ahorro potencial" en InteractiveDashboard.
 */

// Mismos estimados de ahorro mensual por tipo que fallbackSavings en
// InteractiveDashboard.tsx, pero indexados por el slug de ARM type en minúsculas
// (tal como aparece en resource_id) para poder inferirlos sin una columna nueva.
const SAVINGS_BY_ARM_TYPE: Array<{ match: string; monthly: number }> = [
    { match: "microsoft.compute/disks", monthly: 15.0 },
    { match: "microsoft.compute/snapshots", monthly: 5.0 },
    { match: "microsoft.network/publicipaddresses", monthly: 3.5 },
    { match: "microsoft.web/serverfarms", monthly: 45.0 },
    { match: "microsoft.sql/servers/elasticpools", monthly: 250.0 },
    { match: "microsoft.network/loadbalancers", monthly: 18.0 },
    { match: "microsoft.network/frontdoorwebapplicationfirewallpolicies", monthly: 5.0 },
    { match: "microsoft.network/trafficmanagerprofiles", monthly: 3.0 },
    { match: "microsoft.network/applicationgateways", monthly: 180.0 },
    { match: "microsoft.network/natgateways", monthly: 32.0 },
    { match: "microsoft.network/privateendpoints", monthly: 7.0 },
    { match: "microsoft.network/virtualnetworkgateways", monthly: 130.0 },
    { match: "microsoft.network/ddosprotectionplans", monthly: 2944.0 },
    { match: "microsoft.network/privatednszones", monthly: 0.25 },
    { match: "microsoft.dbforpostgresql/flexibleservers", monthly: 25.0 },
    { match: "microsoft.dbformysql/flexibleservers", monthly: 25.0 },
    { match: "microsoft.documentdb", monthly: 24.0 },
    { match: "microsoft.eventhub", monthly: 11.0 },
    { match: "microsoft.servicebus", monthly: 10.0 },
    { match: "microsoft.apimanagement", monthly: 50.0 },
    { match: "microsoft.network/expressroutecircuits", monthly: 55.0 },
    { match: "microsoft.network/applicationgatewaywebapplicationfirewallpolicies", monthly: 5.0 },
    { match: "microsoft.compute/virtualmachines", monthly: 30.0 },
];

function estimateMonthlySavings(resourceId: string): number {
    const lower = (resourceId || "").toLowerCase();
    const hit = SAVINGS_BY_ARM_TYPE.find((s) => lower.includes(s.match));
    return hit ? hit.monthly : 10.0; // fallback genérico para tipos no listados
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const days = Math.min(365, Math.max(1, Number(request.nextUrl.searchParams.get("days")) || 30));
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, appliedSavings: 380.5, actionsCount: 6 });
        }

        const [rows]: any = await pool.query(
            `SELECT resource_id FROM ActionLogs
              WHERE tenant_id = ? AND action_type = 'DELETE_RESOURCE' AND status = 'SUCCESS'
                AND timestamp >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
            [tenantId, days]
        );

        const appliedSavings = (rows as any[]).reduce(
            (sum, r) => sum + estimateMonthlySavings(r.resource_id), 0
        );

        return NextResponse.json({
            success: true,
            appliedSavings: Math.round(appliedSavings * 100) / 100,
            actionsCount: (rows as any[]).length,
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[applied-savings] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
