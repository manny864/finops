import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getAdvisorExecutiveData, generateMockAdvisorData } from "@/services/azureAdvisor.service";
import { narrateAdvisorRecommendations } from "@/services/advisorRemediationNarration";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { redis } from "@/lib/redis";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    const localeParam = request.nextUrl.searchParams.get('locale');
    const subscriptionId = request.nextUrl.searchParams.get('subscriptionId') || undefined;
    const locale = localeParam || request.headers.get('accept-language') || 'es';
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    // ORDEN CRÍTICO: El check isMockTenant DEBE evaluarse ANTES de requireTenantAccess
    if (isMockTenant(tenantId)) {
        const mockResult = generateMockAdvisorData(locale);
        const scoresMap: Record<string, any> = {
          '11111111-2222-3333-4444-555555555555': {
            Advisor: mockResult.overallScore,
            Cost: mockResult.pillars.Cost.scorePercentage,
            Security: mockResult.pillars.Security.scorePercentage,
            HighAvailability: mockResult.pillars.HighAvailability.scorePercentage,
            Performance: mockResult.pillars.Performance.scorePercentage,
            OperationalExcellence: mockResult.pillars.OperationalExcellence.scorePercentage,
          },
          '22222222-3333-4444-5555-666666666666': {
            Advisor: 72.0,
            Cost: 15,
            Security: 65,
            HighAvailability: 90,
            Performance: 100,
            OperationalExcellence: 85,
          }
        };

        return NextResponse.json({
            ...mockResult,
            scores: scoresMap,
            scoreUnits: {},
        });
    }

    await requireTenantAccess(request, tenantId);

    // bust=1: tras posponer/reactivar una recomendacion hay que saltar la cache,
    // si no la SWR de 30 min sigue sirviendo la recomendacion ya pospuesta.
    const cacheKey = `advisor:v4:${tenantId}:${locale}:${subscriptionId || 'all'}`;
    if (request.nextUrl.searchParams.get('bust') === '1') {
        try { await redis.del(cacheKey); } catch { /* cache opcional */ }
    }
    const advisorData = await getWithStaleWhileRevalidate(cacheKey, async () => {
        const data = await getAdvisorExecutiveData(tenantId, locale, subscriptionId);
        // MEJ-06: reescribe la prosa con IA si el tenant la tiene configurada
        // (best-effort, cacheada por regla -- ver advisorRemediationNarration.ts).
        // Va DENTRO del fetcher de la SWR de 30 min: no se reintenta en cada
        // request, solo cuando esta cache exterior expira. Solo se aplica acá,
        // no en collectAdvisorData: coinIndexService y whiteboard/route.ts
        // consumen los mismos datos para puntajes, no para mostrar prosa, y
        // no deben pagar el costo de una reescritura que no van a mostrar.
        const allRecs = Object.values(data.recommendations).flat();
        await narrateAdvisorRecommendations(allRecs, tenantId, locale).catch((err) => {
            console.error("[Advisor] narrateAdvisorRecommendations fallo (se conserva el texto determinista):", err);
        });
        return data;
    }, 1800);

    return NextResponse.json(advisorData);
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
