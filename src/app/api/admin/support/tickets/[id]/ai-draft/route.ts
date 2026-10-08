import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import pool from "@/modules/storage/db";
import { requireSuperAdmin, AuthError } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";
import { draftSupportReply } from "@/services/supportReplyDraft.service";

/**
 * "Sugerir respuesta" (Fase 3b): borrador con citas a los manuales, guardado
 * como nota interna del ticket. Nunca se envía al cliente.
 *
 * Si la IA no está disponible para ese ticket responde 200 con
 * `{ aiAvailable: false, reason }`, como la explicación de anomalías: no es un
 * error del pedido y la pantalla traduce el motivo.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const identity = await requireSuperAdmin(request);

        const { id } = await params;
        const ticketId = Number(id);
        if (!Number.isInteger(ticketId) || ticketId <= 0) {
            return NextResponse.json({ error: "ID de ticket inválido." }, { status: 400 });
        }

        const [rows] = await pool.query<RowDataPacket[]>(
            "SELECT id, tenant_id, subject, category, status, created_by_email FROM SupportTickets WHERE id = ?",
            [ticketId]
        );
        const ticket = rows[0];
        if (!ticket) {
            return NextResponse.json({ error: "Ticket no encontrado." }, { status: 404 });
        }
        if (ticket.status === "closed") {
            return NextResponse.json({ error: "El ticket está cerrado." }, { status: 409 });
        }

        const result = await draftSupportReply(
            {
                id: ticketId,
                tenantId: String(ticket.tenant_id),
                subject: String(ticket.subject ?? ""),
                category: String(ticket.category ?? ""),
                createdByEmail: String(ticket.created_by_email ?? ""),
            },
            {
                email: identity.email,
                name: typeof identity.claims.name === "string" ? identity.claims.name : identity.email,
            }
        );
        return NextResponse.json(result);
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "POST /api/admin/support/tickets/[id]/ai-draft" });
    }
}
