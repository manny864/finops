/**
 * GET /api/intelligence/waf
 * Azure WAF — Seguridad Perimetral y Economia Unitaria
 *
 * RBAC: requireTenantTier(Business) para tenants reales; bypass para demo/mock.
 * `isMockTenant` corre ANTES del guard: la rama mock son literales sinteticos
 * puros. Tolerancia cero a fallback mock en tenants conectados — en un panel de
 * seguridad, inventar amenazas seria mucho peor que en uno de costos.
 *
 * RBAC Azure minimo: `Reader` (Resource Graph) y `Log Analytics Reader` sobre el
 * workspace de diagnostico para la telemetria de amenazas.
 *
 * La logica vive en src/services/azureWaf.service.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { fetchLiveWafData, getMockWafPayload } from "@/services/azureWaf.service";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId parameter" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      return NextResponse.json(getMockWafPayload(tenantId));
    }

    await requireTenantTier(request, tenantId, "Business");

    const payload = await fetchLiveWafData(tenantId);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API WAF Security] Error:", error);
    return NextResponse.json(
      { error: "Error interno procesando Azure WAF" },
      { status: 500 }
    );
  }
}
