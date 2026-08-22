import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import { requireTenantAccess } from "@/lib/requestAuth";
import { suggestTagsForResource } from "@/services/azureTagGovernance.service";
import { errorMessage } from "@/lib/apiErrors";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") || "default";
    const isMock = isMockTenant(tenantId) || searchParams.get("mock") === "true";

    const body = await req.json();
    const { resourceName, resourceType, resourceGroup } = body;

    if (!isMock) {
      await requireTenantAccess(req, tenantId);
    }

    const suggestedTags = suggestTagsForResource(
      resourceName || "",
      resourceType || "",
      resourceGroup || ""
    );

    return NextResponse.json({
      success: true,
      suggestedTags,
      confidence: 0.94,
      reasoning: `Etiquetas inferidas a partir de la convención de nomenclatura '${resourceName}' en el grupo '${resourceGroup}'.`,
    });
  } catch (err: any) {
    console.error("[api/governance/tags/suggest] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
