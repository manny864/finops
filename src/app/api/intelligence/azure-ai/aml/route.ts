import { NextRequest } from "next/server";
import { scriptSafeJson } from "@/lib/scriptSafeJson";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  generateMockAmlData,
  getLiveAmlData,
} from "@/services/azureMachineLearning.service";

/**
 * GET /api/intelligence/azure-ai/aml
 * Returns inventory, telemetry and FinOps recommendations for Azure Machine Learning (AML).
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
      return scriptSafeJson(generateMockAmlData());
    }

    // 2. Tenant Real: Validación obligatoria de RBAC
    await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

    // 3. Consulta en vivo sin fallbacks mock
    const payload = await getLiveAmlData(tenantId);
    return scriptSafeJson(payload);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return scriptSafeJson({ error: err.message }, { status: err.status });
    }
    console.error("[azure-aml] route error:", err instanceof Error ? err.message : err);
    return scriptSafeJson({ error: "Internal server error" }, { status: 500 });
  }
}
