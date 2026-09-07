import { NextRequest, NextResponse } from "next/server";
import { ResourceManagementClient } from "@azure/arm-resources";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { bloqueoPorDelegacionDeLectura } from "@/lib/lighthouseAccess";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, resourceId, tags } = body;

    if (!tenantId || !resourceId || !tags) {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 });
    }

    await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        // Delegacion de solo lectura: 403 explicativo en vez del 403 crudo de Azure.
        const bloqueo = await bloqueoPorDelegacionDeLectura(tenantId);
        if (bloqueo) return bloqueo;
    // Remediación de tags (mutación real en Azure vía tagsOperations.beginUpdateAtScope):
    // misma feature/tier que apply-inheritance y canRemediateTags en tierLogic.ts
    // (habilitada desde Business). Antes solo se validaba el rol y el candado de
    // tier era client-only (Sidebar/FeatureGuard) — un Admin de un tenant
    // Professional podía pegarle directo a esta ruta y saltearlo.
    await requireTenantTier(request, tenantId, "Business");

    const credential = await getAzureCredential(tenantId);
    
    // Extraer subscriptionId
    const match = resourceId.match(/subscriptions\/([^\/]+)/i);
    const subId = match ? match[1] : "00000000-0000-0000-0000-000000000000";

    const client = new ResourceManagementClient(credential, subId);
    
    console.log(`[Tags API] Updating tags for ${resourceId}`);
    
    const poller = await client.tagsOperations.beginUpdateAtScope(resourceId, {
        operation: "Merge",
        properties: { tags }
    });
    
    await poller.pollUntilDone();

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    const err = error as { message?: string; code?: string; name?: string };
    const errorMessage = err?.message || String(error);
    const errorCode = err?.code || err?.name || "";
    
    console.error(`[Tags API] ERROR:`, { code: errorCode, message: errorMessage });

    if (errorMessage.includes("AADSTS7000215") || errorMessage.includes("invalid_client")) {
      return NextResponse.json({ error: "INVALID_CLIENT_SECRET", details: "Client Secret inválido." }, { status: 401 });
    }

    if (errorCode === "AuthorizationFailed" || errorMessage.includes("AuthorizationFailed") || errorMessage.includes("AccessDenied")) {
      return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "Permisos insuficientes para modificar etiquetas." }, { status: 403 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
