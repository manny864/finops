import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  generateMockEventHubsData,
  fetchEventHubsData,
} from "@/services/azureEventHubs.service";

/**
 * GET /api/intelligence/integration-services/event-hubs
 * Returns Azure Event Hubs namespaces, SKU distribution, throughput metrics and FinOps recommendations.
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
      return NextResponse.json(generateMockEventHubsData());
    }

    // 2. Tenant Real: Validación obligatoria de RBAC
    await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

    // 3. Consulta en vivo sin fallbacks mock
    const payload = await fetchEventHubsData(tenantId);
    return NextResponse.json(payload);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[azure-eventhubs] route error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
