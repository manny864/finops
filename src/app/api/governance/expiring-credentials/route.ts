/**
 * GET    /api/governance/expiring-credentials — inventario de credenciales de Entra ID + reglas de alerta.
 * POST   /api/governance/expiring-credentials — crea o edita una regla de alerta.
 * PATCH  /api/governance/expiring-credentials — habilita o deshabilita una regla.
 * DELETE /api/governance/expiring-credentials — elimina una regla.
 *
 * La lectura desde Microsoft Graph vive en `credentialExpiryService`; acá se
 * traduce al contrato del módulo y se derivan los estados a partir de los días
 * restantes calculados en el momento de la consulta.
 *
 * RBAC: `isMockTenant` ANTES del guard — la rama mock devuelve literales puros.
 * Antes el guard corría primero y los tenants demo recibían 401.
 * Tier mínimo: Business (`/governance/credentials` en routeTiers.ts).
 * Permisos Graph mínimos: `Application.Read.All` (sólo lectura).
 */

import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  getGraphTokenForTenant,
  fetchAllApplications,
  extractExpiringCreds,
} from "@/services/credentialExpiryService";
import {
  assembleLiveCredentials,
  deleteAlertRule,
  getMockCredentialsPayload,
  listAlertRules,
  mapCredential,
  toggleAlertRule,
  upsertAlertRule,
  type RawCredential,
} from "@/services/azureCredentialsExpiry.service";
import { errorMessage } from "@/lib/apiErrors";

/**
 * Horizonte de la consulta a Graph. Se pide amplio a propósito: el módulo tiene
 * que poder mostrar también las credenciales sanas para el KPI de "vigentes",
 * no sólo las que están por vencer. No cambia el costo — Graph devuelve las
 * mismas aplicaciones y sólo varía el filtro local.
 */
const DEFAULT_HORIZON_DAYS = 3650;

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
      return NextResponse.json(getMockCredentialsPayload(tenantId));
    }

    await requireTenantTier(request, tenantId, "Business");

    const alertRules = await listAlertRules(tenantId);

    const token = await getGraphTokenForTenant(tenantId).catch(() => null);
    if (!token) {
      // Estado vacío legítimo con la causa explicada: nunca el dataset demo.
      return NextResponse.json({
        ...assembleLiveCredentials({ credentials: [], alertRules }),
        warning:
          "No hay credenciales del Service Principal para este tenant. Completá el onboarding (client_id/client_secret) para auditar las credenciales de Entra ID.",
      });
    }

    try {
      const apps = await fetchAllApplications(token);
      const raw = extractExpiringCreds(apps, DEFAULT_HORIZON_DAYS) as unknown as RawCredential[];
      const credentials = raw.map((r) => mapCredential(r));

      // Snapshot best-effort para que el dashboard sobreviva a una caída de
      // Graph. No condiciona la respuesta.
      pool
        .query("DELETE FROM ExpiringCredentials WHERE tenant_id = ?", [tenantId])
        .then(() => {
          if (credentials.length === 0) return null;
          const values = credentials.map((c) => [
            tenantId,
            c.appId,
            c.applicationDisplayName,
            c.credentialType === "Certificate" ? "certificate" : "password",
            c.keyId,
            c.endDateTime.slice(0, 19).replace("T", " "),
            c.daysRemaining,
          ]);
          return pool.query(
            `INSERT INTO ExpiringCredentials
             (tenant_id, app_id, display_name, credential_type, credential_id, expires_at, days_till_expiry)
             VALUES ?`,
            [values]
          );
        })
        .catch((e) => console.warn("[ExpiringCredentials] snapshot falló:", errorMessage(e)));

      return NextResponse.json(assembleLiveCredentials({ credentials, alertRules }));
    } catch (e) {
      console.error("[ExpiringCredentials] Graph en vivo falló:", errorMessage(e));
      // Fallback al snapshot propio del tenant en MySQL — dato real, no mock.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [rows]: any = await pool.query(
          `SELECT app_id AS appId, display_name AS displayName, credential_type AS credentialType,
                  credential_id AS credentialId, expires_at AS expiresAt
           FROM ExpiringCredentials WHERE tenant_id = ?`,
          [tenantId]
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const credentials = ((rows as any[]) || []).map((r) =>
          mapCredential({
            appId: r.appId,
            displayName: r.displayName,
            credentialType: r.credentialType,
            credentialId: r.credentialId,
            expiresAt: r.expiresAt instanceof Date ? r.expiresAt.toISOString() : r.expiresAt,
          })
        );
        return NextResponse.json(
          assembleLiveCredentials({
            credentials,
            alertRules,
            warning: `Microsoft Graph no respondió (${errorMessage(e)}); se muestra el último snapshot guardado de este tenant.`,
          })
        );
      } catch {
        return NextResponse.json(
          assembleLiveCredentials({
            credentials: [],
            alertRules,
            warning: `No se pudo consultar Microsoft Graph: ${errorMessage(e)}`,
          })
        );
      }
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Credentials] Error:", errorMessage(error));
    return NextResponse.json({ error: "Error interno auditando las credenciales" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { tenantId, id, ruleName, warningThresholdsDays, notificationChannels, recipients, isEnabled, reminderFrequencyHours } = body || {};

    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    if (!ruleName || String(ruleName).trim().length === 0) {
      return NextResponse.json({ error: "Falta el nombre de la alerta" }, { status: 400 });
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      // Una alerta sin destinatarios se ve activa en el tablero y no avisa a
      // nadie: es peor que no tenerla.
      return NextResponse.json({ error: "La alerta necesita al menos un destinatario" }, { status: 400 });
    }

    if (isDemo(tenantId, new URL(request.url).searchParams)) {
      return NextResponse.json({ success: true, mock: true, message: "Alerta guardada en el entorno de demostración." });
    }

    const identity = await requireTenantRole(request, tenantId, ["Owner", "Admin"]);
    await requireTenantTier(request, tenantId, "Business");

    await upsertAlertRule(
      tenantId,
      {
        id: id ? String(id) : undefined,
        ruleName: String(ruleName).trim(),
        warningThresholdsDays: Array.isArray(warningThresholdsDays) ? warningThresholdsDays.map(Number) : [30],
        notificationChannels: Array.isArray(notificationChannels) ? notificationChannels : ["EMAIL"],
        recipients: recipients.map(String),
        isEnabled: isEnabled !== false,
        // null = avisar una sola vez. `undefined` cae al default de la columna.
        reminderFrequencyHours:
          reminderFrequencyHours === null || Number.isInteger(reminderFrequencyHours)
            ? (reminderFrequencyHours as number | null)
            : 24,
      },
      identity.email || "admin"
    );

    return NextResponse.json({ success: true, message: "Alerta de vencimiento guardada." });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Credentials] POST error:", errorMessage(error));
    // El mensaje de `upsertAlertRule` dice qué falta (canal sin destinatario
    // válido); tragarlo dejaba al usuario con un 500 opaco.
    const detalle = errorMessage(error);
    return NextResponse.json(
      { error: detalle && detalle.startsWith("Ningún destinatario") ? detalle : "Error interno guardando la alerta" },
      { status: detalle && detalle.startsWith("Ningún destinatario") ? 400 : 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { tenantId, id, isEnabled } = body || {};
    if (!tenantId || !id) return NextResponse.json({ error: "Faltan tenantId o id" }, { status: 400 });

    if (isDemo(tenantId, new URL(request.url).searchParams)) {
      return NextResponse.json({ success: true, mock: true });
    }

    await requireTenantRole(request, tenantId, ["Owner", "Admin"]);
    await requireTenantTier(request, tenantId, "Business");

    await toggleAlertRule(tenantId, String(id), isEnabled !== false);
    return NextResponse.json({ success: true, message: isEnabled !== false ? "Alerta habilitada." : "Alerta deshabilitada." });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Credentials] PATCH error:", errorMessage(error));
    return NextResponse.json({ error: "Error interno actualizando la alerta" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const id = searchParams.get("id");
    if (!tenantId || !id) return NextResponse.json({ error: "Faltan tenantId o id" }, { status: 400 });

    if (isDemo(tenantId, searchParams)) {
      return NextResponse.json({ success: true, mock: true });
    }

    await requireTenantRole(request, tenantId, ["Owner", "Admin"]);
    await requireTenantTier(request, tenantId, "Business");

    await deleteAlertRule(tenantId, id);
    return NextResponse.json({ success: true, message: "Alerta eliminada." });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Credentials] DELETE error:", errorMessage(error));
    return NextResponse.json({ error: "Error interno eliminando la alerta" }, { status: 500 });
  }
}
