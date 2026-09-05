import { NextRequest, NextResponse } from "next/server";
import { requireRequestIdentity, requireTenantAccess, AuthError } from "@/lib/requestAuth";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { getCopilotConfig } from "@/lib/copilotConfig";
import { isMockTenant } from "@/lib/mockData";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const isDemoTenant = tenantId && isMockTenant(tenantId);
        
        let effectiveTenantId = tenantId;
        if (!isDemoTenant) {
            const identity = await requireRequestIdentity(request);
            // SEC-01 (auditoría 2026-09-04): `requireRequestIdentity` AUTENTICA,
            // no autoriza — valida la firma del token y devuelve `claims.tid`,
            // sin comprobar pertenencia a ningún tenant de la plataforma. Y el
            // `tenantId` del query string tiene precedencia sobre la identidad,
            // así que cualquier usuario autenticado podía pedir la cuota de otro
            // tenant y obtener su tier, si tiene clave de IA propia, y sus
            // contadores de uso del Copilot.
            if (tenantId) {
                await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
            }
            effectiveTenantId = tenantId || identity.tenantId;
        }

        if (isDemoTenant) {
            return NextResponse.json({
                tier: "Enterprise",
                monthly: { limit: null, used: 0, remaining: null },
            });
        }

        await initializeDatabase();
        
        const [tenantRows]: any = await pool.query(
            "SELECT tier, ai_enabled, ai_provider, ai_api_key FROM Tenants WHERE tenant_id = ? LIMIT 1",
            [effectiveTenantId]
        );
        const tenantRow = tenantRows[0];
        
        if (!tenantRow || !tenantRow.ai_enabled) {
            return NextResponse.json({
                tier: tenantRow?.tier || "Professional",
                monthly: { limit: 0, used: 0, remaining: 0 },
                aiDisabled: true
            });
        }

        const isByok = Boolean(
            tenantRow?.ai_provider &&
            tenantRow.ai_provider !== 'system' &&
            tenantRow.ai_api_key
        );

        const tier = tenantRow.tier || "Professional";
        const copilotConfig = getCopilotConfig(tier, isByok);

        const [usedRows]: any = await pool.query(
            `SELECT COUNT(*) AS c FROM CopilotUsage
             WHERE tenant_id = ?
               AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')`,
            [effectiveTenantId]
        );
        
        const used = Number(usedRows[0]?.c || 0);
        const limit = copilotConfig.monthlyQueryQuota;
        const remaining = limit === null ? null : Math.max(0, limit - used);

        return NextResponse.json({
            tier,
            isByok,
            monthly: { limit, used, remaining },
        });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[Copilot Quota] GET error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
