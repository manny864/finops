/**
 * GET /api/intelligence/monitoring/sentinel — FinOps & Gobernanza de Microsoft Sentinel
 * (Ingesta de Datos, Capacity Tiers, Atribución por Tablas, y Reglas Huérfanas).
 *
 * RBAC:
 * - Demos / Mocks: Servidos de inmediato sin requerir token OAuth de Azure.
 * - Tenants reales: Requieren validación con requireTenantAccess(request, tenantId).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  fetchSentinelData,
  generateMockSentinelData,
} from "@/services/azureSentinelFinops.service";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const isMockExplicit = searchParams.get("mock") === "true";

    if (!tenantId) {
      return NextResponse.json(
        { error: "Falta parámetro requerido: tenantId" },
        { status: 400 }
      );
    }

    // Directiva 1: Evaluación temprana de Tenant Demo / Mock
    if (
      isMockExplicit ||
      isMockTenant(tenantId) ||
      tenantId.startsWith("demo-") ||
      tenantId.startsWith("mock-")
    ) {
      const mockData = generateMockSentinelData();
      return NextResponse.json({
        success: true,
        ...mockData,
      });
    }

    // Tenant real: validación estricta de RBAC
    await requireTenantAccess(request, tenantId);

    // Consulta en vivo a Azure Resource Graph + Cost Management + CostSnapshots
    const liveData = await fetchSentinelData(tenantId);

    return NextResponse.json({
      success: true,
      ...liveData,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error("[Sentinel API Error]:", error);
    return NextResponse.json(
      { error: "Error interno procesando Microsoft Sentinel FinOps" },
      { status: 500 }
    );
  }
}
