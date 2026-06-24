import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import jwt from "jsonwebtoken";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId');
    const tenantId = searchParams.get('tenantId');

    if (!subscriptionId || !tenantId) {
      return NextResponse.json({ error: "Parámetros faltantes" }, { status: 400 });
    }

    // Aislamiento Multi-Tenant: Validación estricta JWT
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as { tid?: string } | null;

    if (!decoded || !decoded.tid) {
      return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
    }

    const email = (decoded as any).preferred_username || (decoded as any).unique_name || (decoded as any).email || "";
    const isSuperAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") ;

    if (decoded.tid !== tenantId && !isSuperAdmin) {
      return NextResponse.json(
        { error: `Acceso denegado. El token no coincide con el tenant solicitado.` },
        { status: 403 }
      );
    }

    await getAzureCredential(tenantId);
    
    const cacheKey = `consumption:${tenantId}:${subscriptionId}`;
    const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
        return { success: true, tenantId, subscriptionId, costSummary: { amortizedCost: 0, currency: "USD", note: "Falta implementar CostManagementClient." } };
    }, 3600);
    
    return NextResponse.json(data);

  } catch (error: any) {
    return NextResponse.json({ error: "Error interno", details: error.message }, { status: 500 });
  }
}
