import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool from "@/modules/storage/db";

export async function PATCH(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        const email = decoded.unique_name || decoded.preferred_username || decoded.upn || decoded.email || "";
        const isCorpDomain = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") ;

        // Verify if requester is from corp domain
        const connection = await pool.getConnection();
        try {
            const isSuperAdmin = isCorpDomain;

            if (!isSuperAdmin) {
                return NextResponse.json({ error: "Acceso denegado. Se requiere God Mode." }, { status: 403 });
            }

            const body = await request.json();
            const { targetUserId } = body;

            if (!targetUserId) {
                return NextResponse.json({ error: "Falta targetUserId." }, { status: 400 });
            }

            // Verify target user is internal
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
        console.error("[SuperAdmin Promote Error]", error);
        return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
    }
}
