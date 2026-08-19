/**
 * GET /api/intelligence/azure-ai/foundry/detail
 *
 * Returns the dedicated Azure AI Foundry detail payload.
 *
 * Query params:
 *   - tenantId (required)
 *   - days (optional): 7 | 30 | "mtd" | 90 (default: 30)
 *
 * Auth: isMockTenant FIRST, then requireTenantAccess for real tenants.
 */

import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import { requireTenantAccess } from "@/lib/requestAuth";
import { getFoundryDetail } from "@/services/azureAiFoundry.service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");
  const daysParam = searchParams.get("days") || "30";
  const forceMock = searchParams.get("mock") === "true";

  if (!tenantId) {
    return NextResponse.json(
      { error: "Missing tenantId query parameter" },
      { status: 400 }
    );
  }

  // Parse days
  let days: number | "mtd" = 30;
  if (daysParam === "mtd") {
    days = "mtd";
  } else {
    const parsed = parseInt(daysParam, 10);
    if (!isNaN(parsed) && [7, 30, 90].includes(parsed)) {
      days = parsed;
    }
  }

  // Mock-first
  if (forceMock || isMockTenant(tenantId)) {
    try {
      const payload = await getFoundryDetail(tenantId, days, forceMock);
      return NextResponse.json(payload);
    } catch (err) {
      console.error("[foundry/detail] Mock generation failed:", err);
      return NextResponse.json(
        { error: "Failed to generate mock Foundry data" },
        { status: 500 }
      );
    }
  }

  // Real tenant: RBAC
  try {
    await requireTenantAccess(request, tenantId);
  } catch (authErr: unknown) {
    const err = authErr as { message?: string; status?: number };
    return NextResponse.json(
      { error: err.message || "Unauthorized" },
      { status: err.status || 401 }
    );
  }

  // Fetch
  try {
    const payload = await getFoundryDetail(tenantId, days);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[foundry/detail] Live fetch failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch Foundry detail" },
      { status: 500 }
    );
  }
}