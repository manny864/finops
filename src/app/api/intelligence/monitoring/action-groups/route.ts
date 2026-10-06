/**
 * GET /api/intelligence/monitoring/action-groups
 * Azure Monitor Action Groups & Notification Governance API
 *
 * RBAC: requireTenantTier(Enterprise) for real tenants; bypass for mock/demo tenants.
 * El tier se valida server-side porque RouteTierGate/Sidebar son solo client-side
 * y no impiden que un tenant Professional le pegue directo a la API.
 * Evaluates isMockTenant BEFORE requireTenantTier.
 * Zero-tolerance mock fallback on live tenants.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { bloqueoPorDelegacionDeLectura } from "@/lib/lighthouseAccess";
import { azureErrorResponse } from "@/lib/apiErrors";
import { cambiarEstadoEnAzure } from "@/services/azureAlertsRules.service";
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
    await requireTenantTier(request, tenantId, "Enterprise");

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

    const body = await request.json().catch(() => ({}));

    // 1. Demo/Mock check
    if (isMockTenant(tenantId)) {
      return NextResponse.json({
        success: true,
        message: "Operación simulada en tenant de demostración",
        action: body.action || "TOGGLE_STATE",
        resourceId: body.resourceId,
        newState: body.state,
      });
    }

    // 2. Escribe en la Azure del cliente (hasta el 2026-10-06 respondía "éxito"
    // sin tocar nada). Mismo orden que governance/auto-block/deploy.
    const identity = await requireTenantRole(request, tenantId, ["Owner", "Admin"]);
    await requireTenantTier(request, tenantId, "Enterprise");
    const bloqueo = await bloqueoPorDelegacionDeLectura(tenantId);
    if (bloqueo) return bloqueo;

    if (body.action !== "TOGGLE_STATE" || typeof body.resourceId !== "string" || (body.state !== "Enabled" && body.state !== "Disabled")) {
      return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
    }
    await cambiarEstadoEnAzure(tenantId, body.resourceId, body.state === "Enabled", "actionGroups", identity.email || "unknown");

    return NextResponse.json({
      success: true,
      action: "TOGGLE_STATE",
      resourceId: body.resourceId,
      newState: body.state,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // Un 4xx de Azure trae el motivo real (permiso que falta, regla borrada).
    return azureErrorResponse(error, "POST /api/intelligence/monitoring/action-groups");
  }
}
