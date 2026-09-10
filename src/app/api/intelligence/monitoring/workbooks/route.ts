/**
 * GET /api/intelligence/monitoring/workbooks
 * Azure Monitor Workbooks — Gobernanza de Dashboards y Costo Indirecto de Consultas
 *
 * RBAC: requireTenantTier(Enterprise) para tenants reales; bypass para demo/mock.
 * El tier se valida server-side porque RouteTierGate/Sidebar son solo client-side
 * y no impiden que un tenant Professional le pegue directo a la API
 * (finding SEC-02, docs/security/audit-2026-08-21.md).
 *
 * El check `isMockTenant` corre ANTES del guard: la rama mock devuelve
 * exclusivamente literales sinteticos, sin tocar Azure, DB ni Redis, asi que no
 * expone estado real a un llamador anonimo. Tolerancia cero a fallback mock en
 * tenants conectados: un tenant sin workbooks recibe el estado vacio real.
 *
 * RBAC Azure minimo: `Reader` sobre las suscripciones (lectura via Resource Graph).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  fetchLiveWorkbooksData,
  getMockWorkbooksPayload,
} from "@/services/azureWorkbooks.service";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId parameter" }, { status: 400 });
    }

    // 1. Tenant demo/mock primero: datos sinteticos sin exigir token.
    if (isMockTenant(tenantId)) {
      return NextResponse.json(getMockWorkbooksPayload(tenantId));
    }

    // 2. RBAC estricto + entitlement de tier para tenants reales.
    await requireTenantTier(request, tenantId, "Enterprise");

    // 3. Descubrimiento vivo en Azure Resource Graph.
    const livePayload = await fetchLiveWorkbooksData(tenantId);
    return NextResponse.json(livePayload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Workbooks Governance] Error:", error);
    return NextResponse.json(
      { error: "Error interno procesando Workbooks de Azure Monitor" },
      { status: 500 }
    );
  }
}
