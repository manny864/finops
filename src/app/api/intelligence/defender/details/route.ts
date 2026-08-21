/**
 * GET /api/intelligence/defender/details
 * Microsoft Defender for Cloud — Cobertura por Recurso y FinOps de Planes
 *
 * RBAC: requireTenantTier(Business) para tenants reales; bypass para demo/mock.
 * `isMockTenant` corre ANTES del guard: la rama mock son literales sinteticos
 * puros. Tolerancia cero a fallback mock en tenants conectados.
 *
 * RBAC Azure minimo: `Security Reader` (pricings) + `Reader` (Resource Graph).
 *
 * La logica vive en src/services/azureDefender.service.ts; esta ruta solo
 * resuelve auth, filtros y forma de respuesta.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  fetchLiveDefenderData,
  getMockDefenderPayload,
} from "@/services/azureDefender.service";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      return NextResponse.json(getMockDefenderPayload(tenantId));
    }

    await requireTenantTier(request, tenantId, "Business");

    const subscriptionIds =
      searchParams
        .get("subscriptionIds")
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) || [];

    const payload = await fetchLiveDefenderData(tenantId, subscriptionIds);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Defender for Cloud] Error:", error);
    return NextResponse.json(
      { error: "Error interno procesando Microsoft Defender for Cloud" },
      { status: 500 }
    );
  }
}
