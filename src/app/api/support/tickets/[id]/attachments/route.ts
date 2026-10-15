import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantAccess, hasSystemRole, AuthError } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";
import rateLimiter from "@/lib/rateLimiter";
import { BodyLimitError, readBodyCapped } from "@/lib/readJsonCapped";
import {
    validateAttachment,
    reencodeImage,
    saveAttachment,
    deleteAttachmentFile,
    SUPPORT_ATTACHMENT_MAX_BYTES,
    SUPPORT_ATTACHMENT_MAX_PER_TICKET,
    SUPPORT_ATTACHMENT_MULTIPART_OVERHEAD,
    SUPPORT_ATTACHMENT_RETENTION_DAYS,
} from "@/lib/supportAttachments";

// RBAC: pertenencia al tenant (anti-IDOR: ticket WHERE id AND tenant_id).
// POST multipart/form-data con campos `tenantId` y `file`.
// Tipos: jpg/jpeg/png (firma + fin, sin datos extra) o txt/json (UTF-8), máx 5 MB.
// AISEC-08: el body se corta en 5 MB + overhead multipart mientras llega, antes de
// parsearlo; `messageId` debe ser un mensaje de este ticket.

async function readCappedFormData(request: NextRequest): Promise<FormData> {
    const body = await readBodyCapped(request, SUPPORT_ATTACHMENT_MAX_BYTES + SUPPORT_ATTACHMENT_MULTIPART_OVERHEAD);
    return new Request(request.url, {
        method: "POST",
        headers: { "content-type": request.headers.get("content-type") || "" },
        body: new Uint8Array(body),
    }).formData();
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        let form: FormData;
        try {
            form = await readCappedFormData(request);
        } catch (e) {
            if (e instanceof BodyLimitError) {
                const error = e.status === 413 ? "El archivo supera el máximo de 5 MB." : e.message;
                return NextResponse.json({ error }, { status: e.status });
            }
            return NextResponse.json({ error: "Formulario multipart inválido." }, { status: 400 });
        }
        const tenantId = typeof form.get("tenantId") === "string" ? (form.get("tenantId") as string) : "";
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }
        const identity = await requireTenantAccess(request, tenantId);

        const { id } = await params;
        const ticketId = Number(id);
        if (!Number.isInteger(ticketId) || ticketId <= 0) {
            return NextResponse.json({ error: "ID de ticket inválido." }, { status: 400 });
        }

        const rl = await rateLimiter.checkByKeyDistributed(
            `support-upload:${tenantId}:${identity.email}`, 20, 60 * 60 * 1000
        );
        if (!rl.allowed) {
            return NextResponse.json({ error: "Demasiados archivos subidos. Intenta más tarde." }, { status: 429 });
        }

        const [tickets]: any = await pool.query(
            "SELECT id, status FROM SupportTickets WHERE id = ? AND tenant_id = ?",
            [ticketId, tenantId]
        );
        if (!tickets || tickets.length === 0) {
            return NextResponse.json({ error: "Ticket no encontrado." }, { status: 404 });
        }
        if (tickets[0].status === "closed") {
            return NextResponse.json({ error: "El ticket está cerrado." }, { status: 409 });
        }

        const file = form.get("file");
        if (!(file instanceof File)) {
            return NextResponse.json({ error: "Falta el archivo (campo 'file')." }, { status: 400 });
        }
        if (file.size > SUPPORT_ATTACHMENT_MAX_BYTES) {
            return NextResponse.json({ error: "El archivo supera el máximo de 5 MB." }, { status: 413 });
        }

        const [countRows]: any = await pool.query(
            "SELECT COUNT(*) AS c FROM SupportTicketAttachments WHERE ticket_id = ?",
            [ticketId]
        );
        if (Number(countRows[0]?.c || 0) >= SUPPORT_ATTACHMENT_MAX_PER_TICKET) {
            return NextResponse.json({ error: `Máximo ${SUPPORT_ATTACHMENT_MAX_PER_TICKET} adjuntos por ticket.` }, { status: 409 });
        }

        const originalName = (file.name || "archivo").slice(0, 255);
        const raw = Buffer.from(await file.arrayBuffer());
        const validation = validateAttachment(originalName, raw);
        if (!validation.ok) {
            return NextResponse.json({ error: validation.error }, { status: 415 });
        }
        // Las imágenes se guardan re-codificadas (sin metadatos ni payloads incrustados).
        const reencoded = await reencodeImage(validation.ext!, raw);
        if (!reencoded.ok || !reencoded.bytes) {
            return NextResponse.json({ error: reencoded.error }, { status: 415 });
        }
        const bytes = reencoded.bytes;

        const asSupport = identity.isCorporateDomain && (await hasSystemRole(identity.email, "SUPERADMIN"));

        // `messageId` es opcional: si viene, el adjunto se muestra dentro de la
        // burbuja de ese mensaje; si no, queda a nivel ticket. Debe pertenecer a
        // este ticket (ya filtrado por tenant) y, salvo soporte, no ser nota interna.
        let messageId: number | null = null;
        const rawMessageId = form.get("messageId");
        if (rawMessageId !== null && rawMessageId !== "") {
            const m = typeof rawMessageId === "string" && /^\d{1,10}$/.test(rawMessageId) ? Number(rawMessageId) : NaN;
            if (!Number.isSafeInteger(m) || m <= 0) {
                return NextResponse.json({ error: "Mensaje inválido." }, { status: 400 });
            }
            const [own]: any = await pool.query(
                "SELECT id, is_internal_note FROM SupportTicketMessages WHERE id = ? AND ticket_id = ?",
                [m, ticketId]
            );
            if (!own?.length || (!asSupport && Number(own[0].is_internal_note) === 1)) {
                return NextResponse.json({ error: "Mensaje inválido." }, { status: 400 });
            }
            messageId = m;
        }

        const storedName = await saveAttachment(tenantId, bytes, validation.ext!);
        let result: any;
        try {
            [result] = await pool.query(
                `INSERT INTO SupportTicketAttachments
                    (ticket_id, message_id, tenant_id, uploaded_by_email, uploaded_by_role, original_name, stored_name, mime_type, size_bytes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    ticketId,
                    messageId,
                    tenantId,
                    identity.email,
                    asSupport ? "support" : "user",
                    originalName,
                    storedName,
                    validation.mime,
                    bytes.length,
                ]
            );
        } catch (e) {
            // Sin fila no hay quién lo limpie: borrar el blob recién subido.
            await deleteAttachmentFile(tenantId, storedName);
            throw e;
        }

        // Limpieza oportunista (no bloqueante) de adjuntos fuera de retención.
        void cleanupExpiredAttachments();

        return NextResponse.json({
            success: true,
            attachment: { id: result.insertId, originalName, mimeType: validation.mime, sizeBytes: bytes.length },
        }, { status: 201 });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "POST /api/support/tickets/[id]/attachments" });
    }
}

async function cleanupExpiredAttachments(): Promise<void> {
    try {
        const [rows]: any = await pool.query(
            `SELECT id, tenant_id, stored_name FROM SupportTicketAttachments
             WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY) LIMIT 50`,
            [SUPPORT_ATTACHMENT_RETENTION_DAYS]
        );
        for (const row of rows || []) {
            await deleteAttachmentFile(row.tenant_id, row.stored_name);
            await pool.query("DELETE FROM SupportTicketAttachments WHERE id = ?", [row.id]);
        }
    } catch (e) {
        console.warn("[support-attachments] cleanup oportunista falló:", e instanceof Error ? e.message : e);
    }
}
