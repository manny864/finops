/**
 * GET /api/governance/reporting — reporting de gobernanza (3 vistas):
 * cumplimiento de Azure Policy, inventario de recursos, e inventario de
 * identidades/roles.
 *
 * RBAC app: requireTenantAccess (tenant-scoped). Tier: Enterprise (routeTiers).
 * Roles Azure requeridos: 'Reader' (ya en el tier Essential). Todo read-only.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getGovernanceReport } from "@/services/governanceReportingService";

export async function GET(request: NextRequest) {
    try {
        const tenantId = new URL(request.url).searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
        }

        try {
            await requireTenantAccess(request, tenantId);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("governance-reporting", tenantId));
        }

        try {
            const report = await getGovernanceReport(tenantId);
            return NextResponse.json(report);
        } catch (svcErr: any) {
            console.error("[governance-reporting] service error for tenant:", tenantId, svcErr?.message);
            return NextResponse.json({ success: false, mock: false, error: `Sin datos disponibles: ${svcErr?.message || "error"}` });
        }
    } catch (err: unknown) {
        console.error("[governance-reporting] handler error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
