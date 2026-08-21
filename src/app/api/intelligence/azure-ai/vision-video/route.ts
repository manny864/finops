import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  generateMockVisionVideoData,
  getLiveVisionVideoData,
} from "@/services/azureVisionVideo.service";

/**
 * GET /api/intelligence/azure-ai/vision-video
 * Returns inventory, telemetry and FinOps recommendations for Azure AI Vision & Video Indexer.
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
      return NextResponse.json(generateMockVisionVideoData());
    }

    // 2. Tenant Real: Validación obligatoria de RBAC
    await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

    // 3. Consulta en vivo sin fallbacks mock
    const payload = await getLiveVisionVideoData(tenantId);
    return NextResponse.json(payload);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[azure-vision-video] route error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
