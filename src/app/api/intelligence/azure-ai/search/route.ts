/**
 * GET /api/intelligence/azure-ai/search
 *
 * Returns the full AI Search payload: KPI summary, per-service detail,
 * SKU breakdown, and prioritized remediation actions.
 *
 * Query params:
 *   - tenantId (required)
 *
 * Auth: isMockTenant FIRST, then requireTenantAccess for real tenants.
 * Zero tolerance for mock fallbacks on real tenants.
 */

import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import { requireTenantAccess } from "@/lib/requestAuth";
import { getAiSearchPayload } from "@/services/azureAiSearch.service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");

  if (!tenantId) {
    return NextResponse.json(
      { error: "Missing tenantId query parameter" },
      { status: 400 }
    );
  }

  // ── Mock-first: serve demo data without OAuth ──────────────────────────
  if (isMockTenant(tenantId)) {
    try {
      const payload = await getAiSearchPayload(tenantId);
      return NextResponse.json(payload);
    } catch (err) {
      console.error("[azure-ai/search] Mock generation failed:", err);
      return NextResponse.json(
        { error: "Failed to generate mock AI Search data" },
        { status: 500 }
      );
    }
  }

  // ── Real tenant: RBAC validation ───────────────────────────────────────
  try {
    await requireTenantAccess(request, tenantId);
  } catch (authErr: unknown) {
    const err = authErr as { message?: string; status?: number };
    return NextResponse.json(
      { error: err.message || "Unauthorized" },
      { status: err.status || 401 }
    );
  }

  // ── Fetch live data ────────────────────────────────────────────────────
  try {
    const payload = await getAiSearchPayload(tenantId);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[azure-ai/search] Live fetch failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch AI Search data" },
      { status: 500 }
    );
  }
}