/**
 * Servicio del Motor de Impersonación Segura de Sesiones SuperAdmin.
 *
 * Administra el ciclo de vida de sesiones delegadas:
 *  - Generación e intercambio seguro de cookie HTTP-only (`saas_impersonation_session`).
 *  - Registro de auditoría con flag `isImpersonated: true` y trazabilidad del SuperAdmin origen.
 *  - Lectura y validación de estado de sesión.
 *  - Reversión inmediata y segura a la sesión original.
 */

import pool, { initializeDatabase } from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import type {
  ImpersonationSessionData,
  ImpersonationResponse,
  ImpersonationStatusResponse,
} from "@/types/sessionImpersonation.types";

export const IMPERSONATION_COOKIE_NAME = "saas_impersonation_session";

export interface CookieOptions {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  path: string;
  maxAge: number; // 4 hours in seconds
}

export function getImpersonationCookieOptions(value: string): CookieOptions {
  return {
    name: IMPERSONATION_COOKIE_NAME,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 4 * 60 * 60, // 4 horas
  };
}

export function encodeSessionData(data: ImpersonationSessionData): string {
  const json = JSON.stringify(data);
  return Buffer.from(json, "utf-8").toString("base64url");
}

export function decodeSessionData(rawCookie: string | null | undefined): ImpersonationSessionData | null {
  if (!rawCookie || typeof rawCookie !== "string") return null;
  try {
    const json = Buffer.from(rawCookie, "base64url").toString("utf-8");
    const parsed = JSON.parse(json);
    if (parsed && parsed.isImpersonating && parsed.targetTenantId) {
      return parsed as ImpersonationSessionData;
    }
  } catch {
    try {
      // Fallback a JSON plano si viniera sin base64url
      const parsed = JSON.parse(decodeURIComponent(rawCookie));
      if (parsed && parsed.isImpersonating && parsed.targetTenantId) {
        return parsed as ImpersonationSessionData;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Inicia una sesión de impersonación para un SuperAdmin dentro de un tenant objetivo.
 */
export async function startImpersonation(params: {
  originalAdminUserId: string;
  originalAdminEmail: string;
  targetTenantId: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{
  response: ImpersonationResponse;
  cookieOptions: CookieOptions;
}> {
  const { originalAdminUserId, originalAdminEmail, targetTenantId, ipAddress, userAgent } = params;

  await initializeDatabase();

  let targetTenantName = targetTenantId;

  // 1. Obtener nombre del Tenant
  if (isMockTenant(targetTenantId)) {
    targetTenantName = `Demo Tenant (${targetTenantId})`;
  } else {
    try {
      const [rows]: any = await pool.query(
        "SELECT name, company_name FROM Tenants WHERE tenant_id = ? LIMIT 1",
        [targetTenantId]
      );
      if (Array.isArray(rows) && rows.length > 0) {
        targetTenantName = rows[0]?.company_name || rows[0]?.name || targetTenantId;
      }
    } catch (e) {
      console.warn(`[sessionImpersonation] No se pudo leer el nombre del tenant ${targetTenantId}:`, e);
    }
  }

  const sessionData: ImpersonationSessionData = {
    isImpersonating: true,
    originalAdminUserId: originalAdminUserId || "superadmin-01",
    originalAdminEmail: originalAdminEmail || "superadmin@cscloudsolutions.com",
    targetTenantId,
    targetTenantName,
    startedAtIso: new Date().toISOString(),
    role: "TENANT_ADMIN",
  };

  // 2. Registrar en la tabla de Auditoría
  try {
    await pool.query(
      `INSERT INTO AuditTrailLogs 
        (tenant_id, user_email, user_name, ip_address, user_agent, action_type, resource_target_id, resource_target_name, status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, 'SUPERADMIN_IMPERSONATION_STARTED', ?, ?, 'SUCCESS', ?, NOW())`,
      [
        targetTenantId,
        originalAdminEmail,
        "SuperAdmin Operator",
        ipAddress || "127.0.0.1",
        userAgent || "CSCloudSolutions Platform Impersonator",
        targetTenantId,
        targetTenantName,
        JSON.stringify({
          isImpersonated: true,
          executedBySuperAdmin: originalAdminEmail,
          targetTenantId,
          startedAt: sessionData.startedAtIso,
        }),
      ]
    );
  } catch (err) {
    // Si AuditTrailLogs aún no tiene todas las columnas, registrar en Notifications o log de sistema
    console.warn("[sessionImpersonation] Error registrando audit log:", err);
  }

  const encodedCookie = encodeSessionData(sessionData);
  const cookieOptions = getImpersonationCookieOptions(encodedCookie);

  return {
    response: {
      success: true,
      redirectUrl: "/",
      message: `Modo impersonación activo. Has ingresado a ${targetTenantName} como Administrador.`,
      session: sessionData,
    },
    cookieOptions,
  };
}

/**
 * Finaliza la sesión de impersonación actual y registra el evento de salida.
 */
export async function stopImpersonation(params: {
  currentSession?: ImpersonationSessionData | null;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{
  response: ImpersonationResponse;
  clearCookieOptions: CookieOptions;
}> {
  const { currentSession, ipAddress, userAgent } = params;

  if (currentSession) {
    try {
      await initializeDatabase();
      await pool.query(
        `INSERT INTO AuditTrailLogs 
          (tenant_id, user_email, user_name, ip_address, user_agent, action_type, resource_target_id, resource_target_name, status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, 'SUPERADMIN_IMPERSONATION_STOPPED', ?, ?, 'SUCCESS', ?, NOW())`,
        [
          currentSession.targetTenantId,
          currentSession.originalAdminEmail,
          "SuperAdmin Operator",
          ipAddress || "127.0.0.1",
          userAgent || "CSCloudSolutions Platform Impersonator",
          currentSession.targetTenantId,
          currentSession.targetTenantName,
          JSON.stringify({
            isImpersonated: false,
            executedBySuperAdmin: currentSession.originalAdminEmail,
            endedAt: new Date().toISOString(),
          }),
        ]
      );
    } catch (err) {
      console.warn("[sessionImpersonation] Error registrando fin de impersonación:", err);
    }
  }

  const clearCookieOptions: CookieOptions = {
    name: IMPERSONATION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0, // Inmediatamente expirada
  };

  return {
    response: {
      success: true,
      redirectUrl: "/superadmin/tenants",
      message: "Sesión de impersonación finalizada. Has regresado al panel de SuperAdmin.",
    },
    clearCookieOptions,
  };
}

/**
 * Consulta el estado actual de la sesión de impersonación.
 */
export function getImpersonationStatus(cookieValue: string | null | undefined): ImpersonationStatusResponse {
  const session = decodeSessionData(cookieValue);
  return {
    success: true,
    isImpersonating: Boolean(session && session.isImpersonating),
    session: session || null,
  };
}
