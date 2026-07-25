import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import rateLimiter from "@/lib/rateLimiter";
import { normalizeEmail, verifyPasswordConstantTime } from "@/lib/localAuth";
import { issueLocalToken, isLocalAuthConfigured } from "@/lib/localToken";

/**
 * Login de identidad propia. Devuelve el JWT HS256 que el frontend manda como
 * `Authorization: Bearer` exactamente igual que el idToken de Entra — ver el
 * branch de `validateRequestToken` en src/lib/requestAuth.ts.
 */

const GENERIC_ERROR = "Email o contraseña incorrectos.";

export async function POST(request: NextRequest) {
    if (!isLocalAuthConfigured()) {
        return NextResponse.json({ error: "El login con email no está habilitado." }, { status: 503 });
    }

    let body: Record<string, unknown> = {};
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Body inválido." }, { status: 400 });
    }

    const email = normalizeEmail(String(body.email || ""));
    const password = String(body.password || "");

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim()
        || request.headers.get("x-real-ip")
        || "unknown";

    // Doble rate limit a propósito:
    //  - por email: frena fuerza bruta contra UNA cuenta desde muchas IPs.
    //  - por IP: frena password spraying (una password contra muchas cuentas),
    //    que el límite por email no vería nunca.
    const [byEmail, byIp] = await Promise.all([
        rateLimiter.checkByKeyDistributed(`login-local:email:${email}`, 10, 15 * 60 * 1000),
        rateLimiter.checkByKeyDistributed(`login-local:ip:${ip}`, 30, 15 * 60 * 1000),
    ]);
    if (!byEmail.allowed || !byIp.allowed) {
        return NextResponse.json(
            { error: "Demasiados intentos fallidos. Esperá unos minutos." },
            { status: 429 }
        );
    }

    try {
        const [rows] = await pool.query(
            `SELECT id, tenant_id, email, password_hash, email_verified_at
               FROM Users
              WHERE email = ? AND password_hash IS NOT NULL
              LIMIT 1`,
            [email]
        );
        const user = Array.isArray(rows) && rows.length > 0
            ? (rows[0] as {
                id: number;
                tenant_id: string;
                email: string;
                password_hash: string | null;
                email_verified_at: Date | null;
            })
            : null;

        // Se gasta el bcrypt aunque el usuario no exista (ver
        // verifyPasswordConstantTime): sin eso, el tiempo de respuesta
        // distingue "email inexistente" de "password incorrecta".
        const passwordOk = await verifyPasswordConstantTime(password, user?.password_hash ?? null);
        if (!user || !passwordOk) {
            return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
        }

        if (!user.email_verified_at) {
            return NextResponse.json(
                { error: "Tenés que confirmar tu email antes de entrar.", verificationRequired: true },
                { status: 403 }
            );
        }

        const token = await issueLocalToken({
            tid: user.tenant_id,
            oid: `local:${user.id}`,
            email: user.email,
        });

        return NextResponse.json({ token, tenantId: user.tenant_id, email: user.email });
    } catch (error) {
        console.error("[auth/local/login]", error);
        return NextResponse.json({ error: "No se pudo iniciar sesión." }, { status: 500 });
    }
}
