import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireTenantRole, AuthError } from "@/lib/requestAuth";
import { collectAdvisorData } from "@/modules/collectors/azure/advisorCollector";

import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { deleteResource } from "@/services/remediationService";
import pool, { initializeDatabase } from "@/modules/storage/db";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, action, resourceGroup, resourceName, resourceType, subscriptionId } = body;

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        if (action === 'delete') {
            // Eliminar un recurso es destructivo: mismo criterio de rol que
            // /api/remediation (Admin/Owner), no solo membresía al tenant.
            const identity = await requireTenantRole(request, tenantId, ["Admin", "Owner"]);
            await deleteResource(tenantId, identity.email, subscriptionId, resourceGroup, resourceName, resourceType);
            return NextResponse.json({ success: true, message: "Recurso eliminado" });
        }

        await requireTenantAccess(request, tenantId);
        
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
                // updated_at se refresca a mano (no solo vía ON UPDATE
                // CURRENT_TIMESTAMP): si category/resource_id no cambian entre
                // syncs (lo usual, una recomendación estable), MySQL trata el
                // UPDATE como no-op y NO dispara el trigger ON UPDATE — la fila
                // queda con el updated_at de su primer INSERT para siempre. Eso
                // hacía que /api/intelligence/kpis/coin (que filtra por
                // `updated_at >= NOW() - days`) perdiera de vista recomendaciones
                // reales apenas pasaba la ventana, mostrando 0 en tenants
                // productivos con recomendaciones vigentes pero sin cambios.
                await pool.query(
                    `INSERT INTO RecommendationActions (tenant_id, recommendation_id, category, resource_id, status)
                     VALUES (?, ?, ?, ?, 'open')
                     ON DUPLICATE KEY UPDATE category=COALESCE(VALUES(category), category), resource_id=COALESCE(VALUES(resource_id), resource_id), updated_at=CURRENT_TIMESTAMP`,
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
        scores: data.scores,
        scoreUnits: (data as any).scoreUnits || {}
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
