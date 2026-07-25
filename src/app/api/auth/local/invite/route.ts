import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import rateLimiter from "@/lib/rateLimiter";
import { AuthError, requireTenantRole } from "@/lib/requestAuth";
import { getUserLimit } from "@/lib/tierLogic";
import {
    buildAppUrl,
    consumeAuthToken,
    createAuthToken,
    hashPassword,
    localEmailTaken,
    normalizeEmail,
    validatePasswordPolicy,
} from "@/lib/localAuth";
import { isLocalAuthConfigured } from "@/lib/localToken";
import { sendEmailAsync, getInviteEmailHtml } from "@/lib/emailHelper";

/**
 * POST = un Admin/Owner invita a alguien a su tenant.
 * PUT  = el invitado canjea el token y elige su contraseña (anónimo).
 *
 * En el mundo Entra el alta de usuario es implícita: la persona hace login con
 * Microsoft y /api/onboard le crea la fila. Sin Entra no hay tal cosa, así que
 * el alta tiene que ser explícita — de ahí este endpoint.
 *
 * La fila en Users NO se crea al invitar, sino al aceptar. Así una invitación
 * que nadie usa no consume cupo del plan ni deja usuarios fantasma.
 */

// El rol NO es parámetro de la invitación a propósito: todo invitado entra
// como Reader y un Admin/Owner lo promueve desde /admin/users, igual que en el
// alta por Entra (/api/onboard). Aceptar un rol acá abriría la puerta a que un
// Admin se autoinvite como Owner.
async function countTenantUsers(tenantId: string): Promise<number> {
    const [rows] = await pool.query("SELECT COUNT(*) AS cnt FROM Users WHERE tenant_id = ?", [tenantId]);
    return Array.isArray(rows) && rows.length > 0 ? Number((rows[0] as { cnt: number }).cnt) : 0;
}

export async function POST(request: NextRequest) {
    if (!isLocalAuthConfigured()) {
        return NextResponse.json({ error: "No habilitado." }, { status: 503 });
    }

    let body: Record<string, unknown> = {};
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Body inválido." }, { status: 400 });
    }

    const tenantId = String(body.tenantId || "");
    const email = normalizeEmail(String(body.email || ""));

    if (!tenantId) return NextResponse.json({ error: "Falta tenantId." }, { status: 400 });
    if (!email.includes("@")) return NextResponse.json({ error: "Email inválido." }, { status: 400 });

    const connection = await pool.getConnection();
    try {
        await requireTenantRole(request, tenantId, ["ADMIN", "OWNER"]);

        // Cupo del plan. Se cuenta el usuario invitado como +1 aunque todavía
        // no exista la fila: si no, se pueden emitir N invitaciones y superar
        // el límite cuando todas se acepten.
        const [tierRows] = await connection.query("SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1", [tenantId]);
        const tier = Array.isArray(tierRows) && tierRows.length > 0
            ? String((tierRows[0] as { tier?: string }).tier || "Essential")
            : "Essential";
        const userLimit = getUserLimit(tier);
        const currentUsers = await countTenantUsers(tenantId);
        if (Number.isFinite(userLimit) && currentUsers + 1 > userLimit) {
            return NextResponse.json(
                { error: `Tu organización alcanzó el límite de usuarios del plan ${tier} (${userLimit}).` },
                { status: 403 }
            );
        }

        const [existing] = await connection.query(
            "SELECT 1 FROM Users WHERE tenant_id = ? AND email = ? LIMIT 1",
            [tenantId, email]
        );
        if (Array.isArray(existing) && existing.length > 0) {
            return NextResponse.json({ error: "Ese usuario ya está en la organización." }, { status: 409 });
        }
        if (await localEmailTaken(connection, email)) {
            return NextResponse.json({ error: "Ese email ya tiene una cuenta." }, { status: 409 });
        }

        await connection.beginTransaction();
        const token = await createAuthToken(connection, tenantId, email, "invite");
        await connection.commit();

        const inviteUrl = buildAppUrl(`/accept-invite?token=${encodeURIComponent(token)}`);
        sendEmailAsync("Te invitaron a CSCloudSolutions", getInviteEmailHtml(inviteUrl), email);

        return NextResponse.json({ ok: true });
    } catch (error) {
        await connection.rollback().catch(() => {});
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("[auth/local/invite]", error);
        return NextResponse.json({ error: "No se pudo enviar la invitación." }, { status: 500 });
    } finally {
        connection.release();
    }
}

export async function PUT(request: NextRequest) {
    if (!isLocalAuthConfigured()) {
        return NextResponse.json({ error: "No habilitado." }, { status: 503 });
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim()
        || request.headers.get("x-real-ip")
        || "unknown";
    const limit = await rateLimiter.checkByKeyDistributed(`invite-accept:${ip}`, 20, 15 * 60 * 1000);
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

        const consumed = await consumeAuthToken(connection, "invite", String(body.token || ""));
        if (!consumed) {
            await connection.rollback();
            return NextResponse.json({ error: "La invitación es inválida o venció." }, { status: 400 });
        }

        // Se revalida el cupo al aceptar, no sólo al invitar: entre las dos
        // cosas pueden pasar días y el tenant pudo haber bajado de plan.
        const [tierRows] = await connection.query(
            "SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1",
            [consumed.tenantId]
        );
        const tier = Array.isArray(tierRows) && tierRows.length > 0
            ? String((tierRows[0] as { tier?: string }).tier || "Essential")
            : "Essential";
        const userLimit = getUserLimit(tier);
        const [countRows] = await connection.query(
            "SELECT COUNT(*) AS cnt FROM Users WHERE tenant_id = ?",
            [consumed.tenantId]
        );
        const currentUsers = Array.isArray(countRows) && countRows.length > 0
            ? Number((countRows[0] as { cnt: number }).cnt)
            : 0;
        if (Number.isFinite(userLimit) && currentUsers + 1 > userLimit) {
            await connection.rollback();
            return NextResponse.json(
                { error: "La organización alcanzó el límite de usuarios de su plan." },
                { status: 403 }
            );
        }

        // El rol NO se toma del request: viene del link, y el link lo controla
        // el invitado. Se entra siempre como Reader y un Admin promueve desde
        // /admin/users — mismo criterio que el alta por Entra en /api/onboard.
        await connection.query(
            `INSERT INTO Users (entra_oid, tenant_id, email, role, system_role, password_hash, email_verified_at)
             VALUES (NULL, ?, ?, 'Reader', 'USER', ?, NOW())`,
            [consumed.tenantId, consumed.email, await hashPassword(password)]
        );

        await connection.commit();
        return NextResponse.json({ ok: true, tenantId: consumed.tenantId, email: consumed.email });
    } catch (error) {
        await connection.rollback();
        console.error("[auth/local/invite:accept]", error);
        return NextResponse.json({ error: "No se pudo aceptar la invitación." }, { status: 500 });
    } finally {
        connection.release();
    }
}
