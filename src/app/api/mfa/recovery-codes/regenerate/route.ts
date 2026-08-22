/**
 * POST /api/mfa/recovery-codes/regenerate
 *
 * Emite un paquete nuevo de códigos de recuperación e **invalida el anterior**.
 * Los códigos viajan en texto plano una única vez en esta respuesta: se guardan
 * hasheados y no hay forma de volver a mostrarlos.
 *
 * RBAC: `requireRequestIdentity`. Además exige un TOTP válido: regenerar
 * códigos es equivalente a crear llaves maestras de la cuenta, así que una
 * sesión secuestrada no debería poder hacerlo sin el segundo factor.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRequestIdentity, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { verifyToken } from "@/lib/mfa";
import { decryptSecret, generateRecoveryCodes } from "@/lib/mfaCrypto";
import { recordAuthEvent } from "@/lib/authAudit";
import { errorMessage } from "@/lib/apiErrors";
import rateLimiter from "@/lib/rateLimiter";

export async function POST(request: NextRequest) {
    try {
        const { email, tenantId } = await requireRequestIdentity(request);
        const body = await request.json().catch(() => ({}));
        const token = typeof body.token === "string" ? body.token.trim() : "";

        // Un atacante con la sesión abierta no puede iterar códigos TOTP a
        // ciegas: 5 intentos por hora y usuario.
        const rl = await rateLimiter.checkByKeyDistributed(`mfa-regen:${tenantId}:${email}`, 5, 60 * 60 * 1000);
        if (!rl.allowed) {
            return NextResponse.json({ error: "Demasiados intentos. Probá de nuevo más tarde." }, { status: 429 });
        }

        const [rows]: any = await pool.query(
            `SELECT mfa_enabled, mfa_secret_encrypted FROM Users WHERE email = ? AND tenant_id = ?`,
            [email, tenantId]
        );
        const u = rows?.[0];
        if (!u || !u.mfa_enabled) {
            return NextResponse.json({ error: "El 2FA no está habilitado en esta cuenta." }, { status: 409 });
        }
        if (!u.mfa_secret_encrypted) {
            return NextResponse.json({ error: "No hay un secreto TOTP registrado." }, { status: 409 });
        }

        const enc = JSON.parse(u.mfa_secret_encrypted);
        const secret = decryptSecret(enc.ciphertext, enc.iv, enc.authTag);
        if (!(await verifyToken(secret, token))) {
            await recordAuthEvent({
                tenantId,
                userEmail: email,
                eventType: "LOGIN_2FA_FAILED",
                methodUsed: "TOTP",
                isSuccess: false,
                headers: request.headers,
                detail: "Regeneración de códigos rechazada",
            });
            return NextResponse.json({ error: "Código incorrecto." }, { status: 401 });
        }

        const { plaintext, hashes } = await generateRecoveryCodes();
        await pool.query(`UPDATE Users SET mfa_recovery_codes_hash = ? WHERE email = ? AND tenant_id = ?`, [
            JSON.stringify(hashes),
            email,
            tenantId,
        ]);

        await recordAuthEvent({
            tenantId,
            userEmail: email,
            eventType: "RECOVERY_CODES_REGENERATED",
            methodUsed: "RECOVERY_CODE",
            headers: request.headers,
            detail: `${plaintext.length} códigos emitidos; el paquete anterior quedó inválido`,
        });

        return NextResponse.json({ success: true, recoveryCodes: plaintext });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        const msg = errorMessage(error);
        console.error("[API mfa/recovery-codes/regenerate]", msg);
        return NextResponse.json({ error: msg || "No se pudieron regenerar los códigos." }, { status: 500 });
    }
}
