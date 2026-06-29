import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";

export async function GET(request: NextRequest) {
    try {
        await requireSuperAdmin(request);

        const connection = await pool.getConnection();
        try {
            const [users] = await connection.execute(`SELECT id, entra_oid, tenant_id, email, role, system_role FROM Users ORDER BY email ASC`);
            return NextResponse.json({ success: true, users });
        } finally {
            connection.release();
        }
    } catch (e: unknown) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}
