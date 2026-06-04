import { NextRequest, NextResponse } from "next/server";
import { SubscriptionClient } from "@azure/arm-subscriptions";
import { getAzureCredential } from "@/lib/azure";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as { tid?: string } | null;
    if (!decoded || decoded.tid !== tenantId) {
      return NextResponse.json({ error: "Acceso denegado. Tenant ID inválido." }, { status: 403 });
    }

    // Usar la identidad de Azure para autenticarnos.
    const credential = await getAzureCredential(tenantId);
    const tokenData = await credential.getToken("https://management.azure.com/.default");

    const res = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
        headers: { 'Authorization': `Bearer ${tokenData.token}` }
    });
    
    if (!res.ok) {
        if (res.status === 403 || res.status === 401) {
            return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en las suscripciones." }, { status: 403 });
        }
        throw new Error(`Failed to fetch subscriptions: ${res.statusText}`);
    }

    const data = await res.json();
    const subscriptions = (data.value || []).map((sub: any) => ({
        id: sub.subscriptionId,
        displayName: sub.displayName,
        state: sub.state
    }));

    return NextResponse.json({ subscriptions });
  } catch (error: any) {
    console.error("API Subscriptions Error:", error);
    if (error.code === "AccessDenied" || error.statusCode === 403 || error.message.includes("AccessDenied") || error.message.includes("AuthorizationFailed")) {
      return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en las suscripciones." }, { status: 403 });
    }
    return NextResponse.json({ error: "Error obteniendo suscripciones", details: error.message }, { status: 500 });
  }
}
