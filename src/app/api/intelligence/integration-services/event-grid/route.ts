import { NextRequest } from "next/server";
import { scriptSafeJson } from "@/lib/scriptSafeJson";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  generateMockEventGridData,
  getLiveEventGridData,
} from "@/services/azureEventGrid.service";

/**
 * GET /api/intelligence/integration-services/event-grid
 * Returns Azure Event Grid domains and topics, SKU distribution, throughput metrics and FinOps recommendations.
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
      return scriptSafeJson(generateMockEventGridData());
    }

    // 2. Tenant Real: Validación obligatoria de RBAC
    await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

    // 3. Consulta en vivo sin fallbacks mock
    const payload = await getLiveEventGridData(tenantId);
    return scriptSafeJson(payload);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return scriptSafeJson({ error: err.message }, { status: err.status });
    }
    console.error("[azure-eventgrid] route error:", err instanceof Error ? err.message : err);
    return scriptSafeJson({ error: "Internal server error" }, { status: 500 });
  }
}
