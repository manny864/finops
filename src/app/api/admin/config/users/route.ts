import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');

        if (!tenantId) {
            return NextResponse.json({ error: "El parámetro tenantId es obligatorio." }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isSuperAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

        if (decoded.tid !== tenantId && !isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });
        }

        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT id, email, role, entra_oid FROM Users WHERE tenant_id = ?`,
                [tenantId]
            );
            return NextResponse.json({ success: true, users: rows });
        } finally {
            connection.release();
        }

    } catch (e: any) {
        console.error("Error fetching users:", e);
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        let tenantId = searchParams.get('tenantId');
        let userId = searchParams.get('userId');

        if (!tenantId || !userId) {
            try {
                const body = await request.json();
                tenantId = tenantId || body.tenantId;
                userId = userId || body.userId;
            } catch (e) {}
        }

        if (!tenantId || !userId) {
            return NextResponse.json({ error: "Los parámetros tenantId y userId son obligatorios." }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isSuperAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

        // Solo super admins pueden borrar usuarios
        if (!isSuperAdmin) {
            return NextResponse.json({ error: "Solo los administradores de CS Cloud Solutions pueden eliminar usuarios." }, { status: 403 });
        }

        const connection = await pool.getConnection();
        try {
            const [result] = await connection.execute<any>(
                `DELETE FROM Users WHERE id = ? AND tenant_id = ?`,
                [userId, tenantId]
            );

            if (result.affectedRows > 0) {
                return NextResponse.json({ success: true, message: `Usuario eliminado exitosamente.` });
            } else {
                return NextResponse.json({ error: "Usuario no encontrado en este tenant." }, { status: 404 });
            }
        } finally {
            connection.release();
        }

    } catch (e: any) {
        console.error("Error deleting user:", e);
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
    }
}
