/**
 * GET /api/tenants/[tenantId]/tier-limits
 *
 * Endpoint transversal para consultar los límites contractuales y uso de cuotas por tier:
 * - Professional: max 2 suscripciones
 * - Business: max 3 suscripciones
 * - Enterprise: ilimitadas
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getTenantTierLimitStatus } from "@/middleware/tierLimitsGuard";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    if (!tenantId) {
      return NextResponse.json(
        { success: false, error: "Falta el identificador del tenant (tenantId)" },
        { status: 400 }
      );
    }

    if (!isMockTenant(tenantId)) {
      await requireTenantAccess(request, tenantId);
    }

    const limits = await getTenantTierLimitStatus(tenantId);

    return NextResponse.json({
      success: true,
      ...limits,
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json(
      { success: false, error: err?.message || "Error al consultar límites del plan" },
      { status }
    );
  }
}
