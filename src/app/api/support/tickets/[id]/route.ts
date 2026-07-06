import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantAccess, hasSystemRole, AuthError, type RequestIdentity } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";
import rateLimiter from "@/lib/rateLimiter";
import { SUPPORT_TICKET_PRIORITIES, SUPPORT_TICKET_STATUSES, SUPPORT_BODY_MAX } from "@/lib/supportConfig";

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
        await requireTenantAccess(request, tenantId);

        const { id } = await params;
        const ticketId = Number(id);
        if (!Number.isInteger(ticketId) || ticketId <= 0) {
            return NextResponse.json({ error: "ID de ticket inválido." }, { status: 400 });
        }

        const ticket = await loadTicket(ticketId, tenantId);
        if (!ticket) {
            return NextResponse.json({ error: "Ticket no encontrado." }, { status: 404 });
        }

        const [messages]: any = await pool.query(
            `SELECT id, author_email, author_name, author_role, body, created_at
             FROM SupportTicketMessages WHERE ticket_id = ? ORDER BY created_at ASC`,
            [ticketId]
        );

        return NextResponse.json({ success: true, ticket, messages });
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
        // Respuesta de soporte => queda esperando al cliente; respuesta del
        // cliente => vuelve a la cola del equipo.
        const newStatus = asSupport ? "waiting_customer" : "open";
        const authorName = typeof identity.claims.name === "string" ? identity.claims.name : identity.email;

        await pool.query(
            `INSERT INTO SupportTicketMessages (ticket_id, author_email, author_name, author_role, body)
             VALUES (?, ?, ?, ?, ?)`,
            [ticketId, identity.email, authorName, authorRole, message]
        );
        await pool.query(
            `UPDATE SupportTickets SET status = ?, last_message_at = UTC_TIMESTAMP() WHERE id = ? AND tenant_id = ?`,
            [newStatus, ticketId, tenantId]
        );

        return NextResponse.json({ success: true, status: newStatus }, { status: 201 });
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
