import { NextRequest, NextResponse } from "next/server";
import { SubscriptionClient } from "@azure/arm-subscriptions";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    await requireTenantAccess(request, tenantId);

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
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    const err = error as { message?: string; code?: string; name?: string; statusCode?: number; status?: number };
    const errorMessage = err?.message || String(error);
    const errorCode = err?.code || err?.name || "";
    const errorStatus = err?.statusCode || err?.status || 0;

    console.error(`[Subscriptions] ERROR capturado:`, {
      name: err?.name,
      code: errorCode,
      statusCode: errorStatus,
      message: errorMessage,
    });

    if (errorMessage.includes("AADSTS7000229")) {
      return NextResponse.json({
        error: "MISSING_ADMIN_CONSENT",
        details: "Falta el Service Principal en el Tenant destino. Debe proporcionar Admin Consent a la aplicación."
      }, { status: 403 });
    }

    if (errorMessage.includes("AADSTS7000215") || errorMessage.includes("invalid_client") || errorMessage.includes("Invalid client secret")) {
      return NextResponse.json({
        error: "INVALID_CLIENT_SECRET",
        details: "El Client Secret de la aplicación Azure AD es inválido o ha expirado. Genere uno nuevo en Azure Portal > App Registrations > Certificates & secrets."
      }, { status: 401 });
    }

    if (errorCode === "AccessDenied" || errorStatus === 403 || errorMessage.includes("AccessDenied") || errorMessage.includes("AuthorizationFailed")) {
      return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en las suscripciones." }, { status: 403 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
