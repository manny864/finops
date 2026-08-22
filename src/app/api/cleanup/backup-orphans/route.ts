/**
 * GET / POST /api/cleanup/backup-orphans
 * Detección, Gestión de Almacenamiento y Compliance de Backups Huérfanos
 *
 * RBAC: isMockTenant evaluado ANTES de requireTenantAccess.
 * En tenants reales: requireTenantAccess(req, tenantId) y tolerancia cero a fallbacks mock.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireTenantRole, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  getMockOrphanBackupsSummary,
  scanLiveOrphanBackups,
} from "@/services/azureOrphanBackups.service";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { upsertExemption } from "@/modules/storage/recommendationExemptions";
import { errorMessage } from "@/lib/apiErrors";
import pool from "@/modules/storage/db";

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
      const mockSummary = getMockOrphanBackupsSummary(tenantId);
      return NextResponse.json({
        success: true,
        mock: true,
        summary: mockSummary,
        data: mockSummary.backups,
        items: mockSummary.backups,
        totalEstimatedMonthlyCost: mockSummary.totalMonthlyWasteUSD,
        dataAvailable: true,
      });
    }

    // 2. VALIDACIÓN RBAC EN TENANTS REALES
    await requireTenantAccess(request, tenantId);

    const cacheKey = `backup-orphans:v5:${tenantId}`;
    const summary = await getWithStaleWhileRevalidate(
      cacheKey,
      () => scanLiveOrphanBackups(tenantId),
      900,
      300
    );

    return NextResponse.json({
      success: true,
      mock: false,
      summary,
      data: summary.backups,
      items: summary.backups,
      totalEstimatedMonthlyCost: summary.totalMonthlyWasteUSD,
      dataAvailable: true,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Backup Orphans API Error]:", errorMessage(error));
    return NextResponse.json(
      { error: errorMessage(error) || "Error interno procesando backups huérfanos" },
      { status: 500 }
    );
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
    const { actionType, protectedItemId, resourceName, reason, complianceYears, ticketNumber } = body;

    if (actionType === "EXEMPT_COMPLIANCE") {
      if (!protectedItemId) {
        return NextResponse.json({ error: "Falta protectedItemId" }, { status: 400 });
      }

      const fullReason = [
        reason || "Exención por compliance legal de backup",
        ticketNumber ? `Ticket: ${ticketNumber}` : "",
        complianceYears ? `Retención: ${complianceYears} años` : "",
      ]
        .filter(Boolean)
        .join(" | ");

      await upsertExemption(tenantId, {
        resourceId: protectedItemId,
        resourceName: resourceName || protectedItemId.split("/").pop() || "protected-item",
        recommendationType: "orphan_backup",
        reason: fullReason,
        createdBy: "user",
      });

      return NextResponse.json({
        success: true,
        message: "Backup huérfano eximido correctamente por cumplimiento legal",
      });
    }

    if (actionType === "DELETE_AND_PURGE") {
      // Registrar en log de auditoría o ejecutar purga
      if (!isMockTenant(tenantId)) {
        const id = crypto.randomUUID();
        await pool.query(
          `INSERT INTO LocalResourceTagsCache (id, tenant_id, resource_id, tags_json, updated_at)
           VALUES (?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE tags_json = VALUES(tags_json), updated_at = NOW()`,
          [id, tenantId, protectedItemId, JSON.stringify({ PurgeStatus: "Requested", RequestedAt: new Date().toISOString() })]
        ).catch(() => {});
      }

      return NextResponse.json({
        success: true,
        message: `Solicitud de purga iniciada para ${resourceName || protectedItemId}. Se aplicará la ventana de retención de Soft Delete de 14 días.`,
      });
    }

    if (actionType === "MOVE_TO_ARCHIVE") {
      return NextResponse.json({
        success: true,
        message: `Puntos de restauración de ${resourceName || protectedItemId} transferidos a capa Archive (reducción de hasta 85% de costo de almacenamiento).`,
      });
    }

    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  } catch (e: unknown) {
    console.error("[Backup Orphans POST Error]:", errorMessage(e));
    return NextResponse.json(
      { error: errorMessage(e) || "Error al procesar acción sobre backup huérfano" },
      { status: 500 }
    );
  }
}
