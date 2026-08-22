import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from '@/lib/apiErrors';

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

        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

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
        } catch (dbErr) {
            console.error("[AlertRules] DELETE failed for real tenant:", tenantId, errorMessage(dbErr));
            return NextResponse.json({ success: false, error: `No se pudo eliminar: ${errorMessage(dbErr) || "error"}` }, { status: 500 });
        }
    } catch (err: unknown) {
        if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
        console.error("[AlertRules] DELETE handler error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
