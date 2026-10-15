import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";
import { readAttachment, mimeForExt, AttachmentScanBlockedError } from "@/lib/supportAttachments";
import { attachmentDownloadHeaders } from "@/lib/attachmentDownload";

// Descarga de un adjunto de soporte. RBAC: pertenencia al tenant dueño del
// adjunto (anti-IDOR: fila WHERE id AND tenant_id); superadmins acceden vía
// requireTenantAccess. Se sirve SIEMPRE como attachment con nosniff para que
// el navegador nunca ejecute/interprete el contenido inline; además en sandbox
// CSP, con CORP same-origin y mime derivado de la extensión en disco (AISEC-09).

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
            "SELECT original_name, stored_name FROM SupportTicketAttachments WHERE id = ? AND tenant_id = ?",
            [attachmentId, tenantId]
        );
        if (!rows || rows.length === 0) {
            return NextResponse.json({ error: "Adjunto no encontrado." }, { status: 404 });
        }

        let bytes: Buffer | null;
        try {
            bytes = await readAttachment(tenantId, rows[0].stored_name);
        } catch (e) {
            if (!(e instanceof AttachmentScanBlockedError)) throw e;
            return NextResponse.json(
                { error: "El archivo está en análisis antimalware o fue bloqueado. Probá de nuevo en unos minutos." },
                { status: 409, headers: { "Retry-After": "60" } }
            );
        }
        if (!bytes) {
            return NextResponse.json({ error: "El archivo ya no está disponible (retención de 60 días)." }, { status: 410 });
        }

        const ext = String(rows[0].stored_name).split(".").pop() || "";
        return new NextResponse(new Uint8Array(bytes), {
            status: 200,
            headers: attachmentDownloadHeaders(String(rows[0].original_name), mimeForExt(ext)),
        });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "GET /api/support/attachments/[id]" });
    }
}
