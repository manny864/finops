/**
 * GET /api/intelligence/security/entra-id
 * Microsoft Entra ID — Gobernanza de Identidades y FinOps
 *
 * Ruta nueva y separada de la legacy /api/intelligence/entra-id, que sirve al
 * board de licenciamiento anterior con otra forma de respuesta y esta
 * interceptada por el monkey-patch de modo demo en TenantProvider. Cambiar
 * aquella habria roto ambas cosas.
 *
 * RBAC: requireTenantTier(Business) para tenants reales; bypass para demo/mock.
 * `isMockTenant` corre ANTES del guard: la rama mock son literales sinteticos
 * puros. Tolerancia cero a fallback mock en tenants conectados.
 *
 * RBAC minimo: Graph con Directory.Read.All + Organization.Read.All, y
 * AuditLog.Read.All para signInActivity (que ademas exige licencia P1 en el
 * tenant). Azure: `Reader` para Microsoft.AAD/domainServices.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  fetchLiveEntraIdData,
  getMockEntraIdPayload,
} from "@/services/azureEntraId.service";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId parameter" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      return NextResponse.json(getMockEntraIdPayload(tenantId));
    }

    await requireTenantTier(request, tenantId, "Business");

    const payload = await fetchLiveEntraIdData(tenantId);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Entra ID Governance] Error:", error);
    return NextResponse.json(
      { error: "Error interno procesando Microsoft Entra ID" },
      { status: 500 }
    );
  }
}
