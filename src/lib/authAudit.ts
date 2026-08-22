/**
 * Escritura de la bitácora de autenticación (`AuthAuditLogs`).
 *
 * Vive aparte del servicio de dominio porque sí toca la base: la llaman las
 * rutas de MFA cada vez que pasa algo relevante (enrolamiento, verificación,
 * uso de un código de recuperación, alta o baja de una llave).
 *
 * **Nunca lanza.** Un fallo al auditar no puede voltear la operación que se
 * estaba auditando: si el INSERT falla, se registra en consola y la
 * autenticación sigue. Perder una línea de bitácora es malo; dejar a alguien
 * afuera de su cuenta por eso es peor.
 */

import pool from "@/modules/storage/db";
import { clientIpFromHeaders, userAgentFromHeaders } from "@/services/user2fa.service";
import type { AuthEventType, TwoFactorMethod } from "@/types/security2fa.types";

export async function recordAuthEvent(input: {
    tenantId: string;
    userEmail: string;
    eventType: AuthEventType;
    methodUsed?: TwoFactorMethod;
    isSuccess?: boolean;
    headers?: Headers;
    detail?: string;
}): Promise<void> {
    try {
        await pool.query(
            `INSERT INTO AuthAuditLogs
                (tenant_id, user_email, event_type, method_used, is_success, ip_address, user_agent, detail)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                input.tenantId,
                input.userEmail,
                input.eventType,
                input.methodUsed || null,
                input.isSuccess === false ? 0 : 1,
                input.headers ? clientIpFromHeaders(input.headers) : null,
                input.headers ? userAgentFromHeaders(input.headers) : null,
                input.detail ? input.detail.slice(0, 255) : null,
            ]
        );
    } catch (e) {
        console.warn("[authAudit] no se pudo registrar el evento:", e instanceof Error ? e.message : e);
    }
}
