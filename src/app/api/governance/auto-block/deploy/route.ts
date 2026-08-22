/**
 * POST   /api/governance/auto-block/deploy   — asignar una definición de política
 * DELETE /api/governance/auto-block/deploy   — eliminar una asignación
 *
 * Asignar una política con efecto Deny bloquea despliegues en todo el scope, y
 * eliminarla deja de bloquearlos: ambas son mutaciones de gobernanza con
 * alcance de management group. Por eso exigen Owner/Admin del tenant y tier
 * Enterprise, además del rol de Azure `Resource Policy Contributor` sobre el
 * scope, que es lo que finalmente autoriza la llamada a ARM.
 *
 * RBAC: `isMockTenant` ANTES del guard — la rama demo no escribe nada.
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getAzureCredential } from "@/lib/azure";
import { invalidateCache } from "@/lib/cache";
import { logAction } from "@/services/remediationService";
import { errorMessage } from "@/lib/apiErrors";
import { normalizeEffect } from "@/services/azureAutoBlockPolicies.service";

const ARM = "https://management.azure.com";
const POLICY_API_VERSION = "2023-04-01";

function isDemo(tenantId: string, searchParams: URLSearchParams): boolean {
  return (
    isMockTenant(tenantId) ||
    searchParams.get("mock") === "true" ||
    tenantId.startsWith("demo-") ||
    tenantId.startsWith("mock-")
  );
}

/**
 * Sólo se aceptan scopes de management group, suscripción o resource group con
 * la forma que produce ARM. Se valida contra una expresión cerrada porque el
 * scope se concatena en la URL del PUT: un valor arbitrario podría redirigir la
 * llamada a otra ruta del plano de control.
 */
const SCOPE_RE =
  /^\/(subscriptions\/[0-9a-fA-F-]{36}(\/resourceGroups\/[A-Za-z0-9._()-]{1,90})?|providers\/Microsoft\.Management\/managementGroups\/[A-Za-z0-9._()-]{1,90})$/;

/** Nombre de asignación: ARM acepta hasta 24 caracteres en management groups. */
const ASSIGNMENT_NAME_RE = /^[A-Za-z0-9._-]{1,24}$/;

const DEFINITION_RE =
  /^\/(providers\/Microsoft\.Authorization\/policy(Set)?Definitions\/[A-Za-z0-9._-]{1,128}|subscriptions\/[0-9a-fA-F-]{36}\/providers\/Microsoft\.Authorization\/policy(Set)?Definitions\/[A-Za-z0-9._-]{1,128}|providers\/Microsoft\.Management\/managementGroups\/[A-Za-z0-9._()-]{1,90}\/providers\/Microsoft\.Authorization\/policy(Set)?Definitions\/[A-Za-z0-9._-]{1,128})$/;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { tenantId, definitionId, scopeId, effect, displayName, description, parameters } = body || {};

    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    if (!definitionId || !DEFINITION_RE.test(String(definitionId))) {
      return NextResponse.json({ error: "definitionId inválido" }, { status: 400 });
    }
    if (!scopeId || !SCOPE_RE.test(String(scopeId))) {
      return NextResponse.json(
        { error: "scopeId inválido (se espera un management group, suscripción o grupo de recursos)" },
        { status: 400 }
      );
    }

    if (isDemo(tenantId, new URL(request.url).searchParams)) {
      return NextResponse.json({
        success: true,
        mock: true,
        message: "Política desplegada en el entorno de demostración (no se asigna sobre Azure).",
      });
    }

    const identity = await requireTenantRole(request, tenantId, ["Owner", "Admin"]);
    await requireTenantTier(request, tenantId, "Enterprise");

    const shortName = String(definitionId).split("/").pop()!.slice(0, 24);
    const assignmentName = ASSIGNMENT_NAME_RE.test(shortName) ? shortName : `pol-${Date.now().toString(36)}`;
    const url = `${ARM}${scopeId}/providers/Microsoft.Authorization/policyAssignments/${assignmentName}?api-version=${POLICY_API_VERSION}`;

    const credential = await getAzureCredential(tenantId);
    const token = await credential.getToken(`${ARM}/.default`);
    if (!token?.token) {
      return NextResponse.json({ error: "No se pudo obtener un token para Azure Resource Manager" }, { status: 502 });
    }

    const normalizedEffect = effect ? normalizeEffect(effect) : undefined;
    const res = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: {
          policyDefinitionId: definitionId,
          displayName: displayName ? String(displayName).slice(0, 128) : assignmentName,
          description: description ? String(description).slice(0, 512) : undefined,
          enforcementMode: "Default",
          parameters: {
            ...(parameters && typeof parameters === "object" ? parameters : {}),
            ...(normalizedEffect ? { effect: { value: normalizedEffect } } : {}),
          },
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      await logAction(tenantId, identity.email || "unknown", "DEPLOY_POLICY", String(scopeId), "FAILED");
      console.error(`[AutoBlock deploy] ARM ${res.status}: ${text}`);
      return NextResponse.json(
        {
          error:
            res.status === 403
              ? "El Service Principal no tiene el rol 'Resource Policy Contributor' sobre ese alcance."
              : `Azure rechazó la asignación (${res.status}).`,
          details: text.slice(0, 500),
        },
        { status: res.status === 403 ? 403 : 502 }
      );
    }

    await logAction(tenantId, identity.email || "unknown", "DEPLOY_POLICY", String(scopeId), "SUCCESS");
    // La evaluación de Azure Policy tarda; se invalida el caché para que la
    // asignación aparezca en la tabla sin esperar el TTL.
    await invalidateCache(`auto-block:v1:${tenantId}`).catch(() => {});

    return NextResponse.json({
      success: true,
      message:
        "Política asignada. Azure tarda hasta 30 minutos en completar la primera evaluación de cumplimiento sobre los recursos existentes.",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AutoBlock deploy] Error:", errorMessage(error));
    return NextResponse.json({ error: "Error interno desplegando la política" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const assignmentId = searchParams.get("assignmentId");

    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    if (!assignmentId || !assignmentId.includes("/providers/Microsoft.Authorization/policyAssignments/")) {
      return NextResponse.json({ error: "assignmentId inválido" }, { status: 400 });
    }

    if (isDemo(tenantId, searchParams)) {
      return NextResponse.json({ success: true, mock: true, message: "Asignación eliminada en el entorno demo." });
    }

    const identity = await requireTenantRole(request, tenantId, ["Owner", "Admin"]);
    await requireTenantTier(request, tenantId, "Enterprise");

    const credential = await getAzureCredential(tenantId);
    const token = await credential.getToken(`${ARM}/.default`);
    if (!token?.token) {
      return NextResponse.json({ error: "No se pudo obtener un token para Azure Resource Manager" }, { status: 502 });
    }

    const res = await fetch(`${ARM}${assignmentId}?api-version=${POLICY_API_VERSION}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token.token}` },
    });

    if (!res.ok && res.status !== 204 && res.status !== 404) {
      const text = await res.text().catch(() => "");
      await logAction(tenantId, identity.email || "unknown", "DELETE_POLICY", assignmentId, "FAILED");
      return NextResponse.json(
        { error: `Azure rechazó la eliminación (${res.status}).`, details: text.slice(0, 500) },
        { status: res.status === 403 ? 403 : 502 }
      );
    }

    await logAction(tenantId, identity.email || "unknown", "DELETE_POLICY", assignmentId, "SUCCESS");
    await invalidateCache(`auto-block:v1:${tenantId}`).catch(() => {});

    return NextResponse.json({ success: true, message: "Asignación de política eliminada." });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AutoBlock delete] Error:", errorMessage(error));
    return NextResponse.json({ error: "Error interno eliminando la asignación" }, { status: 500 });
  }
}
