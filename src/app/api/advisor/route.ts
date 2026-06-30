import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { collectAdvisorData } from "@/modules/collectors/azure/advisorCollector";

import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { deleteResource } from "@/services/remediationService";
import pool, { initializeDatabase } from "@/modules/storage/db";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, action, resourceGroup, resourceName, resourceType, subscriptionId } = body;

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        const identity = await requireTenantAccess(request, tenantId);
        const email = identity.email;

        if (action === 'delete') {
            await deleteResource(tenantId, email, subscriptionId, resourceGroup, resourceName, resourceType);
            return NextResponse.json({ success: true, message: "Recurso eliminado" });
        }
        
        return NextResponse.json({ error: "Acción no soportada por el orquestador." }, { status: 400 });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Action Center Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}


export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    const localeParam = request.nextUrl.searchParams.get('locale');
    const locale = localeParam || request.headers.get('accept-language') || 'es';
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    await requireTenantAccess(request, tenantId);

    const cacheKey = `advisor:${tenantId}:${locale}`;
    const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
        return await collectAdvisorData(tenantId, locale);
    }, 3600);

    // IT-06: filtrar/marcar recomendaciones suprimidas + upsert 'open' para tracking COIN (IT-05).
    let suppressedSet = new Set<string>();
    try {
        await initializeDatabase();
        // Auto-expira suppressions vencidas
        await pool.query(
            `UPDATE RecommendationActions SET status='open', updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=? AND status='suppressed' AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP`,
            [tenantId]
        );
        const [supRows]: any = await pool.query(
            `SELECT recommendation_id FROM RecommendationActions
             WHERE tenant_id=? AND status='suppressed' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
            [tenantId]
        );
        suppressedSet = new Set((supRows as any[]).map(r => r.recommendation_id));

        // Upsert 'open' para cada rec recibida (no pisa estados ya gestionados).
        // data.recommendations es un dict { Cost: [...], Performance: [...], ... }.
        const recGroups: Record<string, any[]> = (data?.recommendations as any) || {};
        const allRecs: any[] = Object.values(recGroups).flat() as any[];
        for (const r of allRecs) {
            const recId = r.id || r.recommendationId;
            if (!recId) continue;
            const cat = r.category || r.recommendationType || null;
            const resId = r.resourceId || r.impactedValue || null;
            try {
                await pool.query(
                    `INSERT INTO RecommendationActions (tenant_id, recommendation_id, category, resource_id, status)
                     VALUES (?, ?, ?, ?, 'open')
                     ON DUPLICATE KEY UPDATE category=COALESCE(VALUES(category), category), resource_id=COALESCE(VALUES(resource_id), resource_id)`,
                    [tenantId, recId, cat, resId]
                );
            } catch (e: any) {
                console.warn("[advisor] upsert RecommendationActions falló:", e?.message);
            }
        }
    } catch (e: any) {
        console.warn("[advisor] tracking suppressions/COIN no disponible:", e?.message);
    }

    // Filtrar suprimidas preservando la estructura agrupada.
    const groupedSrc: Record<string, any[]> = (data?.recommendations as any) || {};
    const filteredRecs: Record<string, any[]> = {};
    for (const [cat, arr] of Object.entries(groupedSrc)) {
        filteredRecs[cat] = (arr as any[]).filter((r: any) => {
            const id = r.id || r.recommendationId;
            return id ? !suppressedSet.has(id) : true;
        });
    }

    return NextResponse.json({
        success: true,
        recommendations: filteredRecs,
        suppressedCount: suppressedSet.size,
        subscriptions: data.subscriptions,
        scores: data.scores
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Advisor Error:", error);
    const err = error as { code?: string; message?: string };
    
    if (err.code === "MISSING_RBAC_ROLE") {
        return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en las suscripciones." }, { status: 403 });
    }

    if (err.message && err.message.includes("AADSTS7000229")) {
      return NextResponse.json({
        error: "MISSING_ADMIN_CONSENT",
        details: "Falta el Service Principal en el Tenant destino. Debe proporcionar Admin Consent a la aplicación."
      }, { status: 403 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
