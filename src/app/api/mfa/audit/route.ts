/**
 * GET /api/mfa/audit
 *
 * Bitácora de eventos de autenticación del usuario autenticado, junto con el
 * estado completo de su segundo factor (TOTP, códigos restantes, llaves
 * registradas).
 *
 * RBAC: `requireRequestIdentity`. Cada usuario ve **su propia** bitácora y
 * nada más: el filtro es por `user_email` + `tenant_id` de la identidad del
 * token, nunca por un parámetro del cliente. No hay vista de "la bitácora de
 * otro usuario" — eso sería otra feature con otro guard.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRequestIdentity, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";
import {
    buildTwoFactorStatus,
    countRemainingRecoveryCodes,
    mapAuditEvent,
    mapSecurityKey,
    type RawAuthAuditRow,
    type RawWebAuthnRow,
} from "@/services/user2fa.service";
import type { Security2faPayload } from "@/types/security2fa.types";

/** Bitácora sintética para el tenant de demostración. */
function mockPayload(): Security2faPayload {
    const now = Date.now();
    const at = (minutesAgo: number) => new Date(now - minutesAgo * 60000).toISOString();
    return {
        status: {
            isEnabled: true,
            primaryMethod: "TOTP",
            lastUsedAt: at(38),
            remainingRecoveryCodesCount: 2,
            registeredSecurityKeysCount: 1,
            securityKeys: [
                { id: "demo-1", friendlyName: "YubiKey 5C (demo)", deviceType: "singleDevice", isBackedUp: false, lastUsedAt: at(1440), createdAt: at(43200) },
            ],
        },
        events: [
            { id: "1", eventType: "LOGIN_2FA_SUCCESS", methodUsed: "TOTP", ipAddress: "190.55.12.4", userAgent: "Mozilla/5.0 (Macintosh) Chrome/140", deviceLabel: "Chrome · macOS", timestamp: at(38), isSuccess: true },
            { id: "2", eventType: "LOGIN_2FA_FAILED", methodUsed: "TOTP", ipAddress: "190.55.12.4", userAgent: "Mozilla/5.0 (Macintosh) Chrome/140", deviceLabel: "Chrome · macOS", timestamp: at(41), isSuccess: false, detail: "Código incorrecto" },
            { id: "3", eventType: "SECURITY_KEY_USED", methodUsed: "FIDO2_WEBAUTHN", ipAddress: "190.55.12.4", userAgent: "Mozilla/5.0 (Windows NT) Edg/140", deviceLabel: "Edge · Windows", timestamp: at(1440), isSuccess: true },
            { id: "4", eventType: "LOGIN_RECOVERY_CODE_USED", methodUsed: "RECOVERY_CODE", ipAddress: "201.231.88.9", userAgent: "Mozilla/5.0 (iPhone) Safari/605", deviceLabel: "Safari · iOS", timestamp: at(11520), isSuccess: true, detail: "Quedan 2 códigos" },
            { id: "5", eventType: "MFA_ENROLLED", methodUsed: "TOTP", ipAddress: "190.55.12.4", userAgent: "Mozilla/5.0 (Macintosh) Chrome/139", deviceLabel: "Chrome · macOS", timestamp: at(43200), isSuccess: true },
        ],
        source: "mock",
        mock: true,
        lastUpdated: new Date().toISOString(),
    };
}

export async function GET(request: NextRequest) {
    try {
        const { email, tenantId } = await requireRequestIdentity(request);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(mockPayload());
        }

        const [userRows]: any = await pool.query(
            `SELECT mfa_enabled, mfa_secret_encrypted, mfa_last_used_at, mfa_recovery_codes_hash
               FROM Users WHERE email = ? AND tenant_id = ?`,
            [email, tenantId]
        );
        const u = userRows?.[0] || {};

        const [keyRows]: any = await pool.query(
            `SELECT id, friendly_name, device_type, is_backed_up, last_used_at, created_at
               FROM UserWebAuthnCredentials
              WHERE tenant_id = ? AND user_email = ?
              ORDER BY created_at DESC`,
            [tenantId, email]
        );

        const [eventRows]: any = await pool.query(
            `SELECT id, event_type, method_used, is_success, ip_address, user_agent, detail, created_at
               FROM AuthAuditLogs
              WHERE tenant_id = ? AND user_email = ?
              ORDER BY created_at DESC
              LIMIT 300`,
            [tenantId, email]
        );

        const payload: Security2faPayload = {
            status: buildTwoFactorStatus({
                isEnabled: Boolean(u.mfa_enabled),
                hasTotpSecret: Boolean(u.mfa_secret_encrypted),
                lastUsedAt: u.mfa_last_used_at,
                remainingRecoveryCodesCount: countRemainingRecoveryCodes(u.mfa_recovery_codes_hash),
                securityKeys: (keyRows as RawWebAuthnRow[]).map(mapSecurityKey),
            }),
            events: (eventRows as RawAuthAuditRow[]).map(mapAuditEvent),
            source: "live",
            lastUpdated: new Date().toISOString(),
        };
        return NextResponse.json(payload);
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        const msg = errorMessage(error);
        console.error("[API mfa/audit]", msg);
        return NextResponse.json({ error: msg || "No se pudo leer la bitácora de seguridad." }, { status: 500 });
    }
}
