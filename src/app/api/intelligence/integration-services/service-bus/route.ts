import { NextRequest } from "next/server";
import { scriptSafeJson } from "@/lib/scriptSafeJson";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  generateMockServiceBusData,
  getLiveServiceBusData,
} from "@/services/azureServiceBus.service";

/**
 * GET /api/intelligence/integration-services/service-bus
 * Returns Azure Service Bus namespaces, SKU distribution, throughput metrics and FinOps recommendations.
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
      return scriptSafeJson(generateMockServiceBusData());
    }

    // 2. Tenant Real: Validación obligatoria de RBAC
    await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

    // 3. Consulta en vivo sin fallbacks mock
    const payload = await getLiveServiceBusData(tenantId);
    return scriptSafeJson(payload);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return scriptSafeJson({ error: err.message }, { status: err.status });
    }
    console.error("[azure-servicebus] route error:", err instanceof Error ? err.message : err);
    return scriptSafeJson({ error: "Internal server error" }, { status: 500 });
  }
}
