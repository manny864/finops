import { NextRequest, NextResponse } from "next/server";
import { deleteResource } from "@/services/remediationService";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { redis } from "@/lib/redis";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, subscriptionId, resourceGroup, resourceName, resourceType, resourceId } = body;

    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    // Eliminar un recurso de Azure es una acción destructiva e irreversible:
    // solo Admin/Owner del tenant (mismo criterio que remediation/downgrade,
    // tags/apply y el GET de zombies/networking, que ya exige Admin/Owner
    // para siquiera ver la lista). requireTenantAccess (solo membresía)
    // permitía que cualquier Reader/Colaborador pudiera borrar recursos.
    const identity = await requireTenantRole(request, tenantId, ["Admin", "Owner"]);
    const email = identity.email;

    await deleteResource(tenantId, email, subscriptionId, resourceGroup, resourceName, resourceType, resourceId);

    // Invalidar cache de auditoría (Redis SWR) para que el recurso recién
    // borrado no siga apareciendo como zombie hasta que expire el TTL.
    const keysToInvalidate = [
      `audit:full:v1:${tenantId}:all`,
      `audit:ttl:v1:${tenantId}`,
    ];
    if (subscriptionId) keysToInvalidate.push(`audit:full:v1:${tenantId}:${String(subscriptionId).toLowerCase()}`);
    await redis.del(...keysToInvalidate).catch((e) => console.warn("[Remediation] No se pudo invalidar cache de audit:", e?.message));

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("Delete error:", e);
    const err = e as { code?: string; statusCode?: number; message?: string };
    if (err.code === "AuthorizationFailed" || err.statusCode === 403 || (err.message && err.message.includes("AuthorizationFailed"))) {
      return NextResponse.json({ 
          error: "MISSING_CONTRIBUTOR_ROLE", 
          clientId: process.env.AZURE_CLIENT_ID 
      }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
