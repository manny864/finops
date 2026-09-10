/**
 * GET /api/intelligence/monitoring/network-watcher
 * Azure Network Watcher — FinOps de Diagnostico de Red
 *
 * RBAC: requireTenantTier(Enterprise) para tenants reales; bypass para demo/mock.
 * El tier se valida server-side porque RouteTierGate/Sidebar son solo client-side
 * (finding SEC-02, docs/security/audit-2026-08-21.md).
 *
 * `isMockTenant` corre ANTES del guard: la rama mock son literales sinteticos
 * puros, sin acceso a Azure, DB ni Redis. Tolerancia cero a fallback mock en
 * tenants conectados.
 *
 * RBAC Azure minimo: `Reader` sobre las suscripciones.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  fetchLiveNetworkWatcherData,
  getMockNetworkWatcherPayload,
} from "@/services/azureNetworkWatcher.service";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId parameter" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      return NextResponse.json(getMockNetworkWatcherPayload(tenantId));
    }

    await requireTenantTier(request, tenantId, "Enterprise");

    const livePayload = await fetchLiveNetworkWatcherData(tenantId);
    return NextResponse.json(livePayload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Network Watcher] Error:", error);
    return NextResponse.json(
      { error: "Error interno procesando Azure Network Watcher" },
      { status: 500 }
    );
  }
}
