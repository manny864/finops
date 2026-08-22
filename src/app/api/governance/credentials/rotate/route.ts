/**
 * POST /api/governance/credentials/rotate
 * Rota el secreto de una App Registration de Entra ID.
 *
 * Crea un secreto NUEVO sin revocar el anterior: rotar es agregar y después
 * migrar los consumidores. Revocar en el mismo paso dejaría fuera de servicio
 * todo lo que todavía usa el secreto viejo, que es exactamente el incidente que
 * este módulo intenta prevenir.
 *
 * El `secretText` viaja una única vez en la respuesta — Graph no lo devuelve
 * nunca más — y por eso NO se persiste ni se loguea: sólo se registra en
 * ActionLogs el hecho de la rotación con el keyId, no el valor.
 *
 * RBAC: `isMockTenant` ANTES del guard. Owner/Admin + tier Business.
 * Permisos Graph mínimos: `Application.ReadWrite.OwnedBy`.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getGraphTokenForTenant } from "@/services/credentialExpiryService";
import { rotateApplicationSecret } from "@/services/azureCredentialsExpiry.service";
import { logAction } from "@/services/remediationService";
import { errorMessage } from "@/lib/apiErrors";

/** GUID de aplicación de Graph: object ID o App ID (el servicio resuelve cuál es). */
const OBJECT_ID_RE = /^[0-9a-fA-F-]{36}$/;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { tenantId, applicationId, validityMonths, description } = body || {};

    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    if (!applicationId) return NextResponse.json({ error: "Falta applicationId" }, { status: 400 });

    const isDemo =
      isMockTenant(tenantId) ||
      new URL(request.url).searchParams.get("mock") === "true" ||
      String(tenantId).startsWith("demo-") ||
      String(tenantId).startsWith("mock-");

    if (isDemo) {
      const end = new Date();
      end.setMonth(end.getMonth() + (Number(validityMonths) || 12));
      return NextResponse.json({
        success: true,
        mock: true,
        // Valor evidentemente sintético: nadie debería confundirlo con un
        // secreto real y pegarlo en una configuración.
        secretText: "DEMO~no-es-un-secreto-real~0000000000000000000",
        keyId: "00000000-0000-0000-0000-000000000000",
        endDateTime: end.toISOString(),
        message: "Secreto simulado en el entorno de demostración: no existe en Entra ID.",
      });
    }

    const objectId = String(applicationId);
    if (!OBJECT_ID_RE.test(objectId)) {
      return NextResponse.json(
        {
          error:
            "applicationId inválido: se espera un GUID de la App Registration (object ID o App ID / Client ID).",
        },
        { status: 400 }
      );
    }

    const identity = await requireTenantRole(request, tenantId, ["Owner", "Admin"]);
    await requireTenantTier(request, tenantId, "Business");

    const token = await getGraphTokenForTenant(tenantId);
    if (!token) {
      return NextResponse.json(
        { error: "No hay credenciales del Service Principal para este tenant. Completá el onboarding." },
        { status: 400 }
      );
    }

    try {
      const result = await rotateApplicationSecret(
        token,
        objectId,
        Number(validityMonths) || 12,
        description ? String(description) : undefined
      );

      // Se registra el hecho y el keyId; el valor del secreto no se persiste ni
      // se escribe en el log.
      await logAction(tenantId, identity.email || "unknown", "ROTATE_APP_SECRET", `${objectId}#${result.keyId}`, "SUCCESS");

      return NextResponse.json({
        success: true,
        secretText: result.secretText,
        keyId: result.keyId,
        endDateTime: result.endDateTime,
        message:
          "Secreto creado. El secreto anterior sigue vigente a propósito: migrá los consumidores y recién después eliminalo desde el portal de Entra ID.",
      });
    } catch (e) {
      await logAction(tenantId, identity.email || "unknown", "ROTATE_APP_SECRET", objectId, "FAILED");
      throw e;
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const msg = errorMessage(error);
    console.error("[API Credentials rotate] Error:", msg);
    return NextResponse.json({ error: msg || "Error interno rotando el secreto" }, { status: 502 });
  }
}
