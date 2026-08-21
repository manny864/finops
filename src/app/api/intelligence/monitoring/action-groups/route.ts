/**
 * GET /api/intelligence/monitoring/action-groups
 * Azure Monitor Action Groups & Notification Governance API
 *
 * RBAC: requireTenantTier(Business) for real tenants; bypass for mock/demo tenants.
 * El tier se valida server-side porque RouteTierGate/Sidebar son solo client-side
 * y no impiden que un tenant Professional le pegue directo a la API.
 * Evaluates isMockTenant BEFORE requireTenantTier.
 * Zero-tolerance mock fallback on live tenants.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  fetchLiveActionGroupsData,
  getMockActionGroupsPayload,
} from "@/services/azureActionGroups.service";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId parameter" }, { status: 400 });
    }

    // 1. Check Demo/Mock tenant FIRST before any auth challenge
    if (isMockTenant(tenantId)) {
      const mockPayload = getMockActionGroupsPayload(tenantId);
      return NextResponse.json(mockPayload);
    }

    // 2. Strict RBAC validation for real/connected tenants
    await requireTenantTier(request, tenantId, "Business");

    // 3. Live Azure Resource Graph discovery (Zero fallback to mock on live tenant)
    const livePayload = await fetchLiveActionGroupsData(tenantId);
    return NextResponse.json(livePayload);
  } catch (error) {
    // AuthError lleva su propio status (401/403): propagarlo en vez de
    // colapsarlo a 500, que hace ver una denegacion de permisos como una
    // caida del servidor. Mismo patron que sentinel/route.ts.
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Action Groups Management] Error:", error);
    return NextResponse.json(
      { error: "Error interno procesando Action Groups de Azure Monitor" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId parameter" }, { status: 400 });
    }

    // 1. Demo/Mock check
    if (isMockTenant(tenantId)) {
      const body = await request.json();
      return NextResponse.json({
        success: true,
        message: "Operación simulada en tenant de demostración",
        action: body.action || "TOGGLE_STATE",
        resourceId: body.resourceId,
        newState: body.state,
      });
    }

    // 2. Real tenant auth
    await requireTenantTier(request, tenantId, "Business");

    const body = await request.json();
    return NextResponse.json({
      success: true,
      message: "Operación recibida para ejecución sobre Azure Monitor Action Groups",
      action: body.action || "TOGGLE_STATE",
      resourceId: body.resourceId,
    });
  } catch (error) {
    // AuthError lleva su propio status (401/403): propagarlo en vez de
    // colapsarlo a 500, que hace ver una denegacion de permisos como una
    // caida del servidor. Mismo patron que sentinel/route.ts.
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Action Groups Management] POST Error:", error);
    return NextResponse.json(
      { error: "Error interno procesando Action Groups de Azure Monitor" },
      { status: 500 }
    );
  }
}
