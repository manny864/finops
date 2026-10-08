import { NextRequest, NextResponse } from "next/server";
import type { ResultSetHeader } from "mysql2";
import pool from "@/modules/storage/db";
import { requireSuperAdmin, AuthError } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";

/**
 * Decisión del operador sobre el triaje con IA de un ticket (Fase 3a).
 *
 * Sólo sella quién y cuándo la aceptó o la descartó. La prioridad, la categoría
 * y el módulo sugeridos los aplica antes la pantalla con el PATCH de
 * /api/support/tickets/[id], el mismo de un cambio manual: la IA no tiene un
 * camino propio para escribir en el ticket.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const identity = await requireSuperAdmin(request);

        const { id } = await params;
        const ticketId = Number(id);
        if (!Number.isInteger(ticketId) || ticketId <= 0) {
            return NextResponse.json({ error: "ID de ticket inválido." }, { status: 400 });
        }
        const body = await request.json().catch(() => ({}));
        if (body.decision !== "accept" && body.decision !== "dismiss") {
            return NextResponse.json({ error: "Decisión inválida." }, { status: 400 });
        }
        const column = body.decision === "accept" ? "accepted" : "dismissed";

        const [result] = await pool.query<ResultSetHeader>(
            `UPDATE SupportTicketAiTriage
                SET ${column}_by = ?, ${column}_at = UTC_TIMESTAMP()
              WHERE ticket_id = ? AND accepted_at IS NULL AND dismissed_at IS NULL`,
            [identity.email, ticketId]
        );
        if (!result || result.affectedRows === 0) {
            return NextResponse.json({ error: "El ticket no tiene una sugerencia de IA pendiente." }, { status: 409 });
        }
        return NextResponse.json({ success: true, status: column });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "POST /api/admin/support/tickets/[id]/ai-triage" });
    }
}
