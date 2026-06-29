import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";

export async function PATCH(request: NextRequest) {
    try {
        await requireSuperAdmin(request);

        const connection = await pool.getConnection();
        try {
            const body = await request.json();
            const { targetUserId } = body;

            if (!targetUserId) {
                return NextResponse.json({ error: "Falta targetUserId." }, { status: 400 });
            }

            const [targetUserRows] = await connection.execute<any>(
                `SELECT email FROM Users WHERE id = ?`,
                [targetUserId]
            );

            if (targetUserRows.length === 0) {
                 return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
            }

            if (!targetUserRows[0].email.toLowerCase().endsWith("@cscloudsolutions.com.ar")) {
                 return NextResponse.json({ error: "Solo se puede promover a usuarios internos." }, { status: 403 });
            }

            await connection.execute(
                `UPDATE Users SET system_role = 'SUPERADMIN' WHERE id = ?`,
                [targetUserId]
            );

            return NextResponse.json({ success: true, message: "Usuario promovido a SUPERADMIN exitosamente." });
        } finally {
            connection.release();
        }
    } catch (error: any) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[SuperAdmin Promote Error]", error);
        return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
    }
}
