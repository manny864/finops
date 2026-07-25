import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import rateLimiter from "@/lib/rateLimiter";
import {
    buildAppUrl,
    consumeAuthToken,
    createAuthToken,
    hashPassword,
    normalizeEmail,
    validatePasswordPolicy,
} from "@/lib/localAuth";
import { isLocalAuthConfigured } from "@/lib/localToken";
import { sendEmailAsync, getPasswordResetEmailHtml } from "@/lib/emailHelper";

/**
 * POST = pedir el link de reset.  PUT = canjearlo por una contraseña nueva.
 */

function clientIp(request: NextRequest): string {
    return request.headers.get("x-forwarded-for")?.split(",")[0].trim()
        || request.headers.get("x-real-ip")
        || "unknown";
}

export async function POST(request: NextRequest) {
    if (!isLocalAuthConfigured()) {
        return NextResponse.json({ error: "No habilitado." }, { status: 503 });
    }

    const limit = await rateLimiter.checkByKeyDistributed(`pwreset-req:${clientIp(request)}`, 5, 60 * 60 * 1000);
    if (!limit.allowed) {
        return NextResponse.json({ error: "Demasiados intentos." }, { status: 429 });
    }

    let body: Record<string, unknown> = {};
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Body inválido." }, { status: 400 });
    }
    const email = normalizeEmail(String(body.email || ""));

    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.query(
            "SELECT tenant_id FROM Users WHERE email = ? AND password_hash IS NOT NULL LIMIT 1",
            [email]
        );
        const user = Array.isArray(rows) && rows.length > 0 ? (rows[0] as { tenant_id: string }) : null;

        if (user) {
            await connection.beginTransaction();
            const token = await createAuthToken(connection, user.tenant_id, email, "password_reset");
            await connection.commit();

            const resetUrl = buildAppUrl(`/reset-password?token=${encodeURIComponent(token)}`);
            sendEmailAsync("Restablecer tu contraseña — CSCloudSolutions", getPasswordResetEmailHtml(resetUrl), email);
        }

        // Respuesta idéntica exista o no la cuenta: este endpoint es anónimo,
        // y distinguir los dos casos lo convierte en un verificador gratuito
        // de qué emails están registrados en la plataforma.
        return NextResponse.json({ ok: true });
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.error("[auth/local/password-reset:request]", error);
        return NextResponse.json({ ok: true });
    } finally {
        connection.release();
    }
}

export async function PUT(request: NextRequest) {
    if (!isLocalAuthConfigured()) {
        return NextResponse.json({ error: "No habilitado." }, { status: 503 });
    }

    const limit = await rateLimiter.checkByKeyDistributed(`pwreset-confirm:${clientIp(request)}`, 20, 15 * 60 * 1000);
    if (!limit.allowed) {
        return NextResponse.json({ error: "Demasiados intentos." }, { status: 429 });
    }

    let body: Record<string, unknown> = {};
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Body inválido." }, { status: 400 });
    }

    const password = String(body.password || "");
    const passwordError = validatePasswordPolicy(password);
    if (passwordError) {
        return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const consumed = await consumeAuthToken(connection, "password_reset", String(body.token || ""));
        if (!consumed) {
            await connection.rollback();
            return NextResponse.json({ error: "El link es inválido o venció." }, { status: 400 });
        }

        // Se marca el email como verificado de paso: quien probó control del
        // buzón para resetear ya demostró lo mismo que pide la verificación.
        // Sin esto, un usuario que nunca confirmó y usa "olvidé mi contraseña"
        // queda con la contraseña nueva pero sin poder entrar.
        await connection.query(
            `UPDATE Users
                SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, NOW())
              WHERE tenant_id = ? AND email = ? AND password_hash IS NOT NULL`,
            [await hashPassword(password), consumed.tenantId, consumed.email]
        );

        await connection.commit();
        return NextResponse.json({ ok: true });
    } catch (error) {
        await connection.rollback();
        console.error("[auth/local/password-reset:confirm]", error);
        return NextResponse.json({ error: "No se pudo restablecer la contraseña." }, { status: 500 });
    } finally {
        connection.release();
    }
}
