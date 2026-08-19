import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import { requireTenantAccess } from "@/lib/requestAuth";
import { getDocumentIntelligencePayload } from "@/services/azureDocumentIntelligence.service";

function parseDays(value: string | null): number | "mtd" {
  if (value === "30" || value === "90") return Number(value);
  return "mtd";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");
  const forceMock = searchParams.get("mock") === "true";
  const days = parseDays(searchParams.get("days"));

  if (!tenantId) {
    return NextResponse.json({ error: "Missing tenantId query parameter" }, { status: 400 });
  }

  if (forceMock || isMockTenant(tenantId)) {
    try {
      return NextResponse.json(await getDocumentIntelligencePayload(tenantId, days, forceMock));
    } catch (error) {
      console.error("[azure-ai/document-intelligence] Mock payload failed:", error);
      return NextResponse.json({ error: "Failed to generate Document Intelligence demo data" }, { status: 500 });
    }
  }

  try {
    await requireTenantAccess(request, tenantId);
  } catch (error: unknown) {
    const authError = error as { message?: string; status?: number };
    return NextResponse.json(
      { error: authError.message || "Unauthorized" },
      { status: authError.status || 401 }
    );
  }

  try {
    return NextResponse.json(await getDocumentIntelligencePayload(tenantId, days));
  } catch (error) {
    console.error("[azure-ai/document-intelligence] Live payload failed:", error);
    return NextResponse.json({ error: "Failed to fetch Document Intelligence data" }, { status: 500 });
  }
}
