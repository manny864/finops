/**
 * Tipos TypeScript para el motor de impersonación segura de sesiones SuperAdmin.
 */

export interface ImpersonationSessionData {
  isImpersonating: boolean;
  originalAdminUserId: string;
  originalAdminEmail: string;
  targetTenantId: string;
  targetTenantName: string;
  startedAtIso: string;
  role?: string;
}

export interface StartImpersonationPayload {
  targetTenantId: string;
}

export interface ImpersonationResponse {
  success: boolean;
  redirectUrl: string;
  message: string;
  session?: ImpersonationSessionData;
}

export interface ImpersonationStatusResponse {
  success: boolean;
  isImpersonating: boolean;
  session?: ImpersonationSessionData | null;
}
