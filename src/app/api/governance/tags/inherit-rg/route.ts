import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from "@/lib/apiErrors";
import { saveLocalCachedTags } from "@/services/azureTagGovernance.service";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") || "default";
    const isMock = isMockTenant(tenantId) || searchParams.get("mock") === "true";

    const body = await req.json();
    const resourceGroupId = body.resourceGroupId;
    const rgTags: Record<string, string> = body.rgTags || {};

    if (!resourceGroupId) {
      return NextResponse.json({ error: "resourceGroupId is required" }, { status: 400 });
    }

    if (isMock) {
      return NextResponse.json({
        success: true,
        message: `Etiquetas del Grupo de Recursos heredadas exitosamente a los recursos hijos`,
        inheritedCount: 12,
      });
    }

    await requireTenantAccess(req, tenantId);
    const credential = await getAzureCredential(tenantId);
    const client = new ResourceGraphClient(credential);

    // Parse subscription and RG name from ID
    // ID format: /subscriptions/{subId}/resourceGroups/{rgName}
    const parts = resourceGroupId.split("/");
    const subIdx = parts.indexOf("subscriptions");
    const rgIdx = parts.indexOf("resourceGroups");
    const subId = subIdx !== -1 ? parts[subIdx + 1] : "";
    const rgName = rgIdx !== -1 ? parts[rgIdx + 1] : "";

    let updatedCount = 0;
    if (subId && rgName) {
      const query = `
        resources
        | where subscriptionId =~ '${subId}' and resourceGroup =~ '${rgName}'
        | project id, tags
      `;
      const res = await client.resources({ query, subscriptions: [subId] });
      if (Array.isArray(res.data)) {
        for (const r of res.data) {
          const resId = r.id;
          const currentTags = (r.tags && typeof r.tags === "object" ? r.tags : {}) as Record<string, string>;
          // Merge: only add tags from RG that are missing in child
          const mergedTags = { ...currentTags };
          let changed = false;
          for (const [k, v] of Object.entries(rgTags)) {
            if (!mergedTags[k] || mergedTags[k].trim() === "") {
              mergedTags[k] = v;
              changed = true;
            }
          }
          if (changed) {
            await saveLocalCachedTags(tenantId, resId, mergedTags);
            updatedCount++;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Etiquetas propagadas exitosamente a ${updatedCount} recursos contenidos`,
      inheritedCount: updatedCount,
    });
  } catch (err: any) {
    console.error("[api/governance/tags/inherit-rg] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
