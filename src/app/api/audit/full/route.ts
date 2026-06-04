import { NextRequest, NextResponse } from "next/server";
import { getResourceGraphClient } from "@/lib/azure";
import { runGraphAudits, runMonitorAudits, runM365Audits } from "@/services/auditService";
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
    const resourceGraphClient = await getResourceGraphClient(tenantId);

    // 3. Orquestar Servicios de Auditoría
    const graphResults = await runGraphAudits(resourceGraphClient, subscriptionId || undefined);
    
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
    console.error("Audit Engine Error:", error);
    
    // Intercepción RBAC Inteligente (Fase 6)
    if (error.code === "AccessDenied" || error.statusCode === 403 || (error.message && error.message.includes("AccessDenied"))) {
      return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en la suscripción." }, { status: 403 });
    }
    
    return NextResponse.json({ error: "Error en el Motor de Auditoría", details: error.message }, { status: 500 });
  }
}
