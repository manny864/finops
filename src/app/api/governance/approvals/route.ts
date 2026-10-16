/**
 * GET  /api/governance/approvals — peticiones pendientes e historial de decisiones.
 * POST /api/governance/approvals — aprueba/rechaza o consulta una ejecución ya enviada.
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
import { bloqueoPorDelegacionDeLectura } from "@/lib/lighthouseAccess";
import { exigirScopesDelTenant } from "@/lib/scopeDelTenant";
import { isMockTenant } from "@/lib/mockData";
import { getAzureCredential } from "@/lib/azure";
import { getSubscriptionNameMap } from "@/lib/azureSubscriptionNames";
import { logAction } from "@/services/remediationService";
import { notifyTenant } from "@/lib/notifications";
import {
  assembleLiveApprovals,
  claimApprovalExecution,
  executeApprovedAction,
  getApprovalById,
  getMockApprovalsPayload,
  listApprovals,
  mapHistoryRow,
  mapPendingRow,
  recordPendingApprovalExecution,
  reconcileApprovalExecution,
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
    if (decision !== "APPROVE" && decision !== "REJECT" && decision !== "RECONCILE") {
      return NextResponse.json({ error: "decision inválida (APPROVE / REJECT / RECONCILE)" }, { status: 400 });
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
            : decision === "RECONCILE"
              ? "Conciliación simulada: no se consultó ni modificó Azure."
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

    if (decision === "RECONCILE") {
      const result = await reconcileApprovalExecution(tenantId, String(approvalId));
      await logAction(tenantId, resolver, `RECONCILE_${item.actionType}`, item.resourceId, result.status.toUpperCase());
      return NextResponse.json({
        success: result.status === "Succeeded",
        status: result.status === "Running" ? "PENDING" : result.status === "Succeeded" ? "APPROVED" : "FAILED",
        armExecutionStatus: result.status, message: result.detail,
      }, { status: result.status === "Running" ? 202 : 200 });
    }

    // Cuatro ojos: el solicitante no puede aprobar su propio pedido. Los
    // motores automáticos (advisor-bot, rightsizing-engine) nunca coinciden con
    // un email de operador, así que la regla sólo bloquea el auto-aprobado real.
    if (decision === "APPROVE" && item.requestedBy.trim().toLowerCase() === resolver.trim().toLowerCase()) {
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
        message: `${resolver} rechazó ${item.actionType} sobre "${item.resourceName}". Motivo: ${rejectionReason}`,
        severity: "info",
      }).catch((error) => console.warn("[Approvals] No se pudo notificar el rechazo:", errorMessage(error)));

      return NextResponse.json({ success: true, status: "REJECTED", message: "Petición rechazada." });
    }

    // ── Aprobación: ejecutar en ARM y persistir el resultado real ──
    // Rechazar no toca Azure; aprobar sí, así que los guards van recién acá.
    const bloqueo = await bloqueoPorDelegacionDeLectura(tenantId);
    if (bloqueo) return bloqueo;
    // El resourceId lo cargó quien pidió el cambio (remediation/workflow acepta
    // cualquiera): tiene que ser de este tenant. Se validan las dos formas en
    // que executeApprovedAction arma la ruta, el id entero y las partes
    // (snapshot previo y apagado).
    await exigirScopesDelTenant(tenantId, [
      item.resourceId,
      `/subscriptions/${item.subscriptionId}/resourceGroups/${item.resourceGroup}/providers/${item.resourceType}/${item.resourceName}`,
    ]);

    const executionToken = await claimApprovalExecution(tenantId, String(approvalId), resolver, row);
    if (!executionToken) {
      return NextResponse.json({ error: "La petición cambió o ya está en ejecución/resuelta" }, { status: 409 });
    }
    const armResult = await executeApprovedAction(tenantId, item, {
      createBackupSnapshot: Boolean(createBackupSnapshot),
    });
    if (armResult.status === "Running") {
      // Keep the durable claim. Automatic retry could duplicate an accepted ARM operation.
      const recorded = await recordPendingApprovalExecution(tenantId, String(approvalId), executionToken, armResult);
      if (!recorded) {
        console.error("[Approvals] Pending ARM evidence lost ownership:", { tenantId, approvalId });
        return NextResponse.json({ error: "El resultado ARM requiere conciliación; no reenviar la acción" }, { status: 409 });
      }
      await logAction(tenantId, resolver, `SUBMITTED_${item.actionType}`, item.resourceId, "RUNNING");
      return NextResponse.json({
        success: false, status: "PENDING", armExecutionStatus: "Running",
        message: armResult.detail,
      }, { status: 202 });
    }

    // Si Azure rechazó el cambio, la fila queda en `Failed`, no en `Approved`:
    // el historial tiene que distinguir una acción aplicada de una que no.
    const finalStatus = armResult.status === "Succeeded" ? "APPROVED" : "FAILED";
    const ok = await resolveApproval(tenantId, String(approvalId), finalStatus, resolver, { armResult, executionToken });
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
      message: `${resolver} aprobó ${item.actionType} sobre "${item.resourceName}". ${armResult.detail}`,
      severity: armResult.status === "Succeeded" ? "info" : "warning",
    }).catch((error) => console.warn("[Approvals] No se pudo notificar la resolución:", errorMessage(error)));

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
