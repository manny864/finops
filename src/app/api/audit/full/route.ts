import { NextRequest, NextResponse } from "next/server";
import { getResourceGraphClient, getAzureCredential } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { runGraphAudits, runMonitorAudits, runM365Audits } from "@/services/auditService";
import { getMonthlyCostEstimate } from "@/services/pricingService";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId');
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    // 1. Validar el Token MSAL (Aislamiento Cero-Trust)
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
    const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

    if (decoded.tid !== tenantId && !isAdmin) {
      return NextResponse.json(
        { error: `Acceso denegado. El token no coincide con el tenant.` },
        { status: 403 }
      );
    }

    // 2. Obtener Cliente Autenticado
    const credential = await getAzureCredential(tenantId);
    const resourceGraphClient = new ResourceGraphClient(credential);

    // 3. Orquestar Servicios de Auditoría
    const graphResults = await runGraphAudits(resourceGraphClient, credential, subscriptionId || undefined);
    
    // Interceptar para estimación de costos en huérfanos
    if (graphResults.unattachedDisks && Array.isArray(graphResults.unattachedDisks)) {
        await Promise.all(graphResults.unattachedDisks.map(async (disk: any) => {
            const sku = disk.sku || "Standard_HDD";
            const loc = disk.location || "eastus";
            const cost = await getMonthlyCostEstimate("Storage", sku, loc);
            disk.estimatedMonthlyCost = cost;
        }));
    }

    if (graphResults.unusedIps && Array.isArray(graphResults.unusedIps)) {
        await Promise.all(graphResults.unusedIps.map(async (ip: any) => {
            const sku = ip.sku || "Standard";
            const loc = ip.location || "eastus";
            const cost = await getMonthlyCostEstimate("Virtual Network", sku, loc);
            ip.estimatedMonthlyCost = cost;
        }));
    }
    
    // Ejecutar stubs (para futura expansión)
    // const monitorResults = await runMonitorAudits(credential, subscriptionId);
    // const m365Results = await runM365Audits(credential, tenantId);

    // 4. Retornar Estructura Unificada
    return NextResponse.json({ 
        success: true, 
        tenantId, 
        mode: subscriptionId ? "single-subscription" : "tenant-wide",
        auditResults: {
            ...graphResults,
            // vmUnderutilized: monitorResults,
            // unassignedLicenses: m365Results
        }
    });

  } catch (error: any) {
    const errorMessage = error?.message || String(error) || "Error desconocido";
    const errorCode = error?.code || error?.name || "";
    const errorStatus = error?.statusCode || error?.status || 0;

    console.error(`[Audit] ERROR capturado:`, {
      name: error?.name,
      code: errorCode,
      statusCode: errorStatus,
      message: errorMessage,
    });
    
    // Detectar falta de Admin Consent (Service Principal faltante)
    if (errorMessage.includes("AADSTS7000229")) {
      return NextResponse.json({
        error: "MISSING_ADMIN_CONSENT",
        details: "Falta el Service Principal en el Tenant destino. Debe proporcionar Admin Consent a la aplicación."
      }, { status: 403 });
    }

    // Detectar secreto de cliente inválido o expirado (AADSTS7000215)
    if (errorMessage.includes("AADSTS7000215") || errorMessage.includes("invalid_client") || errorMessage.includes("Invalid client secret")) {
      return NextResponse.json({
        error: "INVALID_CLIENT_SECRET",
        details: "El Client Secret de la aplicación Azure AD es inválido o ha expirado. Genere uno nuevo en Azure Portal > App Registrations > Certificates & secrets."
      }, { status: 401 });
    }

    // Intercepción RBAC Inteligente (Fase 6)
    if (errorCode === "AccessDenied" || errorStatus === 403 || errorMessage.includes("AccessDenied") || errorMessage.includes("AuthorizationFailed")) {
      return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en la suscripción." }, { status: 403 });
    }
    
    return NextResponse.json({ error: "Error en el Motor de Auditoría", details: errorMessage }, { status: 500 });
  }
}
