import { NextRequest, NextResponse } from "next/server";
import { ResourceManagementClient } from "@azure/arm-resources";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";

// RBAC: Requires Admin/Owner role (same as single-resource tagging)
// Tier: Business+ (same as single-resource tagging)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, resourceIds, tags } = body;

    if (!tenantId || !resourceIds || !Array.isArray(resourceIds) || resourceIds.length === 0 || !tags) {
      return NextResponse.json({ 
        error: "Missing or invalid required parameters (tenantId, resourceIds, tags)" 
      }, { status: 400 });
    }

    if (resourceIds.length > 100) {
      return NextResponse.json({ 
        error: "Maximum 100 resources per bulk operation" 
      }, { status: 400 });
    }

    await requireTenantRole(request, tenantId, ['Admin', 'Owner']);
    await requireTenantTier(request, tenantId, "Business");

    if (isMockTenant(tenantId)) {
      return NextResponse.json({
        success: true,
        mock: true,
        summary: {
          total: resourceIds.length,
          succeeded: resourceIds.length,
          failed: 0,
        },
        results: resourceIds.map((id) => ({ resourceId: id, success: true })),
      });
    }

    const results: Array<{ resourceId: string; success: boolean; error?: string }> = [];
    
    // Process each resource — try all, collect failures
    for (const resourceId of resourceIds) {
      try {
        // Extract subscriptionId from resourceId
        const match = resourceId.match(/subscriptions\/([^\/]+)/i);
        const subId = match ? match[1] : "00000000-0000-0000-0000-000000000000";

        const credential = await getAzureCredential(tenantId);
        const client = new ResourceManagementClient(credential, subId);
        
        console.log(`[Tags Bulk] Updating tags for ${resourceId}`);
        
        const poller = await client.tagsOperations.beginUpdateAtScope(resourceId, {
            operation: "Merge",
            properties: { tags }
        });
        
        await poller.pollUntilDone();
        
        results.push({ resourceId, success: true });
      } catch (error: unknown) {
        const err = error as { message?: string; code?: string };
        results.push({ 
          resourceId, 
          success: false, 
          error: err?.message || String(error) 
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    return NextResponse.json({
      success: true,
      summary: {
        total: resourceIds.length,
        succeeded: successCount,
        failed: failureCount
      },
      results: failureCount > 0 ? results : undefined // Only include failures for brevity
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const err = error as { message?: string; code?: string; name?: string };
    const errorMessage = err?.message || String(error);
    const errorCode = err?.code || err?.name || "";
    
    console.error(`[Tags Bulk API] ERROR:`, { code: errorCode, message: errorMessage });

    if (errorMessage.includes("AADSTS7000215") || errorMessage.includes("invalid_client")) {
      return NextResponse.json({ 
        error: "INVALID_CLIENT_SECRET", 
        details: "Client Secret inválido." 
      }, { status: 401 });
    }

    if (errorCode === "AuthorizationFailed" || errorMessage.includes("AuthorizationFailed") || errorMessage.includes("AccessDenied")) {
      return NextResponse.json({ 
        error: "MISSING_RBAC_ROLE", 
        details: "Permisos insuficientes para modificar etiquetas." 
      }, { status: 403 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
