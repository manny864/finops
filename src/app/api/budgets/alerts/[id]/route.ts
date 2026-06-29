import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";

function authCheck(request: NextRequest, tenantId: string): NextResponse | null {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
    }
    const decoded = jwt.decode(authHeader.split(" ")[1]) as any;
    if (!decoded || !decoded.tid) {
        return NextResponse.json({ error: "Token inválido." }, { status: 401 });
    }
    const email = (decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "").toLowerCase();
    const isSuperAdmin = email.endsWith("@cscloudsolutions.com.ar");
    if (decoded.tid !== tenantId && !isSuperAdmin) {
        return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });
    }
    return null;
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
        }

        const authErr = authCheck(request, tenantId);
        if (authErr) return authErr;

        const { id } = await params;

        if (isMockTenant(tenantId)) {
            console.log("[AlertRules][mock] DELETE skipped for id:", id);
            return NextResponse.json({ success: true, mock: true });
        }

        try {
            await pool.query(
                `DELETE FROM AlertRules WHERE id = ? AND tenant_id = ?`,
                [id, tenantId]
            );
            return NextResponse.json({ success: true, mock: false });
        } catch (dbErr: any) {
            console.error("[AlertRules] DELETE failed for real tenant:", tenantId, dbErr?.message);
            return NextResponse.json({ success: false, error: `No se pudo eliminar: ${dbErr?.message || "error"}` }, { status: 500 });
        }
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Error interno" }, { status: 500 });
    }
}
