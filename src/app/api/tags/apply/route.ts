import { NextRequest, NextResponse } from "next/server";
import { ResourceManagementClient } from "@azure/arm-resources";
import { getAzureCredential } from "@/lib/azure";
import jwt from "jsonwebtoken";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, resourceId, tags } = body;

    if (!tenantId || !resourceId || !tags) {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as { tid?: string } | null;
    if (!decoded) {
      return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
    }

    const email = (decoded as any).preferred_username || (decoded as any).unique_name || (decoded as any).email || "";
    const isSuperAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") ;

    if (decoded.tid !== tenantId && !isSuperAdmin) {
      return NextResponse.json({ error: "Acceso denegado. Tenant ID inválido." }, { status: 403 });
    }

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
  } catch (error: any) {
    const errorMessage = error?.message || String(error) || "Error desconocido";
    const errorCode = error?.code || error?.name || "";
    
    console.error(`[Tags API] ERROR:`, { code: errorCode, message: errorMessage });

    if (errorMessage.includes("AADSTS7000215") || errorMessage.includes("invalid_client")) {
      return NextResponse.json({ error: "INVALID_CLIENT_SECRET", details: "Client Secret inválido." }, { status: 401 });
    }

    if (errorCode === "AuthorizationFailed" || errorMessage.includes("AuthorizationFailed") || errorMessage.includes("AccessDenied")) {
      return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "Permisos insuficientes para modificar etiquetas." }, { status: 403 });
    }

    return NextResponse.json({ error: "Error al actualizar etiquetas", details: errorMessage }, { status: 500 });
  }
}
