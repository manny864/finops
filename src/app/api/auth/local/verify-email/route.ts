import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import rateLimiter from "@/lib/rateLimiter";
import { consumeAuthToken } from "@/lib/localAuth";
import { isLocalAuthConfigured } from "@/lib/localToken";

/**
 * Confirma el email de un usuario local quemando el token de un solo uso que
 * se le mandó en el signup. Hasta que esto no pasa, /auth/local/login devuelve
 * 403 — así una cuenta creada con el email de otra persona nunca es usable.
 */
export async function POST(request: NextRequest) {
    if (!isLocalAuthConfigured()) {
        return NextResponse.json({ error: "No habilitado." }, { status: 503 });
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim()
        || request.headers.get("x-real-ip")
        || "unknown";
    // El token es de 32 bytes aleatorios, no es adivinable por fuerza bruta,
    // pero el límite evita que alguien use este endpoint como oráculo barato.
    const limit = await rateLimiter.checkByKeyDistributed(`verify-email:${ip}`, 20, 15 * 60 * 1000);
    if (!limit.allowed) {
        return NextResponse.json({ error: "Demasiados intentos." }, { status: 429 });
    }

    let body: Record<string, unknown> = {};
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Body inválido." }, { status: 400 });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const consumed = await consumeAuthToken(connection, "verify_email", String(body.token || ""));
        if (!consumed) {
            await connection.rollback();
            return NextResponse.json({ error: "El link es inválido o venció." }, { status: 400 });
        }

        await connection.query(
            `UPDATE Users SET email_verified_at = NOW()
              WHERE tenant_id = ? AND email = ? AND password_hash IS NOT NULL`,
            [consumed.tenantId, consumed.email]
        );

        await connection.commit();
        return NextResponse.json({ ok: true });
    } catch (error) {
        await connection.rollback();
        console.error("[auth/local/verify-email]", error);
        return NextResponse.json({ error: "No se pudo confirmar el email." }, { status: 500 });
    } finally {
        connection.release();
    }
}
