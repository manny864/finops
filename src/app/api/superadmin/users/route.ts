import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) return NextResponse.json({ error: "Falta token" }, { status: 401 });

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded) return NextResponse.json({ error: "Token inválido" }, { status: 401 });

        const email = decoded.unique_name || decoded.preferred_username || decoded.email || "";
        const isCorpDomain = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") && decoded.tid === "8b41364f-581a-4e43-b7cb-13138dac5517";

        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute<any>(`SELECT system_role FROM Users WHERE email = ?`, [email]);
            const isSuperAdmin = isCorpDomain && rows.length > 0 && rows[0].system_role === 'SUPERADMIN';

            if (!isSuperAdmin) return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });

            const [users] = await connection.execute(`SELECT id, entra_oid, tenant_id, email, role, system_role FROM Users ORDER BY email ASC`);
            return NextResponse.json({ success: true, users });
        } finally {
            connection.release();
        }
    } catch (e: any) {
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}
