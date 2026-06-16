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

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, entraOid, email } = body;

        if (!tenantId || !entraOid || !email) {
            return NextResponse.json({ error: "Faltan parámetros obligatorios." }, { status: 400 });
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

        const adminEmail = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isSuperAdmin = adminEmail.toLowerCase().endsWith("@cscloudsolutions.com.ar");

        const connection = await pool.getConnection();
        try {
            // Check Tenant tier
            const [tenantRows] = await connection.execute<any>(
                `SELECT tier FROM Tenants WHERE tenant_id = ?`,
                [tenantId]
            );
            if (!tenantRows || tenantRows.length === 0) {
                return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
            }
            const tier = tenantRows[0].tier || 'Essential';

            // Count existing users
            const [userRows] = await connection.execute<any>(
                `SELECT COUNT(*) as count FROM Users WHERE tenant_id = ?`,
                [tenantId]
            );
            const count = userRows[0].count;

            if (tier === 'Essential' && count >= 1) {
                return NextResponse.json({ error: "Límite de usuarios alcanzado para el plan Essential (Máx 1)." }, { status: 403 });
            }
            if (tier === 'Professional' && count >= 5) {
                return NextResponse.json({ error: "Límite de usuarios alcanzado para el plan Professional (Máx 5)." }, { status: 403 });
            }
            if (tier === 'Business' && count >= 20) {
                return NextResponse.json({ error: "Límite de usuarios alcanzado para el plan Business (Máx 20)." }, { status: 403 });
            }

            // Validar dominio
            const adminEmail = decoded.preferred_username || decoded.unique_name || decoded.email || "";
            const adminDomain = adminEmail.split('@')[1]?.toLowerCase();
            const newEmailDomain = email.split('@')[1]?.toLowerCase();

            if (adminDomain && newEmailDomain && adminDomain !== newEmailDomain && !isSuperAdmin) {
                 return NextResponse.json({ error: `El usuario debe pertenecer al dominio registrado (${adminDomain}).` }, { status: 403 });
            }

            // Enforce limit passes, insert user
            const newRole = body.role || 'Reader';
            await connection.execute(
                `INSERT INTO Users (entra_oid, tenant_id, email, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE email = ?, role = ?`,
                [entraOid, tenantId, email, newRole, email, newRole]
            );

            return NextResponse.json({ success: true, message: "Usuario agregado exitosamente." });
        } finally {
            connection.release();
        }

    } catch (e: any) {
        console.error("Error creating user:", e);
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, userId, role } = body;

        if (!tenantId || !userId || !role) {
            return NextResponse.json({ error: "Faltan parámetros obligatorios." }, { status: 400 });
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

        // Validar si es admin del tenant
        const connection = await pool.getConnection();
        try {
            if (!isSuperAdmin) {
                 const [adminCheck] = await connection.execute<any>(
                     `SELECT role FROM Users WHERE entra_oid = ? AND tenant_id = ?`,
                     [decoded.oid || decoded.sub, tenantId]
                 );
                 if (!adminCheck || adminCheck.length === 0 || adminCheck[0].role !== 'Admin') {
                     return NextResponse.json({ error: "Solo los administradores del tenant pueden cambiar roles." }, { status: 403 });
                 }
            }

            const [result] = await connection.execute<any>(
                `UPDATE Users SET role = ? WHERE id = ? AND tenant_id = ?`,
                [role, userId, tenantId]
            );

            if (result.affectedRows > 0) {
                return NextResponse.json({ success: true, message: "Rol actualizado exitosamente." });
            } else {
                return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
            }
        } finally {
            connection.release();
        }

    } catch (e: any) {
        console.error("Error updating user role:", e);
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}
