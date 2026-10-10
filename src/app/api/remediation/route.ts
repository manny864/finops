import { NextRequest, NextResponse } from "next/server";
import { deleteResource } from "@/services/remediationService";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { bloqueoPorDelegacionDeLectura } from "@/lib/lighthouseAccess";
import { exigirScopesDelTenant } from "@/lib/scopeDelTenant";
import { getDeleteRemediationTier, DeleteResourceDomain } from "@/lib/tierLogic";
import { invalidateCache, invalidateCachePattern } from "@/lib/cache";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { azureErrorResponse } from "@/lib/apiErrors";
import { esBorradoManual } from "@/lib/zombieAuditCatalog";
import { zombieScanCacheKey } from "@/services/azureZombieScan.service";
import { networkingZombiesCacheKey } from "@/services/azureNetworkingZombies.service";

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
    // Hay tipos que la plataforma DETECTA pero no elimina: se gestionan desde
    // Azure porque borrarlos exige Contributor sobre la suscripción del cliente,
    // que es un permiso que el onboarding deliberadamente no pide.
    //
    // El guard va acá y no sólo en la UI porque la UI ya lo tenía --el botón
    // viene deshabilitado y `handleDelete` corta-- y aun así llegó un DELETE de
    // un `microsoft.web/connections` (prod, 2026-09-15). Sin este chequeo el
    // pedido viajaba hasta ARM y volvía un 403 de Azure: un error de permisos
    // para algo que en realidad el producto no ofrece, que es un diagnóstico
    // equivocado y manda a pedir permisos que no hacen falta.
    if (esBorradoManual(resourceType)) {
      return NextResponse.json(
        {
          error: "RESOURCE_TYPE_NOT_DELETABLE",
          details: `El tipo ${resourceType} se gestiona desde Azure: la plataforma lo detecta pero no lo elimina.`,
        },
        { status: 400 }
      );
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

    // Lo que se borra tiene que ser de este tenant: con Lighthouse la credencial
    // alcanza a todos los clientes. Se validan los dos caminos de deleteResource:
    // el SDK arma la ruta con las partes y el REST usa resourceId si viene.
    await exigirScopesDelTenant(tenantId, [
      `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/${resourceType}/${resourceName}`,
      ...(resourceId ? [resourceId] : []),
    ]);

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

    // Invalidar la caché (Redis SWR) de toda pantalla que liste el recurso recién borrado, para que no siga
    // apareciendo hasta que expire el TTL. Las claves de zombis salen de la MISMA función que usa la pantalla
    // que las lee: copiarlas acá a mano las dejó apuntando a versiones que ya nadie leía (zombis v2, red v1) y la
    // purga no se veía hasta 15 min después. __tests__/unit/remediacionInvalidaCache.test.ts corre las pantallas
    // reales y falla si alguna lista queda cacheada o si se pide borrar una clave que ninguna lee.
    const suscripciones: (string | undefined)[] = [undefined]; // undefined = la vista "todas"
    if (subscriptionId) suscripciones.push(String(subscriptionId).toLowerCase());

    await invalidateCache(
      `audit:ttl:v1:${tenantId}`,
      ...suscripciones.flatMap((sub) => [
        `audit:full:v1:${tenantId}:${sub ?? "all"}`,
        zombieScanCacheKey(tenantId, sub),
        networkingZombiesCacheKey(tenantId, sub),
      ])
    );
    // El advisor cachea por idioma (el de la URL o, sin él, el header Accept-Language entero) y por
    // suscripción: no es un conjunto enumerable. Se barre por patrón, con el comodín de versión que ya usa el
    // cron de sync, para que subir de versión la clave no vuelva a dejar esto apuntando al vacío.
    await invalidateCachePattern(`advisor:v*:${tenantId}:*`);

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    // Mismo criterio que downgrade: un 4xx de Azure lleva el motivo real
    // (recurso bloqueado, dependencia, permisos) y es lo único accionable.
    // No se expone AZURE_CLIENT_ID: es disclosure de infra innecesario.
    return azureErrorResponse(e, "POST /api/remediation");
  }
}
