import { NextRequest } from "next/server";
import { scriptSafeJson } from "@/lib/scriptSafeJson";
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
      return scriptSafeJson({ error: "Falta tenantId" }, { status: 400 });
    }

    // 1. ORDEN CRÍTICO: El check isMockTenant DEBE evaluarse ANTES de requireTenantAccess
    if (forceMock || isMockTenant(tenantId)) {
      return scriptSafeJson(generateMockAppInsightsData());
    }

    // 2. Tenant Real: Validación obligatoria de RBAC
    await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

    // 3. Consulta en vivo sin fallbacks mock
    const payload = await fetchAppInsightsData(tenantId);
    return scriptSafeJson(payload);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return scriptSafeJson({ error: err.message }, { status: err.status });
    }
    console.error("[azure-app-insights] route error:", err instanceof Error ? err.message : err);
    return scriptSafeJson({ error: "Internal server error" }, { status: 500 });
  }
}

