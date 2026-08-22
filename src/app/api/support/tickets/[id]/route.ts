import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantAccess, hasSystemRole, AuthError, type RequestIdentity } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";
import rateLimiter from "@/lib/rateLimiter";
import { SUPPORT_TICKET_PRIORITIES, SUPPORT_TICKET_STATUSES, SUPPORT_BODY_MAX, getSupportConfig } from "@/lib/supportConfig";
import {
    mapAttachment,
    mapMessage,
    mapTicket,
    stripInternalNotes,
    type RawAttachmentRow,
    type RawMessageRow,
    type RawTicketRow,
} from "@/services/supportTickets.service";

// RBAC: pertenencia al tenant (anti-IDOR: el ticket se busca siempre con
// WHERE id AND tenant_id). Los superadmins de CSCloudSolutions acceden vía
// requireTenantAccess (allowSuperAdmin) y responden como rol 'support'.

async function isSupportAgent(identity: RequestIdentity): Promise<boolean> {
    return identity.isCorporateDomain && (await hasSystemRole(identity.email, "SUPERADMIN"));
}

async function loadTicket(ticketId: number, tenantId: string): Promise<any | null> {
    const [rows]: any = await pool.query(
        "SELECT * FROM SupportTickets WHERE id = ? AND tenant_id = ?",
        [ticketId, tenantId]
    );
    return rows && rows.length > 0 ? rows[0] : null;
}

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
        const identity = await requireTenantAccess(request, tenantId);

        const { id } = await params;
        const ticketId = Number(id);
        if (!Number.isInteger(ticketId) || ticketId <= 0) {
            return NextResponse.json({ error: "ID de ticket inválido." }, { status: 400 });
        }

        const ticket = await loadTicket(ticketId, tenantId);
        if (!ticket) {
            return NextResponse.json({ error: "Ticket no encontrado." }, { status: 404 });
        }

        const [messageRows]: any = await pool.query(
            `SELECT id, ticket_id, author_email, author_name, author_role, body, is_internal_note, created_at
             FROM SupportTicketMessages WHERE ticket_id = ? ORDER BY created_at ASC`,
            [ticketId]
        );

        const [attachmentRows]: any = await pool.query(
            `SELECT id, message_id, uploaded_by_email, uploaded_by_role, original_name, mime_type, size_bytes, created_at
             FROM SupportTicketAttachments WHERE ticket_id = ? ORDER BY created_at ASC`,
            [ticketId]
        );

        const asSupport = await isSupportAgent(identity);

        const attachments = (attachmentRows as RawAttachmentRow[]).map(mapAttachment);
        const byMessage = new Map<string, typeof attachments>();
        for (let i = 0; i < attachmentRows.length; i++) {
            const key = String(attachmentRows[i].message_id ?? "");
            if (!key) continue;
            const list = byMessage.get(key) || [];
            list.push(attachments[i]);
            byMessage.set(key, list);
        }

        const allMessages = (messageRows as RawMessageRow[]).map((m) =>
            mapMessage(m, byMessage.get(String(m.id ?? "")) || [])
        );
        // Las notas internas se filtran en el servidor: si el llamador no es del
        // equipo, no salen del proceso. No alcanza con no renderizarlas.
        const messages = asSupport ? allMessages : stripInternalNotes(allMessages);

        const [tenantRows]: any = await pool.query("SELECT tier, company_name FROM Tenants WHERE tenant_id = ?", [tenantId]);
        const slaHours = getSupportConfig(String(tenantRows?.[0]?.tier || "")).firstResponseSlaHours;

        return NextResponse.json({
            success: true,
            ticket: mapTicket(ticket as RawTicketRow, {
                slaHours,
                tenantDisplayName: tenantRows?.[0]?.company_name,
                messages,
            }),
            messages,
            // Los adjuntos sin `message_id` (previos a la migración) se siguen
            // listando a nivel ticket para que no desaparezcan del hilo.
            attachments: attachments.filter((_, i) => !attachmentRows[i].message_id),
        });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "GET /api/support/tickets/[id]" });
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const body = await request.json();
        const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }
        const identity = await requireTenantAccess(request, tenantId);

        const { id } = await params;
        const ticketId = Number(id);
        if (!Number.isInteger(ticketId) || ticketId <= 0) {
            return NextResponse.json({ error: "ID de ticket inválido." }, { status: 400 });
        }

        const message = typeof body.message === "string" ? body.message.trim() : "";
        if (message.length < 1 || message.length > SUPPORT_BODY_MAX) {
            return NextResponse.json({ error: `El mensaje debe tener entre 1 y ${SUPPORT_BODY_MAX} caracteres.` }, { status: 400 });
        }

        const rl = await rateLimiter.checkByKeyDistributed(
            `support-reply:${tenantId}:${identity.email}`, 30, 60 * 60 * 1000
        );
        if (!rl.allowed) {
            return NextResponse.json({ error: "Demasiadas respuestas. Intenta más tarde." }, { status: 429 });
        }

        const ticket = await loadTicket(ticketId, tenantId);
        if (!ticket) {
            return NextResponse.json({ error: "Ticket no encontrado." }, { status: 404 });
        }
        if (ticket.status === "closed") {
            return NextResponse.json({ error: "El ticket está cerrado. Abre uno nuevo si necesitas ayuda." }, { status: 409 });
        }

        const asSupport = await isSupportAgent(identity);
        const authorRole = asSupport ? "support" : "user";
        // Sólo el equipo puede dejar notas internas. Si un usuario de tenant
        // manda el flag, se ignora: el mensaje entra como público.
        const isInternalNote = asSupport && body.isInternalNote === true;
        // Respuesta de soporte => queda esperando al cliente; respuesta del
        // cliente => vuelve a la cola del equipo. Una nota interna NO mueve el
        // estado: el cliente no vio nada, así que el ticket sigue donde estaba.
        const newStatus = isInternalNote ? ticket.status : asSupport ? "waiting_customer" : "open";
        const authorName = typeof identity.claims.name === "string" ? identity.claims.name : identity.email;

        const [inserted]: any = await pool.query(
            `INSERT INTO SupportTicketMessages (ticket_id, author_email, author_name, author_role, body, is_internal_note)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [ticketId, identity.email, authorName, authorRole, message, isInternalNote ? 1 : 0]
        );
        // `first_responded_at` se sella con la primera respuesta pública del
        // equipo, que es lo que mide el SLA. Una nota interna no cuenta como
        // haber respondido al cliente.
        await pool.query(
            `UPDATE SupportTickets
                SET status = ?,
                    last_message_at = UTC_TIMESTAMP(),
                    first_responded_at = CASE WHEN first_responded_at IS NULL AND ? = 1 THEN UTC_TIMESTAMP() ELSE first_responded_at END
              WHERE id = ? AND tenant_id = ?`,
            [newStatus, asSupport && !isInternalNote ? 1 : 0, ticketId, tenantId]
        );
        const messageId = inserted?.insertId ?? null;

        return NextResponse.json({ success: true, status: newStatus, messageId, isInternalNote }, { status: 201 });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "POST /api/support/tickets/[id]" });
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const body = await request.json();
        const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }
        const identity = await requireTenantAccess(request, tenantId);

        const { id } = await params;
        const ticketId = Number(id);
        if (!Number.isInteger(ticketId) || ticketId <= 0) {
            return NextResponse.json({ error: "ID de ticket inválido." }, { status: 400 });
        }

        const ticket = await loadTicket(ticketId, tenantId);
        if (!ticket) {
            return NextResponse.json({ error: "Ticket no encontrado." }, { status: 404 });
        }

        const asSupport = await isSupportAgent(identity);
        const status = typeof body.status === "string" ? body.status : null;
        const priority = typeof body.priority === "string" ? body.priority : null;

        if (status && !SUPPORT_TICKET_STATUSES.includes(status as never)) {
            return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
        }
        if (priority && !SUPPORT_TICKET_PRIORITIES.includes(priority as never)) {
            return NextResponse.json({ error: "Prioridad inválida." }, { status: 400 });
        }

        // Los usuarios del tenant solo pueden cerrar su ticket o reabrirlo;
        // cambios de prioridad y estados intermedios son del equipo de soporte.
        if (!asSupport) {
            if (priority) {
                return NextResponse.json({ error: "Solo el equipo de soporte puede cambiar la prioridad." }, { status: 403 });
            }
            if (status !== "closed" && status !== "open") {
                return NextResponse.json({ error: "Solo puedes cerrar o reabrir el ticket." }, { status: 403 });
            }
        }

        if (!status && !priority) {
            return NextResponse.json({ error: "Nada que actualizar." }, { status: 400 });
        }

        const sets: string[] = [];
        const values: (string | number)[] = [];
        if (status) { sets.push("status = ?"); values.push(status); }
        if (priority) { sets.push("priority = ?"); values.push(priority); }
        // La fecha de resolución alimenta el MTTR de la cola global. Se sella al
        // pasar a resolved/closed y se limpia al reabrir, para no promediar un
        // ticket que volvió a estar vivo.
        if (status === "resolved" || status === "closed") {
            sets.push("resolved_at = COALESCE(resolved_at, UTC_TIMESTAMP())");
        } else if (status) {
            sets.push("resolved_at = NULL");
        }
        values.push(ticketId, tenantId);

        await pool.query(
            `UPDATE SupportTickets SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`,
            values
        );

        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "PATCH /api/support/tickets/[id]" });
    }
}
