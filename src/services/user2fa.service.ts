/**
 * Seguridad (2FA) — capa de dominio.
 *
 * Normaliza las filas de `AuthAuditLogs` y `UserWebAuthnCredentials` al
 * contrato de `types/security2fa.types.ts`, y deriva el estado del segundo
 * factor de la cuenta.
 *
 * Funciones puras sobre filas ya leídas: el SQL y la validación de identidad
 * viven en las rutas. Así el parseo de user agent y la elección de método
 * primario se testean sin base de datos.
 */

import {
    RECOVERY_CODES_LOW_THRESHOLD,
    type AuthEventType,
    type RegisteredSecurityKey,
    type SecurityAuditEvent,
    type TwoFactorMethod,
    type TwoFactorStatus,
} from "@/types/security2fa.types";

// ─────────────────────────────────────────────────────────────────────────────
// Normalización
// ─────────────────────────────────────────────────────────────────────────────

const METHODS: TwoFactorMethod[] = ["TOTP", "FIDO2_WEBAUTHN", "RECOVERY_CODE"];

export function toMethod(raw: unknown): TwoFactorMethod | undefined {
    const s = String(raw || "").toUpperCase();
    return METHODS.includes(s as TwoFactorMethod) ? (s as TwoFactorMethod) : undefined;
}

function iso(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    const d = new Date(String(value || ""));
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/**
 * Etiqueta legible de navegador y sistema a partir del user agent.
 *
 * Deliberadamente burda: alcanza para que alguien reconozca "esta sesión fui
 * yo" en la bitácora. No se usa para decidir nada — el user agent lo controla
 * el cliente y se puede falsear, así que nunca es una señal de seguridad.
 */
export function deviceLabelFromUserAgent(ua: unknown): string {
    const s = String(ua || "");
    if (!s) return "Desconocido";

    const browser =
        /Edg\//.test(s) ? "Edge"
            : /OPR\/|Opera/.test(s) ? "Opera"
                : /Firefox\//.test(s) ? "Firefox"
                    : /Chrome\//.test(s) ? "Chrome"
                        // Safari se detecta último: Chrome y Edge también dicen "Safari".
                        : /Safari\//.test(s) ? "Safari"
                            : "Navegador";

    const os =
        /Windows NT/.test(s) ? "Windows"
            : /iPhone|iPad/.test(s) ? "iOS"
                // "Mac OS X" aparece en iOS también, así que va después.
                : /Mac OS X|Macintosh/.test(s) ? "macOS"
                    : /Android/.test(s) ? "Android"
                        : /Linux/.test(s) ? "Linux"
                            : "";

    return os ? `${browser} · ${os}` : browser;
}

export interface RawAuthAuditRow {
    id?: unknown;
    event_type?: unknown;
    method_used?: unknown;
    is_success?: unknown;
    ip_address?: unknown;
    user_agent?: unknown;
    detail?: unknown;
    created_at?: unknown;
}

export function mapAuditEvent(row: RawAuthAuditRow): SecurityAuditEvent {
    return {
        id: String(row.id ?? ""),
        eventType: String(row.event_type || "UNKNOWN"),
        methodUsed: toMethod(row.method_used),
        ipAddress: String(row.ip_address || "—"),
        userAgent: String(row.user_agent || ""),
        deviceLabel: deviceLabelFromUserAgent(row.user_agent),
        detail: row.detail ? String(row.detail) : undefined,
        timestamp: iso(row.created_at),
        isSuccess: Boolean(Number(row.is_success ?? 1)),
    };
}

export interface RawWebAuthnRow {
    id?: unknown;
    friendly_name?: unknown;
    device_type?: unknown;
    is_backed_up?: unknown;
    last_used_at?: unknown;
    created_at?: unknown;
}

export function mapSecurityKey(row: RawWebAuthnRow): RegisteredSecurityKey {
    return {
        id: String(row.id ?? ""),
        friendlyName: String(row.friendly_name || "").trim() || "Llave de seguridad",
        deviceType: row.device_type ? String(row.device_type) : undefined,
        isBackedUp: Boolean(Number(row.is_backed_up || 0)),
        lastUsedAt: row.last_used_at ? iso(row.last_used_at) : undefined,
        createdAt: iso(row.created_at),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado del segundo factor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Método primario: una llave física registrada gana sobre TOTP porque es el
 * factor más resistente a phishing de los dos. Si no hay ninguno de los dos y
 * el 2FA está activo, sólo quedan códigos de recuperación.
 */
export function derivePrimaryMethod(hasTotp: boolean, securityKeysCount: number): TwoFactorMethod {
    if (securityKeysCount > 0) return "FIDO2_WEBAUTHN";
    if (hasTotp) return "TOTP";
    return "RECOVERY_CODE";
}

export function buildTwoFactorStatus(input: {
    isEnabled: boolean;
    hasTotpSecret: boolean;
    lastUsedAt?: unknown;
    remainingRecoveryCodesCount: number;
    securityKeys: RegisteredSecurityKey[];
}): TwoFactorStatus {
    return {
        isEnabled: input.isEnabled,
        primaryMethod: derivePrimaryMethod(input.hasTotpSecret, input.securityKeys.length),
        lastUsedAt: input.lastUsedAt ? iso(input.lastUsedAt) : undefined,
        remainingRecoveryCodesCount: Math.max(0, input.remainingRecoveryCodesCount),
        registeredSecurityKeysCount: input.securityKeys.length,
        securityKeys: input.securityKeys,
    };
}

/**
 * Cuenta los códigos que quedan a partir del JSON de hashes.
 *
 * Los hashes se consumen de a uno (`verifyRecoveryCode` devuelve el resto), así
 * que la longitud del array **es** la cantidad restante.
 */
export function countRemainingRecoveryCodes(raw: unknown): number {
    let arr: unknown = raw;
    if (typeof raw === "string") {
        try {
            arr = JSON.parse(raw);
        } catch {
            return 0;
        }
    }
    return Array.isArray(arr) ? arr.length : 0;
}

/** ¿Hay que avisar que regenere el paquete? Cero es el caso urgente. */
export function needsRecoveryCodesRefresh(remaining: number): boolean {
    return remaining <= RECOVERY_CODES_LOW_THRESHOLD;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bitácora
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IP del cliente detrás del ingress de Container Apps.
 *
 * `x-forwarded-for` puede traer una cadena de proxies; el primero es el
 * cliente real. Se acota a 64 caracteres porque es lo que admite la columna y
 * porque un header arbitrariamente largo es entrada no confiable.
 */
export function clientIpFromHeaders(headers: Headers): string {
    const xff = headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim().slice(0, 64);
    return (headers.get("x-real-ip") || headers.get("cf-connecting-ip") || "").slice(0, 64);
}

export function userAgentFromHeaders(headers: Headers): string {
    return (headers.get("user-agent") || "").slice(0, 400);
}

/** Eventos que la UI marca como fallidos aunque `is_success` venga en 1. */
export const FAILURE_EVENTS: AuthEventType[] = ["LOGIN_2FA_FAILED"];

export function isFailureEvent(eventType: string, isSuccess: boolean): boolean {
    return !isSuccess || FAILURE_EVENTS.includes(eventType as AuthEventType);
}
