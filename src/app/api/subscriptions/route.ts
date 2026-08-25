import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { getSubscriptionLimit } from "@/lib/tierLogic";
import { errorMessage } from '@/lib/apiErrors';

function isSubscriptionStateEligible(state: unknown): boolean {
  const normalized = String(state || "").trim().toLowerCase();
  if (!normalized) return true;
  return !["deleted", "disabled", "expired", "canceled", "cancelled"].includes(normalized);
}

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
    const allSubscriptions: Array<{ id: string; name: string; state?: string; tenantId?: string }> = [];
    const seen = new Set<string>();
    let nextUrl: string | null = "https://management.azure.com/subscriptions?api-version=2020-01-01";

    while (nextUrl) {
      const res: Response = await fetch(nextUrl, {
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

      const data: { value?: any[]; nextLink?: string } = await res.json();
      for (const sub of data.value || []) {
        const id = String(sub?.subscriptionId || "");
        if (!id || seen.has(id) || !isSubscriptionStateEligible(sub?.state)) continue;
        seen.add(id);
        allSubscriptions.push({
          id,
          name: sub.displayName,
          state: sub.state,
          tenantId: sub.tenantId
        });
      }

      const candidate: string = String(data?.nextLink || "").trim();
      nextUrl = candidate.length > 0 ? candidate : null;
    }

    // Límite de suscripciones por plan (Professional=5,
    // Business=20, Enterprise=sin límite). El SP puede tener Reader en más
    // de las que el plan permite monitorear; acá se corta y se informa al
    // frontend cuántas quedaron ocultas para mostrar el upsell.
    let tier = "Professional";
    try {
        const [tierRows]: any = await pool.query(
            `SELECT COALESCE(t.tier, p.tier, 'Professional') as tier
             FROM Tenants t
             LEFT JOIN Tenants p ON t.parent_tenant_id = p.tenant_id
             WHERE t.tenant_id = ?
             LIMIT 1`,
            [tenantId]
        );
        tier = tierRows?.[0]?.tier || "Professional";
    } catch {
        try {
            const [simpleRows]: any = await pool.query(
                `SELECT t.tier FROM Tenants t WHERE t.tenant_id = ? LIMIT 1`,
                [tenantId]
            );
            tier = simpleRows?.[0]?.tier || "Professional";
        } catch {
            tier = "Professional";
        }
    }
    const limit = getSubscriptionLimit(tier);
    const limitApplied = Number.isFinite(limit) && allSubscriptions.length > limit;
    const subscriptions = limitApplied
        ? [...allSubscriptions].sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit)
        : allSubscriptions;

    console.log(`[Subscriptions] OK: ${allSubscriptions.length} suscripciones encontradas (plan ${tier}, límite ${Number.isFinite(limit) ? limit : "∞"}${limitApplied ? ", truncado" : ""})`);

    try {
        const [updateRes] = await pool.query(`UPDATE Tenants SET is_onboarded = 1 WHERE tenant_id = ?`, [tenantId]) as any[];
        if (updateRes && updateRes.affectedRows > 0) {
            console.log(`[Subscriptions] Tenant ${tenantId} marcado como onboarded.`);
        }
    } catch (e) {
        console.error(`[Subscriptions] Error actualizando is_onboarded:`, errorMessage(e));
    }

    return NextResponse.json({
        subscriptions,
        subscriptionLimit: Number.isFinite(limit) ? limit : null,
        totalAvailable: allSubscriptions.length,
        limitApplied,
        tier,
    });
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
