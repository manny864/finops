/**
 * GET  /api/governance/approvals — peticiones pendientes e historial de decisiones.
 * POST /api/governance/approvals — resuelve una petición (aprobar o rechazar).
 *
 * Flujo de cuatro ojos: quien solicita el cambio no es quien lo aprueba, y la
 * aprobación es lo que dispara la llamada a ARM. La implementación anterior
 * (`/api/remediation/workflow` PATCH) sólo cambiaba el estado en MySQL: el
 * historial decía "Aprobado" y el recurso seguía facturando.
 *
 * RBAC: `isMockTenant` ANTES del guard — la rama mock devuelve literales puros.
 * Aprobar exige Owner/Admin: ejecuta acciones irreversibles sobre Azure.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getAzureCredential } from "@/lib/azure";
import { getSubscriptionNameMap } from "@/lib/azureSubscriptionNames";
import { logAction } from "@/services/remediationService";
import { notifyTenant } from "@/lib/notifications";
import {
  assembleLiveApprovals,
  executeApprovedAction,
  getApprovalById,
  getMockApprovalsPayload,
  listApprovals,
  mapHistoryRow,
  mapPendingRow,
  resolveApproval,
  statusFromDb,
} from "@/services/azureRemediationApprovals.service";
import { errorMessage } from "@/lib/apiErrors";

function isDemo(tenantId: string, searchParams: URLSearchParams): boolean {
  return (
    isMockTenant(tenantId) ||
    searchParams.get("mock") === "true" ||
    tenantId.startsWith("demo-") ||
    tenantId.startsWith("mock-")
  );
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    if (isDemo(tenantId, searchParams)) {
      return NextResponse.json(getMockApprovalsPayload(tenantId));
    }

    // Ver el tablero exige el tier contratado (/governance/approvals es Business
    // en routeTiers.ts); resolver exige además Owner/Admin y se valida en el POST.
    await requireTenantTier(request, tenantId, "Business");

    const rows = await listApprovals(tenantId);
    const credential = await getAzureCredential(tenantId).catch(() => null);
    const subNames = credential
      ? await getSubscriptionNameMap(tenantId, credential).catch(() => new Map<string, string>())
      : new Map<string, string>();

    const pendingRequests = rows.filter((r) => statusFromDb(r.status) === "PENDING").map((r) => mapPendingRow(r, subNames));
    const history = rows.filter((r) => statusFromDb(r.status) !== "PENDING").map(mapHistoryRow);

    return NextResponse.json(assembleLiveApprovals({ pendingRequests, history }));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Approvals] Error:", errorMessage(error));
    return NextResponse.json({ error: "Error interno cargando las aprobaciones" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { tenantId, approvalId, decision, rejectionReason, createBackupSnapshot } = body || {};

    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    if (!approvalId) return NextResponse.json({ error: "Falta approvalId" }, { status: 400 });
    if (decision !== "APPROVE" && decision !== "REJECT") {
      return NextResponse.json({ error: "decision inválida (APPROVE / REJECT)" }, { status: 400 });
    }
    if (decision === "REJECT" && !String(rejectionReason || "").trim()) {
      // Un rechazo sin motivo deja al solicitante sin saber qué corregir y
      // convierte el historial en una lista de "no" sin trazabilidad.
      return NextResponse.json({ error: "El rechazo requiere un motivo" }, { status: 400 });
    }

    if (isDemo(tenantId, new URL(request.url).searchParams)) {
      return NextResponse.json({
        success: true,
        mock: true,
        message:
          decision === "APPROVE"
            ? "Aprobación simulada en el entorno de demostración: no se ejecutó nada sobre Azure."
            : "Rechazo registrado en el entorno de demostración.",
      });
    }

    const identity = await requireTenantRole(request, tenantId, ["Owner", "Admin"]);
    await requireTenantTier(request, tenantId, "Business");
    const resolver = identity.email || "unknown@tenant.local";

    const row = await getApprovalById(tenantId, String(approvalId));
    if (!row) return NextResponse.json({ error: "Petición no encontrada" }, { status: 404 });
    if (statusFromDb(row.status) !== "PENDING") {
      return NextResponse.json({ error: "La petición ya fue resuelta" }, { status: 409 });
    }

    const item = mapPendingRow(row);

    // Cuatro ojos: el solicitante no puede aprobar su propio pedido. Los
    // motores automáticos (advisor-bot, rightsizing-engine) nunca coinciden con
    // un email de operador, así que la regla sólo bloquea el auto-aprobado real.
    if (decision === "APPROVE" && item.requestedBy.toLowerCase() === resolver.toLowerCase()) {
      return NextResponse.json(
        { error: "No podés aprobar una petición que vos mismo solicitaste. Debe revisarla otro operador." },
        { status: 403 }
      );
    }

    if (decision === "REJECT") {
      const ok = await resolveApproval(tenantId, String(approvalId), "REJECTED", resolver, {
        rejectionReason: String(rejectionReason).slice(0, 500),
      });
      if (!ok) return NextResponse.json({ error: "La petición ya fue resuelta por otro operador" }, { status: 409 });

      await logAction(tenantId, resolver, "REJECT_REMEDIATION", item.resourceId, "SUCCESS");
      notifyTenant(tenantId, {
        title: "Petición de remediación rechazada",
        message: `${resolver} rechazó ${item.actionDisplayName} sobre "${item.resourceName}". Motivo: ${rejectionReason}`,
        severity: "info",
      }).catch(() => {});

      return NextResponse.json({ success: true, status: "REJECTED", message: "Petición rechazada." });
    }

    // ── Aprobación: ejecutar en ARM y persistir el resultado real ──
    const armResult = await executeApprovedAction(tenantId, item, {
      createBackupSnapshot: Boolean(createBackupSnapshot),
    });

    // Si Azure rechazó el cambio, la fila queda en `Failed`, no en `Approved`:
    // el historial tiene que distinguir una acción aplicada de una que no.
    const finalStatus = armResult.status === "Succeeded" ? "APPROVED" : "FAILED";
    const ok = await resolveApproval(tenantId, String(approvalId), finalStatus, resolver, { armResult });
    if (!ok) return NextResponse.json({ error: "La petición ya fue resuelta por otro operador" }, { status: 409 });

    await logAction(
      tenantId,
      resolver,
      `APPROVE_${item.actionType}`,
      item.resourceId,
      armResult.status === "Succeeded" ? "SUCCESS" : "FAILED"
    );

    notifyTenant(tenantId, {
      title:
        armResult.status === "Succeeded"
          ? "Remediación aplicada"
          : "Remediación aprobada pero fallida en Azure",
      message: `${resolver} aprobó ${item.actionDisplayName} sobre "${item.resourceName}". ${armResult.detail}`,
      severity: armResult.status === "Succeeded" ? "info" : "warning",
    }).catch(() => {});

    return NextResponse.json({
      success: armResult.status === "Succeeded",
      status: finalStatus,
      armExecutionStatus: armResult.status,
      snapshotId: armResult.snapshotId,
      message: armResult.detail,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Approvals] POST error:", errorMessage(error));
    return NextResponse.json({ error: "Error interno resolviendo la petición" }, { status: 500 });
  }
}
