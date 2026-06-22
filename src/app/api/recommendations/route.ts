import { NextRequest, NextResponse } from "next/server";
import { getResourceGraphClient, getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId');
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as any;

    if (!decoded || !decoded.tid) {
      return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
    }

    const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
    const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") && decoded.tid === "8b41364f-581a-4e43-b7cb-13138dac5517";

    if (decoded.tid !== tenantId && !isAdmin) {
      return NextResponse.json(
        { error: `Acceso denegado. El token no coincide con el tenant.` },
        { status: 403 }
      );
    }

    const resourceGraphClient = await getResourceGraphClient(tenantId);

    const disksQuery = `Resources | where type =~ 'microsoft.compute/disks' | where properties.diskState == 'Unattached' | project id, name, location, resourceGroup, subscriptionId, sku=sku.name, diskSizeGB=properties.diskSizeGB`;
    const ipsQuery = `Resources | where type =~ 'microsoft.network/publicipaddresses' | where properties.ipConfiguration == '' or isnull(properties.ipConfiguration) | project id, name, location, resourceGroup, subscriptionId`;

    const queryOptions: any = {};
    if (subscriptionId && subscriptionId.toLowerCase() !== 'all') {
        queryOptions.subscriptions = [subscriptionId];
    } else {
        const credential = await getAzureCredential(tenantId);
        queryOptions.subscriptions = await getSubscriptionsForTenant(tenantId, credential);
    }

    let unattachedDisks = [];
    let unusedIps = [];

    try {
      const diskResponse = await resourceGraphClient.resources({ 
        query: disksQuery, 
        ...queryOptions 
      });
      unattachedDisks = diskResponse.data || [];
    } catch (e: any) {
      console.error("Resource Graph Query Disks Error", e);
      throw new Error(`Fallo en Query Disks: ${e.message}`);
    }

    try {
      const ipResponse = await resourceGraphClient.resources({ 
        query: ipsQuery, 
        ...queryOptions 
      });
      unusedIps = ipResponse.data || [];
    } catch (e: any) {
      console.error("Resource Graph Query IPs Error", e);
      throw new Error(`Fallo en Query IPs: ${e.message}`);
    }

    return NextResponse.json({ 
        success: true, 
        tenantId, 
        mode: subscriptionId ? "single-subscription" : "tenant-wide",
        unattachedDisks, 
        unusedIps 
    });

  } catch (error: any) {
    const errorMessage = error?.message || String(error) || "Error desconocido";
    const errorCode = error?.code || error?.name || "";
    const errorStatus = error?.statusCode || error?.status || 0;

    console.error(`[Recommendations] ERROR capturado:`, {
      name: error?.name,
      code: errorCode,
      statusCode: errorStatus,
      message: errorMessage,
    });

    // Detectar secreto de cliente inválido o expirado (AADSTS7000215)
    if (errorMessage.includes("AADSTS7000215") || errorMessage.includes("invalid_client") || errorMessage.includes("Invalid client secret")) {
      return NextResponse.json({
        error: "INVALID_CLIENT_SECRET",
        details: "El Client Secret de la aplicación Azure AD es inválido o ha expirado. Genere uno nuevo en Azure Portal > App Registrations > Certificates & secrets."
      }, { status: 401 });
    }

    if (errorCode === "AccessDenied" || errorStatus === 403 || errorMessage.includes("AccessDenied") || errorMessage.includes("AuthorizationFailed")) {
      return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector." }, { status: 403 });
    }
    return NextResponse.json({ error: "Error en SDK o Resource Graph", details: errorMessage }, { status: 500 });
  }
}
