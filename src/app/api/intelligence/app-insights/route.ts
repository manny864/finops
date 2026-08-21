import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  generateMockAppInsightsData,
  fetchAppInsightsData,
} from "@/services/azureAppInsights.service";

/**
 * GET /api/intelligence/app-insights
 * Returns Application Insights telemetry inventory, Log Analytics ingestion attribution ($2.30/GB),
 * Sampling distribution, Daily Cap status, and FinOps recommendations.
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    const forceMock = request.nextUrl.searchParams.get("mock") === "true";

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    // 1. ORDEN CRÍTICO: El check isMockTenant DEBE evaluarse ANTES de requireTenantAccess
    if (forceMock || isMockTenant(tenantId)) {
      return NextResponse.json(generateMockAppInsightsData());
    }

    // 2. Tenant Real: Validación obligatoria de RBAC
    await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

    // 3. Consulta en vivo sin fallbacks mock
    const payload = await fetchAppInsightsData(tenantId);
    return NextResponse.json(payload);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[azure-app-insights] route error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

