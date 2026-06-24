import { NextRequest, NextResponse } from "next/server";
import { SubscriptionClient } from "@azure/arm-subscriptions";
import { getAzureCredential } from "@/lib/azure";
import jwt from "jsonwebtoken";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
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

    // Paso 1: Obtener credencial (ClientSecretCredential)
    console.log(`[Subscriptions] Paso 1: Obteniendo credencial para tenant ${tenantId}`);
    const credential = await getAzureCredential(tenantId);

    // Paso 2: Obtener token de Azure Management
    console.log(`[Subscriptions] Paso 2: Solicitando token a Azure AD`);
    const tokenData = await credential.getToken("https://management.azure.com/.default");

    // Paso 3: Llamar a Azure Management API
    console.log(`[Subscriptions] Paso 3: Consultando subscriptions en Azure Management API`);
    const res = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
        headers: { 'Authorization': `Bearer ${tokenData.token}` }
    });
    
    if (!res.ok) {
        const bodyText = await res.text().catch(() => "No se pudo leer el cuerpo de respuesta");
        console.error(`[Subscriptions] Azure Management API respondió ${res.status}: ${bodyText}`);
        if (res.status === 403 || res.status === 401) {
            return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en las suscripciones." }, { status: 403 });
        }
        throw new Error(`Failed to fetch subscriptions: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const subscriptions = (data.value || []).map((sub: any) => ({
        id: sub.subscriptionId,
        name: sub.displayName,
        state: sub.state,
        tenantId: sub.tenantId
    }));

    console.log(`[Subscriptions] OK: ${subscriptions.length} suscripciones encontradas`);

    try {
        const [updateRes] = await pool.query(`UPDATE Tenants SET is_onboarded = 1 WHERE tenant_id = ?`, [tenantId]) as any[];
        if (updateRes && updateRes.affectedRows > 0) {
            console.log(`[Subscriptions] Tenant ${tenantId} marcado como onboarded.`);
        }
    } catch (e: any) {
        console.error(`[Subscriptions] Error actualizando is_onboarded:`, e.message);
    }

    return NextResponse.json({ subscriptions });
  } catch (error: any) {
    const errorMessage = error?.message || String(error) || "Error desconocido";
    const errorCode = error?.code || error?.name || "";
    const errorStatus = error?.statusCode || error?.status || 0;

    console.error(`[Subscriptions] ERROR capturado:`, {
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

    // Detectar falta de permisos RBAC
    if (errorCode === "AccessDenied" || errorStatus === 403 || errorMessage.includes("AccessDenied") || errorMessage.includes("AuthorizationFailed")) {
      return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en las suscripciones." }, { status: 403 });
    }

    return NextResponse.json({ error: "Error obteniendo suscripciones", details: errorMessage }, { status: 500 });
  }
}
