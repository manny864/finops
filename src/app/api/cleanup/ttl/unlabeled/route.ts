/**
 * GET /api/cleanup/ttl/unlabeled — recursos SIN tag ExpireOn/TTL cuyo tipo
 * coincide con alguna política TTL activa (paso 2 del manual: "etiquetás los
 * recursos afectados con la fecha de expiración"). Para cada recurso se
 * sugiere una fecha de expiración = hoy + días de vida de la política que lo
 * cubre; el etiquetado en sí se aplica vía POST /api/tags/apply (ya existente,
 * merge de tags genérico) con { ExpireOn: <fecha sugerida o editada> }.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getUnlabeledResources, TTL_RESOURCE_TYPES, TtlResourceType } from "@/services/ttlService";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("ttl_unlabeled", tenantId));
        }

        const [policyRows]: any = await pool.query(
            `SELECT resource_type AS resourceType, days_to_live AS daysToLive
             FROM TtlPolicies WHERE tenant_id = ? AND enabled = TRUE`,
            [tenantId]
        );

        const policies = (policyRows || []) as Array<{ resourceType: string; daysToLive: number }>;
        if (policies.length === 0) {
            return NextResponse.json({ success: true, resources: [] });
        }

        const daysByType = new Map<string, number>(policies.map(p => [p.resourceType, p.daysToLive]));
        const types = Array.from(daysByType.keys()).filter((t): t is TtlResourceType =>
            (TTL_RESOURCE_TYPES as readonly string[]).includes(t)
        );

        const resourcesByType = await Promise.all(types.map(async (resourceType) => {
            const resources = await getWithStaleWhileRevalidate(
                `ttl:unlabeled:v1:${tenantId}:${resourceType}`,
                () => getUnlabeledResources(tenantId, resourceType),
                600,
                120
            );
            const daysToLive = daysByType.get(resourceType) || 30;
            const suggested = new Date();
            suggested.setUTCDate(suggested.getUTCDate() + daysToLive);
            const suggestedExpiration = suggested.toISOString().slice(0, 10);
            return (resources as any[]).map(r => ({ ...r, suggestedExpiration }));
        }));

        return NextResponse.json({ success: true, resources: resourcesByType.flat() });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[ttl/unlabeled] GET error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
