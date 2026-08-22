/**
 * Registro de una llave de seguridad FIDO2 / passkey.
 *
 *  GET  → devuelve las opciones de creación de credencial (challenge incluido).
 *  POST → verifica la respuesta del autenticador y guarda la credencial.
 *
 * RBAC: `requireRequestIdentity`. La llave queda asociada al email + tenant de
 * la identidad del token; el cliente no elige de quién es la credencial.
 *
 * El challenge se guarda en la fila del usuario, no en una cookie ni se acepta
 * de vuelta del cliente: WebAuthn exige que el servidor recuerde el challenge
 * que emitió, y aceptar el que devuelve el navegador anularía la protección
 * contra replay.
 */

import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import { requireRequestIdentity, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import { recordAuthEvent } from "@/lib/authAudit";
import { CHALLENGE_TTL_SECONDS, getExpectedOrigins, getRpId, getRpName } from "@/lib/webauthnConfig";

export async function GET(request: NextRequest) {
    try {
        const { email, tenantId } = await requireRequestIdentity(request);

        const [existing]: any = await pool.query(
            `SELECT credential_id, transports FROM UserWebAuthnCredentials WHERE tenant_id = ? AND user_email = ?`,
            [tenantId, email]
        );

        const options = await generateRegistrationOptions({
            rpName: getRpName(),
            rpID: getRpId(),
            // El userID es opaco para el autenticador. Se usa el email del token,
            // no un parámetro del cliente.
            userID: new TextEncoder().encode(email),
            userName: email,
            attestationType: "none",
            // Sin esto el navegador dejaría registrar dos veces la misma llave y
            // el UNIQUE de la tabla lo rechazaría recién al guardar.
            excludeCredentials: (existing as { credential_id: string; transports: string | null }[]).map((c) => ({
                id: c.credential_id,
                transports: c.transports ? (c.transports.split(",") as never) : undefined,
            })),
            authenticatorSelection: {
                residentKey: "preferred",
                userVerification: "preferred",
            },
        });

        await pool.query(
            `UPDATE Users
                SET webauthn_challenge = ?,
                    webauthn_challenge_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND)
              WHERE email = ? AND tenant_id = ?`,
            [options.challenge, CHALLENGE_TTL_SECONDS, email, tenantId]
        );

        return NextResponse.json({ success: true, options });
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        const msg = errorMessage(error);
        console.error("[API mfa/webauthn/register GET]", msg);
        return NextResponse.json({ error: msg || "No se pudieron generar las opciones de registro." }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const { email, tenantId } = await requireRequestIdentity(request);
        const body = await request.json().catch(() => ({}));
        const friendlyName = typeof body.friendlyName === "string" ? body.friendlyName.trim().slice(0, 120) : "";

        if (!body.credential) {
            return NextResponse.json({ error: "Falta la respuesta del autenticador." }, { status: 400 });
        }

        const [rows]: any = await pool.query(
            `SELECT webauthn_challenge, webauthn_challenge_expires_at
               FROM Users WHERE email = ? AND tenant_id = ?`,
            [email, tenantId]
        );
        const stored = rows?.[0];
        if (!stored?.webauthn_challenge) {
            return NextResponse.json({ error: "No hay un registro en curso. Volvé a empezar." }, { status: 409 });
        }
        // El challenge vencido se rechaza y se limpia: reutilizarlo sería
        // exactamente el replay que la ventana corta busca evitar.
        if (stored.webauthn_challenge_expires_at && new Date(stored.webauthn_challenge_expires_at) < new Date()) {
            await pool.query(
                `UPDATE Users SET webauthn_challenge = NULL, webauthn_challenge_expires_at = NULL WHERE email = ? AND tenant_id = ?`,
                [email, tenantId]
            );
            return NextResponse.json({ error: "El registro expiró. Volvé a empezar." }, { status: 409 });
        }

        const verification = await verifyRegistrationResponse({
            response: body.credential,
            expectedChallenge: stored.webauthn_challenge,
            expectedOrigin: getExpectedOrigins(),
            expectedRPID: getRpId(),
            requireUserVerification: false,
        });

        // El challenge se consume siempre, haya verificado o no: un intento
        // fallido no puede dejarlo vivo para reintentar con otra respuesta.
        await pool.query(
            `UPDATE Users SET webauthn_challenge = NULL, webauthn_challenge_expires_at = NULL WHERE email = ? AND tenant_id = ?`,
            [email, tenantId]
        );

        if (!verification.verified || !verification.registrationInfo) {
            await recordAuthEvent({
                tenantId,
                userEmail: email,
                eventType: "SECURITY_KEY_REGISTERED",
                methodUsed: "FIDO2_WEBAUTHN",
                isSuccess: false,
                headers: request.headers,
                detail: "La verificación de la credencial falló",
            });
            return NextResponse.json({ error: "No se pudo verificar la llave de seguridad." }, { status: 400 });
        }

        const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

        await pool.query(
            `INSERT INTO UserWebAuthnCredentials
                (tenant_id, user_email, credential_id, public_key, counter, device_type, is_backed_up, transports, friendly_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tenantId,
                email,
                credential.id,
                Buffer.from(credential.publicKey).toString("base64url"),
                credential.counter,
                credentialDeviceType,
                credentialBackedUp ? 1 : 0,
                credential.transports?.join(",") || null,
                friendlyName || "Llave de seguridad",
            ]
        );

        // Registrar una llave habilita el 2FA: es un segundo factor tan válido
        // como el TOTP, y dejarlo en 0 haría que la cuenta figure sin proteger.
        await pool.query(`UPDATE Users SET mfa_enabled = TRUE WHERE email = ? AND tenant_id = ?`, [email, tenantId]);

        await recordAuthEvent({
            tenantId,
            userEmail: email,
            eventType: "SECURITY_KEY_REGISTERED",
            methodUsed: "FIDO2_WEBAUTHN",
            headers: request.headers,
            detail: friendlyName || undefined,
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        const msg = errorMessage(error);
        console.error("[API mfa/webauthn/register POST]", msg);
        return NextResponse.json({ error: msg || "No se pudo registrar la llave." }, { status: 500 });
    }
}

/** Baja de una llave registrada. */
export async function DELETE(request: NextRequest) {
    try {
        const { email, tenantId } = await requireRequestIdentity(request);
        const id = Number(new URL(request.url).searchParams.get("id"));
        if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json({ error: "ID de llave inválido." }, { status: 400 });
        }

        // El WHERE incluye tenant y email: nadie puede borrar la llave de otro
        // pasando un id ajeno.
        const [result]: any = await pool.query(
            `DELETE FROM UserWebAuthnCredentials WHERE id = ? AND tenant_id = ? AND user_email = ?`,
            [id, tenantId, email]
        );
        if (!result || result.affectedRows === 0) {
            return NextResponse.json({ error: "Llave no encontrada." }, { status: 404 });
        }

        await recordAuthEvent({
            tenantId,
            userEmail: email,
            eventType: "SECURITY_KEY_REMOVED",
            methodUsed: "FIDO2_WEBAUTHN",
            headers: request.headers,
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        const msg = errorMessage(error);
        console.error("[API mfa/webauthn/register DELETE]", msg);
        return NextResponse.json({ error: msg || "No se pudo eliminar la llave." }, { status: 500 });
    }
}
