import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";
import { readAttachment } from "@/lib/supportAttachments";

// Descarga de un adjunto de soporte. RBAC: pertenencia al tenant dueño del
// adjunto (anti-IDOR: fila WHERE id AND tenant_id); superadmins acceden vía
// requireTenantAccess. Se sirve SIEMPRE como attachment con nosniff para que
// el navegador nunca ejecute/interprete el contenido inline.

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }
        await requireTenantAccess(request, tenantId);

        const { id } = await params;
        const attachmentId = Number(id);
        if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
            return NextResponse.json({ error: "ID de adjunto inválido." }, { status: 400 });
        }

        const [rows]: any = await pool.query(
            "SELECT original_name, stored_name, mime_type FROM SupportTicketAttachments WHERE id = ? AND tenant_id = ?",
            [attachmentId, tenantId]
        );
        if (!rows || rows.length === 0) {
            return NextResponse.json({ error: "Adjunto no encontrado." }, { status: 404 });
        }

        const bytes = await readAttachment(rows[0].stored_name);
        if (!bytes) {
            return NextResponse.json({ error: "El archivo ya no está disponible (retención de 60 días)." }, { status: 410 });
        }

        const safeName = String(rows[0].original_name).replace(/[^\w.\- ]/g, "_");
        return new NextResponse(new Uint8Array(bytes), {
            status: 200,
            headers: {
                "Content-Type": rows[0].mime_type,
                "Content-Disposition": `attachment; filename="${safeName}"`,
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, no-store",
            },
        });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "GET /api/support/attachments/[id]" });
    }
}
