/**
 * GET /api/intelligence/log-analytics — Control de costos y optimización de
 * Azure Log Analytics Workspaces (microsoft.operationalinsights/workspaces).
 *
 * RBAC:
 * - Demos / Mocks: Servidos de inmediato sin requerir token OAuth de Azure.
 * - Tenants reales: Requieren validación con requireTenantAccess(request, tenantId).
 */

import { NextRequest } from "next/server";
import { scriptSafeJson } from "@/lib/scriptSafeJson";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  fetchLogAnalyticsData,
  generateMockLogAnalyticsData,
} from "@/services/azureLogAnalytics.service";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const isMockExplicit = searchParams.get("mock") === "true";

    if (!tenantId) {
      return scriptSafeJson(
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
      const mockData = generateMockLogAnalyticsData();
      return scriptSafeJson({
        success: true,
        ...mockData,
      });
    }

    // Tenant real: validación estricta de RBAC
    await requireTenantAccess(request, tenantId);

    // Consulta en vivo a Azure Resource Graph
    const liveData = await fetchLogAnalyticsData(tenantId);

    return scriptSafeJson({
      success: true,
      ...liveData,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return scriptSafeJson(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error("[Log Analytics API Error]:", error);
    return scriptSafeJson(
      { error: "Error interno procesando Log Analytics Workspaces" },
      { status: 500 }
    );
  }
}
