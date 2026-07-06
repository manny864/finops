import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireRequestIdentity, AuthError } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";

// Perfil del usuario autenticado. RBAC: la identidad sale SIEMPRE del token
// verificado (tenantId/oid/email del JWT) — no se acepta ningún identificador
// del cliente, así que solo se puede leer/editar el perfil propio.

export async function GET(request: NextRequest) {
    try {
        const identity = await requireRequestIdentity(request);
        const [rows]: any = await pool.query(
            `SELECT display_name, email, role FROM Users
             WHERE tenant_id = ? AND (entra_oid = ? OR email = ?) LIMIT 1`,
            [identity.tenantId, identity.claims.oid || "", identity.email || ""]
        );
        const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        return NextResponse.json({
            success: true,
            profile: {
                displayName: row?.display_name || null,
                email: identity.email,
                role: row?.role || null,
            },
        });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "GET /api/profile" });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const identity = await requireRequestIdentity(request);
        const body = await request.json();
        const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
        if (displayName.length < 2 || displayName.length > 255) {
            return NextResponse.json({ error: "El nombre debe tener entre 2 y 255 caracteres." }, { status: 400 });
        }
        const [result]: any = await pool.query(
            `UPDATE Users SET display_name = ?
             WHERE tenant_id = ? AND (entra_oid = ? OR email = ?) LIMIT 1`,
            [displayName, identity.tenantId, identity.claims.oid || "", identity.email || ""]
        );
        if (!result.affectedRows) {
            return NextResponse.json({ error: "Usuario no encontrado en este tenant." }, { status: 404 });
        }
        return NextResponse.json({ success: true, displayName });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "PATCH /api/profile" });
    }
}
