/**
 * GET / POST /api/cleanup/ttl
 * Motor de Ciclo de Vida y Gobernanza TTL (Time-To-Live Enforcement)
 *
 * RBAC: isMockTenant evaluado ANTES de requireTenantAccess.
 * En tenants reales: requireTenantTier(req, tenantId, 'Business') y tolerancia cero a fallbacks mock.
 */

import { NextRequest, NextResponse } from "next/server";
import { findExpiredResources, getUnlabeledResources, TTL_RESOURCE_TYPES, TtlResourceType } from "@/services/ttlService";
import { AuthError, requireTenantTier, requireTenantAccess, requireTenantRole } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getAzureCredential } from "@/lib/azure";
import { getSubscriptionNameMap } from "@/lib/azureSubscriptionNames";
import { getExemptionsForTenant, upsertExemption } from "@/modules/storage/recommendationExemptions";
import {
  getMockTtlSummaryMetrics,
  assembleLiveTtlSummary,
} from "@/services/azureTtlEnforcement.service";
import pool from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import { TtlPolicyItem, TtlDeletionRecord } from "@/types/azureTtlEnforcement.types";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId") || request.headers.get("x-tenant-id");

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    // 1. EVALUAR MOCK ANTES DE RBAC
    if (
      isMockTenant(tenantId) ||
      searchParams.get("mock") === "true" ||
      tenantId.startsWith("demo-") ||
      tenantId.startsWith("mock-")
    ) {
      const mockMetrics = getMockTtlSummaryMetrics(tenantId);
      return NextResponse.json({
        success: true,
        mock: true,
        metrics: mockMetrics,
        data: mockMetrics.trackedResources,
        policies: mockMetrics.policies,
        unlabeled: mockMetrics.untaggedResources,
        history: mockMetrics.deletionHistory,
      });
    }

    // 2. VALIDACIÓN RBAC OBLIGATORIA EN TENANTS REALES
    try {
      await requireTenantTier(request, tenantId, "Business");
    } catch (error: unknown) {
      if (error instanceof AuthError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    const credential = await getAzureCredential(tenantId);

    // Cargar en paralelo: ARG Expired, Subscriptions Map, MySQL Policies, MySQL Deletion History, Exemptions
    const [rawExpired, subNameMap, policiesResult, historyResult, exemptions] = await Promise.all([
      findExpiredResources(tenantId).catch(() => []),
      getSubscriptionNameMap(tenantId, credential),
      pool
        .query(
          `SELECT id, name, resource_type AS targetResourceType, days_to_live AS maxLifespanDays,
                  description, enabled AS isEnabled, created_by AS createdBy, created_at AS createdAt
           FROM TtlPolicies WHERE tenant_id = ? ORDER BY created_at DESC`,
          [tenantId]
        )
        .catch(() => [[]]),
      pool
        .query(
          `SELECT id, resource_id AS resourceId, resource_name AS resourceName, resource_type AS resourceType,
                  resource_group AS resourceGroup, expiration_date AS expiredAtDate,
                  deleted_by AS deletedBy, deleted_at AS deletedAtDate
           FROM TtlDeletions WHERE tenant_id = ? ORDER BY deleted_at DESC LIMIT 500`,
          [tenantId]
        )
        .catch(() => [[]]),
      getExemptionsForTenant(tenantId).catch(() => []),
    ]);

    const policies: TtlPolicyItem[] = ((policiesResult as any)?.[0] || []).map((p: any) => ({
      ...p,
      isEnabled: Boolean(p.isEnabled ?? true),
      notifyDaysBefore: 3,
    }));

    const history: TtlDeletionRecord[] = (historyResult as any)?.[0] || [];

    const exemptionsMap = new Map(
      exemptions
        .filter((e) => e.recommendationType === "ttl" || e.recommendationType === "zombies")
        .map((e) => [(e.resourceId || "").toLowerCase(), { reason: e.reason }])
    );

    // Obtener unlabeled para las políticas activas
    let rawUntagged: any[] = [];
    if (policies.length > 0) {
      const activeTypes = Array.from(
        new Set(
          policies
            .filter((p) => p.isEnabled)
            .map((p) => p.targetResourceType?.toLowerCase())
            .filter(Boolean)
        )
      );

      const targetTypes = TTL_RESOURCE_TYPES.filter((t) =>
        activeTypes.some((at) => t.toLowerCase().includes(at) || at.includes(t.toLowerCase()))
      );

      if (targetTypes.length > 0) {
        const untaggedResults = await Promise.all(
          targetTypes.map((type) => getUnlabeledResources(tenantId, type as TtlResourceType).catch(() => []))
        );
        rawUntagged = untaggedResults.flat();
      }
    }

    const metrics = await assembleLiveTtlSummary({
      tenantId,
      rawExpiredItems: rawExpired,
      rawUntaggedItems: rawUntagged,
      policies,
      deletionHistory: history,
      exemptions: exemptionsMap,
      subNameMap,
    });

    return NextResponse.json({
      success: true,
      mock: false,
      metrics,
      data: metrics.trackedResources,
      policies: metrics.policies,
      unlabeled: metrics.untaggedResources,
      history: metrics.deletionHistory,
    });
  } catch (error: unknown) {
    console.error("[TTL API Error]:", errorMessage(error));
    return NextResponse.json({ error: errorMessage(error) || "Error interno en TTL Enforcement" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId") || request.headers.get("x-tenant-id");

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    if (!isMockTenant(tenantId)) {
      try {
        await requireTenantRole(request, tenantId, ["Admin", "Owner", "Contributor", "FinOps"]);
      } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        throw e;
      }
    }

    const body = await request.json();
    const { actionType, resourceId, resourceName, additionalDays, expiryDateIso, reason } = body;

    if (actionType === "EXTEND_LIFESPAN") {
      const days = Number(additionalDays || 7);
      const newExpiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

      if (!isMockTenant(tenantId)) {
        // Guardar en caché de tags local
        const id = crypto.randomUUID();
        await pool.query(
          `INSERT INTO LocalResourceTagsCache
            (id, tenant_id, resource_id, tags_json, updated_at)
           VALUES (?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
            tags_json = VALUES(tags_json),
            updated_at = NOW()`,
          [id, tenantId, resourceId, JSON.stringify({ ExpireOn: newExpiry, TTL: `${days}d` })]
        );
      }

      return NextResponse.json({
        success: true,
        message: `Prórroga de ${days} días aplicada con éxito`,
        newExpiryDate: newExpiry,
      });
    }

    if (actionType === "APPLY_TTL_TAG") {
      const expiry = expiryDateIso || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

      if (!isMockTenant(tenantId)) {
        const id = crypto.randomUUID();
        await pool.query(
          `INSERT INTO LocalResourceTagsCache
            (id, tenant_id, resource_id, tags_json, updated_at)
           VALUES (?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
            tags_json = VALUES(tags_json),
            updated_at = NOW()`,
          [id, tenantId, resourceId, JSON.stringify({ ExpireOn: expiry })]
        );
      }

      return NextResponse.json({
        success: true,
        message: "Etiqueta ExpireOn aplicada correctamente",
        expiryDate: expiry,
      });
    }

    if (actionType === "EXEMPT") {
      if (!resourceId) return NextResponse.json({ error: "Falta resourceId" }, { status: 400 });
      await upsertExemption(tenantId, {
        resourceId,
        resourceName: resourceName || resourceId.split("/").pop() || "resource",
        recommendationType: "ttl",
        reason: reason || "Eximido por el usuario en TTL Enforcement",
        createdBy: "user",
      });
      return NextResponse.json({ success: true, message: "Recurso eximido de la política TTL" });
    }

    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  } catch (e: unknown) {
    console.error("[TTL POST Error]:", errorMessage(e));
    return NextResponse.json({ error: errorMessage(e) || "Error al procesar acción TTL" }, { status: 500 });
  }
}
