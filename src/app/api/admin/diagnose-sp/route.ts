import { NextRequest, NextResponse } from "next/server";
import { ClientSecretCredential } from "@azure/identity";
import { AuthError, requireRequestIdentity, requireTenantRole } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { listTenantSubscriptions } from "@/lib/azure";
import rateLimiter from "@/lib/rateLimiter";

/**
 * Valida las credenciales de un Service Principal (client ID + tenant ID + VALOR del secreto) contra
 * Microsoft Entra y Azure Resource Manager. Es lo que llama el paso 2 del asistente de onboarding.
 *
 * Esta ruta no existía: el asistente la llamaba, recibía un 404 con cuerpo HTML, `response.json()` lanzaba y el
 * formulario no mostraba nada ("no valida"). La documentación decía que ya existía y nadie lo comprobó.
 *
 * No guarda nada: sólo prueba la credencial. Guardarla es `PUT /api/tenants`, que ya hace la escritura al Key Vault.
 *
 * Cada fallo devuelve un `code` estable y un `error` en español de respaldo; la interfaz traduce por `code`.
 * Los fallos de Entra se distinguen por su código AADSTS (verificados en
 * https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes). El que más se ve es 7000215:
 * pegar el ID del secreto (un GUID) en lugar de su valor, que sólo se muestra una vez al crearlo.
 *
 * Seguridad: exige Admin/Owner del tenant sobre el que se actúa (como `PUT /api/tenants`), limita 10 intentos por
 * minuto y usuario porque cada intento es un pedido de token contra Entra con un secreto que manda el cliente, y
 * NUNCA registra ni devuelve el secreto (ni el mensaje crudo del SDK, que trae trace IDs y el ID de la aplicación).
 */

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 20_000;
const MAX_SECRETO = 256;

export type CodigoDiagnosticoSp =
  | "INVALID_INPUT"
  | "SECRET_ID_NOT_VALUE"
  | "INVALID_SECRET"
  | "SECRET_EXPIRED"
  | "APP_NOT_FOUND"
  | "TENANT_NOT_FOUND"
  | "APP_DISABLED"
  | "AUTH_FAILED"
  | "ACCESS_DENIED"
  | "NO_SUBSCRIPTIONS"
  | "NETWORK"
  | "RATE_LIMITED";

const MENSAJES: Record<CodigoDiagnosticoSp, string> = {
  INVALID_INPUT: "Completá Client ID, Tenant ID y el valor del secreto. Los dos primeros son GUIDs (XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX).",
  SECRET_ID_NOT_VALUE:
    "Lo que pegaste como secreto es el ID del secreto (un GUID), no su valor. En Entra, Certificados y secretos, el valor sólo se ve al crearlo: si no lo copiaste, creá uno nuevo.",
  INVALID_SECRET: "Entra rechazó el secreto. Revisá que sea el VALOR del secreto (no su ID) y que pertenezca a esta aplicación.",
  SECRET_EXPIRED: "El secreto está vencido. Creá uno nuevo en Entra (Certificados y secretos) y pegá su valor.",
  APP_NOT_FOUND: "No existe una aplicación con ese Client ID en ese directorio. Revisá el Client ID y el Tenant ID.",
  TENANT_NOT_FOUND: "Entra no encontró ese Tenant ID. Revisá que sea el ID del directorio donde está registrada la aplicación.",
  APP_DISABLED: "La aplicación está deshabilitada en Entra.",
  AUTH_FAILED: "Entra rechazó la autenticación del Service Principal.",
  ACCESS_DENIED: "Las credenciales son válidas pero Azure respondió acceso denegado al listar las suscripciones. Asigná al Service Principal el rol Reader.",
  NO_SUBSCRIPTIONS:
    "Las credenciales son válidas pero el Service Principal no ve ninguna suscripción. Asignale el rol Reader en las suscripciones que querés monitorear.",
  NETWORK: "No se pudo completar la consulta a Microsoft. Reintentá en unos minutos.",
  RATE_LIMITED: "Demasiados intentos. Esperá un minuto y reintentá.",
};

/** Códigos AADSTS que tienen una causa que el usuario puede corregir. Cualquier otro cae en AUTH_FAILED. */
const POR_AADSTS: Record<string, CodigoDiagnosticoSp> = {
  "7000215": "INVALID_SECRET",
  "7000222": "SECRET_EXPIRED",
  "700016": "APP_NOT_FOUND",
  "90002": "TENANT_NOT_FOUND",
  "7000112": "APP_DISABLED",
};

/** Pegar comillas o espacios al copiar es común (el mismo saneo que usa `PUT /api/tenants`). */
const limpiar = (v: unknown): string => (typeof v === "string" ? v.trim().replace(/^["']+|["']+$/g, "") : "");

function falla(code: CodigoDiagnosticoSp, status = 200, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, code, error: MENSAJES[code], ...extra }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const identity = await requireRequestIdentity(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // El RBAC va sobre el tenant en el que se está actuando (el seleccionado en la interfaz), no sobre el directorio del
    // Service Principal, que puede ser otro (un MSP conecta el directorio de su cliente).
    const plataforma = limpiar(body.platform_tenant_id);
    const tenantDePlataforma = GUID.test(plataforma) ? plataforma : identity.tenantId;
    await requireTenantRole(request, tenantDePlataforma, ["Admin", "Owner"]);

    const limite = await rateLimiter.checkByKeyDistributed(`diagnose-sp:${tenantDePlataforma}:${identity.email}`, 10, 60_000);
    if (!limite.allowed) return falla("RATE_LIMITED", 429);

    const clientId = limpiar(body.client_id);
    const tenantId = limpiar(body.tenant_id);
    const secreto = limpiar(body.client_secret);
    if (!GUID.test(clientId) || !GUID.test(tenantId) || !secreto || secreto.length > MAX_SECRETO) return falla("INVALID_INPUT", 400);
    // Sin ir a Entra: un GUID como secreto es el ID del secreto, y Entra contesta 7000215 igual.
    if (GUID.test(secreto)) return falla("SECRET_ID_NOT_VALUE", 400);

    const credencial = new ClientSecretCredential(tenantId, clientId, secreto);
    try {
      await credencial.getToken("https://management.azure.com/.default", { abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      const aadsts = /AADSTS(\d+)/.exec(errorMessage(e))?.[1];
      const code: CodigoDiagnosticoSp = aadsts ? (POR_AADSTS[aadsts] ?? "AUTH_FAILED") : "NETWORK";
      console.warn(`[diagnose-sp] ${code}${aadsts ? ` AADSTS${aadsts}` : ""} tenant=${tenantId.slice(0, 8)}`);
      return falla(code, 200, aadsts ? { aadsts } : {});
    }

    let suscripciones;
    try {
      suscripciones = await listTenantSubscriptions(tenantId, credencial, AbortSignal.timeout(TIMEOUT_MS));
    } catch (e) {
      const code: CodigoDiagnosticoSp = errorStatus(e) === 401 || errorStatus(e) === 403 ? "ACCESS_DENIED" : "NETWORK";
      console.warn(`[diagnose-sp] ${code} al listar suscripciones tenant=${tenantId.slice(0, 8)}`);
      return falla(code);
    }
    if (suscripciones.length === 0) return falla("NO_SUBSCRIPTIONS");

    return NextResponse.json({
      success: true,
      subscriptions: suscripciones.length,
      names: suscripciones.slice(0, 5).map((s) => s.displayName ?? s.subscriptionId),
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ success: false, error: errorMessage(e) }, { status: errorStatus(e) ?? 403 });
    console.error("[diagnose-sp] error:", errorMessage(e));
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 });
  }
}
