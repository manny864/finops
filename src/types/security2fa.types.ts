/**
 * Contrato del submódulo "Seguridad (2FA)".
 *
 * Cubre el segundo factor de la **cuenta en esta plataforma**, no el del
 * directorio del cliente. El registro de MFA en Entra ID es otro dato y vive en
 * `Users.entra_mfa_registered` (ver `tenantUsers.types.ts`): un usuario puede
 * tener 2FA en Entra ID y no acá, o al revés.
 */

export type TwoFactorMethod = "TOTP" | "FIDO2_WEBAUTHN" | "RECOVERY_CODE";

/** Eventos que se registran en `AuthAuditLogs`. */
export type AuthEventType =
    | "MFA_ENROLLED"
    | "MFA_DISABLED"
    | "LOGIN_2FA_SUCCESS"
    | "LOGIN_2FA_FAILED"
    | "LOGIN_RECOVERY_CODE_USED"
    | "RECOVERY_CODES_REGENERATED"
    | "SECURITY_KEY_REGISTERED"
    | "SECURITY_KEY_REMOVED"
    | "SECURITY_KEY_USED";

export interface RegisteredSecurityKey {
    id: string;
    friendlyName: string;
    deviceType?: string;
    isBackedUp: boolean;
    lastUsedAt?: string;
    createdAt: string;
}

export interface TwoFactorStatus {
    isEnabled: boolean;
    /**
     * Método con el que el usuario se autentica habitualmente. Una llave
     * registrada gana sobre TOTP: es el factor más fuerte disponible.
     */
    primaryMethod: TwoFactorMethod;
    lastUsedAt?: string;
    remainingRecoveryCodesCount: number;
    registeredSecurityKeysCount: number;
    securityKeys: RegisteredSecurityKey[];
}

export interface SecurityAuditEvent {
    id: string;
    eventType: AuthEventType | string;
    methodUsed?: TwoFactorMethod;
    ipAddress: string;
    userAgent: string;
    /** Navegador y sistema derivados del user agent, para leer la tabla de un vistazo. */
    deviceLabel: string;
    detail?: string;
    timestamp: string;
    isSuccess: boolean;
}

export interface Security2faPayload {
    status: TwoFactorStatus;
    events: SecurityAuditEvent[];
    source: "live" | "mock";
    mock?: boolean;
    lastUpdated: string;
}

/** Cantidad de códigos que se emite por paquete. */
export const RECOVERY_CODES_PER_BATCH = 10;

/** Umbral para avisar que hay que regenerar el paquete. */
export const RECOVERY_CODES_LOW_THRESHOLD = 3;
