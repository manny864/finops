/**
 * GET / POST / DELETE /api/cleanup/zombies
 * Motor Omni-Scan de Auditoría y Remediación de Recursos Zombis (Hard Waste vs Soft Waste)
 *
 * RBAC: isMockTenant evaluado ANTES de requireTenantAccess.
 * En tenants reales: requireTenantAccess / requireTenantRole y tolerancia cero a fallbacks mock.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireTenantRole, AuthError } from "@/lib/requestAuth";
import { exigirSuscripcionDelTenant } from "@/lib/scopeDelTenant";
import { getWithStaleWhileRevalidate, invalidateCache } from "@/lib/cache";
import { isMockTenant } from "@/lib/mockData";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import {
  getMockZombieAuditPayload,
  assembleLiveZombieAudit,
  getZombieExemptions,
  getLocalTagsCache,
  saveZombieExemption,
  deleteZombieExemption,
  saveLocalResourceTags,
} from "@/services/azureZombieAudit.service";
import {
  scanLiveZombies,
  zombieScanCacheKey,
  ZOMBIE_SCAN_TTL_S,
  ZOMBIE_SCAN_SOFT_TTL_S,
} from "@/services/azureZombieScan.service";
import { ZombieExemptionPayload } from "@/types/azureZombieAudit.types";

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get("subscriptionId");
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      const mockPayload = getMockZombieAuditPayload(tenantId);
      return NextResponse.json({
        success: true,
        data: mockPayload.metrics.resources,
        metrics: mockPayload.metrics,
        source: "mock",
        lastUpdated: mockPayload.lastUpdated,
      });
    }

    await requireTenantAccess(request, tenantId);
    await exigirSuscripcionDelTenant(tenantId, subscriptionId);

    const rawItems = await getWithStaleWhileRevalidate(
      zombieScanCacheKey(tenantId, subscriptionId),
      // Si Resource Graph falla, esta pantalla muestra la lista vacía (y así se cachea): comportamiento histórico
      // de la ruta. El reporte ejecutivo, que comparte el escaneo, en cambio lo informa como dato no disponible.
      () => scanLiveZombies(tenantId, subscriptionId).catch(() => []),
      ZOMBIE_SCAN_TTL_S,
      ZOMBIE_SCAN_SOFT_TTL_S
    );

    const [exemptions, localTags] = await Promise.all([
      getZombieExemptions(tenantId),
      getLocalTagsCache(tenantId),
    ]);

    const assembled = assembleLiveZombieAudit({
      rawItems,
      exemptions,
      localTags,
    });

    return NextResponse.json({
      success: true,
      data: assembled.metrics.resources,
      metrics: assembled.metrics,
      source: "live",
      lastUpdated: assembled.lastUpdated,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Zombies API] GET error:", errorMessage(error));
    return NextResponse.json(
      { error: "Error interno procesando auditoría de zombis" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    const isMock = isMockTenant(tenantId);
    let userEmail = "admin@demo.local";

    if (!isMock) {
      const identity = await requireTenantRole(request, tenantId, ["Admin", "Owner"]);
      userEmail = identity.email || "admin";
    }

    const body = await request.json();
    const { action } = body;

    if (action === "TAG") {
      const { resourceIds, tags } = body;
      if (!Array.isArray(resourceIds) || resourceIds.length === 0 || !tags) {
        return NextResponse.json({ error: "Faltan resourceIds o tags" }, { status: 400 });
      }

      if (!isMock) {
        await saveLocalResourceTags(tenantId, resourceIds, tags);
      }

      return NextResponse.json({
        success: true,
        message: `${resourceIds.length} recurso(s) etiquetados exitosamente`,
        appliedTags: tags,
      });
    }

    if (action === "EXEMPT") {
      const { resourceId, resourceName, resourceType, reason, durationDays } = body;
      if (!resourceId) {
        return NextResponse.json({ error: "Falta resourceId" }, { status: 400 });
      }

      if (!isMock) {
        await saveZombieExemption(
          tenantId,
          {
            resourceId,
            resourceName,
            resourceType,
            reason: reason || "Eximido por el usuario",
            durationDays: durationDays ? Number(durationDays) : undefined,
          },
          userEmail
        );
      }

      return NextResponse.json({
        success: true,
        message: "Recurso eximido de la auditoría zombi",
      });
    }

    if (action === "REMOVE_EXEMPTION") {
      const { resourceId } = body;
      if (!resourceId) {
        return NextResponse.json({ error: "Falta resourceId" }, { status: 400 });
      }

      if (!isMock) {
        await deleteZombieExemption(tenantId, resourceId);
      }

      return NextResponse.json({
        success: true,
        message: "Exención removida; recurso reincorporado a la auditoría",
      });
    }

    // La purga real se hace en POST /api/remediation (deleteResource +
    // ActionLogs + invalidación de caché). Antes existía acá una acción
    // "REMEDIATE" que devolvía success sin borrar nada ni registrar el pedido:
    // el usuario veía "remediado" y el recurso seguía facturando.

    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Zombies API] POST error:", errorMessage(error));
    return NextResponse.json(
      { error: "Error procesando acción de auditoría zombi" },
      { status: 500 }
    );
  }
}
