import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireSuperAdmin, AuthError } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";
import { SUPPORT_TICKET_STATUSES } from "@/lib/supportConfig";

// RBAC: vista global de tickets de TODOS los tenants — exclusiva del equipo
// de CSCloudSolutions (requireSuperAdmin). Las respuestas y cambios de estado
// se hacen contra /api/support/tickets/[id] pasando el tenantId del ticket.

export async function GET(request: NextRequest) {
    try {
        await requireSuperAdmin(request);

        const url = new URL(request.url);
        const statusFilter = url.searchParams.get("status");

        const where: string[] = [];
        const values: string[] = [];
        if (statusFilter && SUPPORT_TICKET_STATUSES.includes(statusFilter as never)) {
            where.push("t.status = ?");
            values.push(statusFilter);
        }

        const [rows]: any = await pool.query(
            `SELECT t.id, t.tenant_id, t.subject, t.category, t.status, t.priority,
                    t.created_by_email, t.created_by_name,
                    t.created_at, t.updated_at, t.last_message_at,
                    ten.company_name AS tenant_name, ten.tier AS tenant_tier,
                    (SELECT COUNT(*) FROM SupportTicketMessages m WHERE m.ticket_id = t.id) AS message_count
             FROM SupportTickets t
             JOIN Tenants ten ON ten.tenant_id = t.tenant_id
             ${where.length ? "WHERE " + where.join(" AND ") : ""}
             ORDER BY FIELD(t.status, 'open', 'in_progress', 'waiting_customer', 'resolved', 'closed'),
                      FIELD(t.priority, 'urgent', 'high', 'medium', 'low'),
                      t.last_message_at DESC
             LIMIT 500`,
            values
        );

        const [counts]: any = await pool.query(
            `SELECT status, COUNT(*) AS c FROM SupportTickets GROUP BY status`
        );
        const statusCounts: Record<string, number> = {};
        for (const row of counts) statusCounts[row.status] = Number(row.c);

        return NextResponse.json({ success: true, tickets: rows, statusCounts });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "GET /api/admin/support/tickets" });
    }
}
