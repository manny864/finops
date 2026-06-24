import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { collectAdvisorData } from "@/modules/collectors/azure/advisorCollector";
import { getMockDataForRoute } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    const locale = request.headers.get('accept-language') || 'es';
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    const mockData = getMockDataForRoute('advisor', tenantId);
    if (mockData) {
      return NextResponse.json(mockData);
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

    const email = decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "";
    const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") ;

    if (decoded.tid !== tenantId && !isAdmin) {
      return NextResponse.json({ error: `Acceso denegado. El token no coincide con el tenant.` }, { status: 403 });
    }

    const cacheKey = `advisor:${tenantId}:${locale}`;
    const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
        return await collectAdvisorData(tenantId, locale);
    }, 3600);

    return NextResponse.json({ 
        success: true, 
        recommendations: data.recommendations,
        subscriptions: data.subscriptions,
        scores: data.scores
    });
  } catch (error: any) {
    console.error("Advisor Error:", error);
    
    if (error.code === "MISSING_RBAC_ROLE") {
        return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en las suscripciones." }, { status: 403 });
    }

    // Detectar falta de Admin Consent (Service Principal faltante)
    if (error.message && error.message.includes("AADSTS7000229")) {
      return NextResponse.json({
        error: "MISSING_ADMIN_CONSENT",
        details: "Falta el Service Principal en el Tenant destino. Debe proporcionar Admin Consent a la aplicación."
      }, { status: 403 });
    }

    return NextResponse.json({ error: "Error en el Motor de Advisor", details: error.message }, { status: 500 });
  }
}
