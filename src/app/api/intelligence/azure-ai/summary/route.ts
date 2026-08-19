/**
 * GET /api/intelligence/azure-ai/summary
 *
 * Returns the consolidated Azure AI Summary payload for the Resumen tab.
 *
 * Auth: isMockTenant check FIRST, then requireTenantAccess for real tenants.
 * RBAC: Reader (any authenticated tenant user can view AI cost summary).
 *
 * Query params:
 *   - tenantId (required): The tenant to query.
 *   - window (optional): "mtd" (default), "30d", or "7d".
 */

import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import { requireTenantAccess } from "@/lib/requestAuth";
import { getAzureAiSummary } from "@/services/azureAiSummary.service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");

  if (!tenantId) {
    return NextResponse.json(
      { error: "Missing tenantId query parameter" },
      { status: 400 }
    );
  }

  // ── Mock-first: serve synthetic data immediately ──────────────────────
  if (isMockTenant(tenantId)) {
    try {
      const payload = await getAzureAiSummary(tenantId);
      return NextResponse.json(payload);
    } catch (err) {
      console.error("[azure-ai/summary] Mock generation failed:", err);
      return NextResponse.json(
        { error: "Failed to generate mock AI summary" },
        { status: 500 }
      );
    }
  }

  // ── Real tenant: validate RBAC ────────────────────────────────────────
  try {
    await requireTenantAccess(request, tenantId);
  } catch (authErr: unknown) {
    const err = authErr as { message?: string; status?: number };
    return NextResponse.json(
      { error: err.message || "Unauthorized" },
      { status: err.status || 401 }
    );
  }

  // ── Fetch live summary ────────────────────────────────────────────────
  try {
    const payload = await getAzureAiSummary(tenantId);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[azure-ai/summary] Live fetch failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch AI summary from Azure" },
      { status: 500 }
    );
  }
}