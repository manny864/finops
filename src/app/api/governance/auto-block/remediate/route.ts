/**
 * POST /api/governance/auto-block/remediate
 * Dispara una tarea de remediación de Azure Policy sobre una asignación.
 *
 * Sólo tiene sentido para efectos `Modify` y `DeployIfNotExists`: son los
 * únicos que Azure puede aplicar retroactivamente. Una política `Deny` bloquea
 * altas nuevas pero no puede corregir lo ya desplegado, y `Audit` no modifica
 * nada — pedir una remediación sobre ellas devuelve un 400 explicando por qué,
 * en vez de crear una tarea que Azure completaría con cero recursos.
 *
 * RBAC: `isMockTenant` ANTES del guard. Owner/Admin + tier Enterprise.
 * RBAC Azure mínimo: `Policy Insights Data Writer` (o Contributor) sobre el
 * scope, más la identidad administrada que declare la propia asignación.
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getAzureCredential } from "@/lib/azure";
import { invalidateCache } from "@/lib/cache";
import { logAction } from "@/services/remediationService";
import { errorMessage } from "@/lib/apiErrors";
import { isRemediable, normalizeEffect } from "@/services/azureAutoBlockPolicies.service";

const ARM = "https://management.azure.com";
const REMEDIATION_API_VERSION = "2021-10-01";

const SCOPE_RE =
  /^\/(subscriptions\/[0-9a-fA-F-]{36}(\/resourceGroups\/[A-Za-z0-9._()-]{1,90})?|providers\/Microsoft\.Management\/managementGroups\/[A-Za-z0-9._()-]{1,90})$/;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { tenantId, policyAssignmentId, scopeId, effect } = body || {};

    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    if (!policyAssignmentId || !String(policyAssignmentId).includes("/policyAssignments/")) {
      return NextResponse.json({ error: "policyAssignmentId inválido" }, { status: 400 });
    }
    if (!scopeId || !SCOPE_RE.test(String(scopeId))) {
      return NextResponse.json({ error: "scopeId inválido" }, { status: 400 });
    }
    if (effect && !isRemediable(normalizeEffect(effect))) {
      return NextResponse.json(
        {
          error:
            "Sólo las políticas con efecto Modify o DeployIfNotExists se pueden remediar. Deny bloquea altas nuevas pero no revierte lo ya desplegado, y Audit no modifica recursos.",
        },
        { status: 400 }
      );
    }

    if (
      isMockTenant(tenantId) ||
      new URL(request.url).searchParams.get("mock") === "true" ||
      String(tenantId).startsWith("demo-") ||
      String(tenantId).startsWith("mock-")
    ) {
      return NextResponse.json({
        success: true,
        mock: true,
        message: "Tarea de remediación simulada en el entorno de demostración.",
      });
    }

    const identity = await requireTenantRole(request, tenantId, ["Owner", "Admin"]);
    await requireTenantTier(request, tenantId, "Enterprise");

    const credential = await getAzureCredential(tenantId);
    const token = await credential.getToken(`${ARM}/.default`);
    if (!token?.token) {
      return NextResponse.json({ error: "No se pudo obtener un token para Azure Resource Manager" }, { status: 502 });
    }

    // El nombre lleva timestamp porque Azure conserva el histórico de tareas y
    // reutilizar el nombre sobrescribiría la anterior, perdiendo su resultado.
    const remediationName = `rem-${Date.now().toString(36)}`;
    const url = `${ARM}${scopeId}/providers/Microsoft.PolicyInsights/remediations/${remediationName}?api-version=${REMEDIATION_API_VERSION}`;

    const res = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: {
          policyAssignmentId,
          // ExistingNonCompliant: sólo toca lo que ya está marcado como no
          // conforme. ReEvaluateCompliance re-evalúa todo el scope primero y en
          // tenants grandes puede tardar horas antes de corregir nada.
          resourceDiscoveryMode: "ExistingNonCompliant",
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      await logAction(tenantId, identity.email || "unknown", "POLICY_REMEDIATION", String(policyAssignmentId), "FAILED");
      console.error(`[AutoBlock remediate] ARM ${res.status}: ${text}`);
      return NextResponse.json(
        {
          error:
            res.status === 403
              ? "El Service Principal no tiene 'Policy Insights Data Writer' sobre ese alcance, o la asignación no declara una identidad administrada."
              : `Azure rechazó la tarea de remediación (${res.status}).`,
          details: text.slice(0, 500),
        },
        { status: res.status === 403 ? 403 : 502 }
      );
    }

    await logAction(tenantId, identity.email || "unknown", "POLICY_REMEDIATION", String(policyAssignmentId), "SUCCESS");
    await invalidateCache(`auto-block:v1:${tenantId}`).catch(() => {});

    const data = await res.json().catch(() => ({}));
    return NextResponse.json({
      success: true,
      remediationName,
      provisioningState: data?.properties?.provisioningState || "Accepted",
      message:
        "Tarea de remediación creada. Azure la procesa de forma asíncrona; el cumplimiento se actualiza al terminar.",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AutoBlock remediate] Error:", errorMessage(error));
    return NextResponse.json({ error: "Error interno creando la tarea de remediación" }, { status: 500 });
  }
}
