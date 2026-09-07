import { NextRequest, NextResponse } from "next/server";
import { deleteResource } from "@/services/remediationService";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { bloqueoPorDelegacionDeLectura } from "@/lib/lighthouseAccess";
import { getDeleteRemediationTier, DeleteResourceDomain } from "@/lib/tierLogic";
import { redis } from "@/lib/redis";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { azureErrorResponse } from "@/lib/apiErrors";

const DELETE_DOMAINS = new Set<DeleteResourceDomain>(["zombies", "networking", "ttl", "advisor"]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, subscriptionId, resourceGroup, resourceName, resourceType, resourceId, domain, expirationDate } = body;

    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    // Dominio de la feature que originó el borrado (zombies/networking/ttl/
    // advisor) — cada uno tiene un tier mínimo distinto (ver
    // DELETE_REMEDIATION_TIER en tierLogic.ts). Es requerido y fail-closed: sin
    // domain válido no se puede determinar qué tier exigir, así que se
    // rechaza en vez de asumir el más permisivo.
    if (!domain || !DELETE_DOMAINS.has(domain)) {
      return NextResponse.json({ error: "Falta o es inválido el parámetro domain (zombies/networking/ttl/advisor)" }, { status: 400 });
    }
    // Eliminar un recurso de Azure es una acción destructiva e irreversible:
    // solo Admin/Owner del tenant (mismo criterio que remediation/downgrade,
    // tags/apply y el GET de zombies/networking, que ya exige Admin/Owner
    // para siquiera ver la lista). requireTenantAccess (solo membresía)
    // permitía que cualquier Reader/Colaborador pudiera borrar recursos.
    const identity = await requireTenantRole(request, tenantId, ["Admin", "Owner"]);
    const email = identity.email;

    // Enforcement de tier server-side (antes solo client-side vía
    // canDeleteResources en la UI): un Admin/Owner de un tenant sin el tier
    // requerido podía pegarle directo a esta ruta y saltear el candado. La
    // 2ª capa (RBAC del Service Principal — sin permiso `delete` en tiers
    // bajos, ver onboardingScriptTemplate.ts) sigue como defensa adicional,
    // pero no debe ser la única.
    await requireTenantTier(request, tenantId, getDeleteRemediationTier(domain as DeleteResourceDomain));

    // Un tenant delegado por Azure Lighthouse puede tener una delegacion de
    // SOLO LECTURA. Sin este chequeo la accion llegaba hasta ARM y volvia con un
    // 403 crudo que no distingue "la plataforma no tiene permiso" de "el cliente
    // no delego escritura" — y el segundo lo arregla el cliente, no nosotros.
    const bloqueo = await bloqueoPorDelegacionDeLectura(tenantId);
    if (bloqueo) return bloqueo;

    await deleteResource(tenantId, email, subscriptionId, resourceGroup, resourceName, resourceType, resourceId);

    // Histórico dedicado de eliminaciones TTL (paso 4 del manual: "Consultás
    // el histórico de qué se eliminó y cuándo") — ActionLogs ya registra el
    // borrado genéricamente pero sin resource_name/expiration_date.
    if (domain === "ttl" && !isMockTenant(tenantId)) {
      try {
        await pool.query(
          `INSERT INTO TtlDeletions (tenant_id, resource_id, resource_name, resource_type, resource_group, expiration_date, deleted_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [tenantId, resourceId || null, resourceName || null, resourceType || null, resourceGroup || null, expirationDate || null, email]
        );
      } catch (e) {
        console.error("[Remediation] No se pudo registrar TtlDeletions:", e);
      }
    }

    // Invalidar cache de auditoría (Redis SWR) para que el recurso recién
    // borrado no siga apareciendo como zombie hasta que expire el TTL.
    const keysToInvalidate = [
      `audit:full:v1:${tenantId}:all`,
      `audit:ttl:v1:${tenantId}`,
      `cleanup:zombies-networking:v1:${tenantId}:all`,
      `cleanup:zombies:v2:azure:${tenantId}:all`,
      `advisor:${tenantId}:es`,
      `advisor:${tenantId}:en`,
      `advisor:${tenantId}:pt-BR`
    ];

    if (subscriptionId) {
      const subIdStr = String(subscriptionId).toLowerCase();
      keysToInvalidate.push(
        `audit:full:v1:${tenantId}:${subIdStr}`,
        `cleanup:zombies-networking:v1:${tenantId}:${subIdStr}`,
        `cleanup:zombies:v2:azure:${tenantId}:${subIdStr}`
      );
    }

    await redis.del(...keysToInvalidate).catch((e) => console.warn("[Remediation] No se pudo invalidar cache de audit:", e?.message));

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    // Mismo criterio que downgrade: un 4xx de Azure lleva el motivo real
    // (recurso bloqueado, dependencia, permisos) y es lo único accionable.
    // No se expone AZURE_CLIENT_ID: es disclosure de infra innecesario.
    return azureErrorResponse(e, "POST /api/remediation");
  }
}
