import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireRequestIdentity, AuthError } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";
import rateLimiter from "@/lib/rateLimiter";
import {
    validateUserAvatar,
    saveUserAvatar,
    readUserAvatar,
    deleteUserAvatarFile,
    mimeForExt,
    USER_AVATAR_MAX_BYTES,
} from "@/lib/userAvatar";

// Avatar personalizado del usuario autenticado. Solo se ofrece como
// alternativa cuando Microsoft Graph (Entra ID) no trae foto para la cuenta
// (ver UserProfileMenu.tsx). Privado: la identidad sale SIEMPRE del token
// verificado, nunca de un identificador que mande el cliente — así que solo
// se puede leer/editar/borrar el avatar propio.

async function findOwnRow(tenantId: string, oid: string, email: string) {
    const [rows]: any = await pool.query(
        `SELECT avatar_stored_name FROM Users
         WHERE tenant_id = ? AND (entra_oid = ? OR email = ?) LIMIT 1`,
        [tenantId, oid, email]
    );
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export async function GET(request: NextRequest) {
    try {
        const identity = await requireRequestIdentity(request);
        const row = await findOwnRow(identity.tenantId, identity.claims.oid || "", identity.email || "");
        const storedName = row?.avatar_stored_name as string | null | undefined;
        if (!storedName) {
            return NextResponse.json({ error: "Sin avatar" }, { status: 404 });
        }
        const bytes = await readUserAvatar(storedName);
        if (!bytes) {
            return NextResponse.json({ error: "Sin avatar" }, { status: 404 });
        }
        const ext = storedName.split(".").pop() || "";
        return new NextResponse(new Uint8Array(bytes), {
            status: 200,
            headers: {
                "Content-Type": mimeForExt(ext),
                "Content-Disposition": "inline",
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, max-age=3600",
            },
        });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "GET /api/profile/avatar" });
    }
}

export async function POST(request: NextRequest) {
    try {
        const identity = await requireRequestIdentity(request);

        const rl = await rateLimiter.checkByKeyDistributed(
            `avatar-upload:${identity.tenantId}:${identity.email}`, 10, 60 * 60 * 1000
        );
        if (!rl.allowed) {
            return NextResponse.json({ error: "Demasiadas subidas. Intenta más tarde." }, { status: 429 });
        }

        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
            return NextResponse.json({ error: "Falta el archivo (campo 'file')." }, { status: 400 });
        }
        if (file.size > USER_AVATAR_MAX_BYTES) {
            return NextResponse.json({ error: "La imagen supera el máximo de 2 MB." }, { status: 413 });
        }

        const bytes = Buffer.from(await file.arrayBuffer());
        const originalName = (file.name || "avatar").slice(0, 255);
        const validation = validateUserAvatar(originalName, bytes);
        if (!validation.ok) {
            return NextResponse.json({ error: validation.error }, { status: 415 });
        }

        const oid = identity.claims.oid || "";
        const email = identity.email || "";
        const previous = await findOwnRow(identity.tenantId, oid, email);
        const previousStoredName = previous?.avatar_stored_name as string | null | undefined;

        const storedName = await saveUserAvatar(bytes, validation.ext!);
        const [result]: any = await pool.query(
            `UPDATE Users SET avatar_stored_name = ?
             WHERE tenant_id = ? AND (entra_oid = ? OR email = ?) LIMIT 1`,
            [storedName, identity.tenantId, oid, email]
        );
        if (!result.affectedRows) {
            await deleteUserAvatarFile(storedName);
            return NextResponse.json({ error: "Usuario no encontrado en este tenant." }, { status: 404 });
        }

        if (previousStoredName) {
            await deleteUserAvatarFile(previousStoredName);
        }

        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "POST /api/profile/avatar" });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const identity = await requireRequestIdentity(request);
        const oid = identity.claims.oid || "";
        const email = identity.email || "";
        const row = await findOwnRow(identity.tenantId, oid, email);
        const storedName = row?.avatar_stored_name as string | null | undefined;

        await pool.query(
            `UPDATE Users SET avatar_stored_name = NULL
             WHERE tenant_id = ? AND (entra_oid = ? OR email = ?) LIMIT 1`,
            [identity.tenantId, oid, email]
        );
        if (storedName) {
            await deleteUserAvatarFile(storedName);
        }

        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "DELETE /api/profile/avatar" });
    }
}
