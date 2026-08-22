import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireSuperAdmin, AuthError } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";
import { getSupportConfig } from "@/lib/supportConfig";
import {
    buildGlobalSupportSummary,
    buildStatusCounts,
    mapTicket,
    resolutionHours,
    statusToDb,
    type RawTicketRow,
} from "@/services/supportTickets.service";
import type { GlobalSupportPayload, TicketStatus } from "@/types/supportTickets.types";

// RBAC: vista global de tickets de TODOS los tenants — exclusiva del equipo
// de CSCloudSolutions (requireSuperAdmin). Las respuestas y cambios de estado
// se hacen contra /api/support/tickets/[id] pasando el tenantId del ticket.
//
// Sin rama mock: la cola global no tiene versión de demo porque no existe un
// "superadmin demo"; requireSuperAdmin exige dominio corporativo + rol en DB.

const STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_USER", "RESOLVED", "CLOSED"];

export async function GET(request: NextRequest) {
    try {
        await requireSuperAdmin(request);

        const url = new URL(request.url);
        const statusParam = url.searchParams.get("status");

        const where: string[] = [];
        const values: string[] = [];
        if (statusParam && STATUSES.includes(statusParam as TicketStatus)) {
            where.push("t.status = ?");
            values.push(statusToDb(statusParam as TicketStatus));
        }

        const [rows]: any = await pool.query(
            `SELECT t.id, t.tenant_id, t.subject, t.category, t.status, t.priority,
                    t.created_by_email, t.created_by_name,
                    t.created_at, t.updated_at, t.last_message_at,
                    t.sla_deadline, t.first_responded_at, t.resolved_at,
                    t.assigned_admin_email, t.related_module,
                    ten.company_name AS tenant_name, ten.tier AS tenant_tier,
                    (SELECT COUNT(*) FROM SupportTicketMessages m WHERE m.ticket_id = t.id) AS message_count,
                    (SELECT m2.body FROM SupportTicketMessages m2
                      WHERE m2.ticket_id = t.id ORDER BY m2.created_at DESC LIMIT 1) AS last_message_snippet
             FROM SupportTickets t
             JOIN Tenants ten ON ten.tenant_id = t.tenant_id
             ${where.length ? "WHERE " + where.join(" AND ") : ""}
             ORDER BY FIELD(t.status, 'open', 'in_progress', 'waiting_customer', 'resolved', 'closed'),
                      FIELD(t.priority, 'urgent', 'high', 'medium', 'low'),
                      t.last_message_at DESC
             LIMIT 500`,
            values
        );

        const now = new Date();
        const raw = rows as (RawTicketRow & { tenant_tier?: string })[];
        // El SLA es por tier del tenant dueño del ticket, no un valor global:
        // Professional tiene 24 h y Enterprise 4 h, y la cola los mezcla.
        const tickets = raw.map((r) =>
            mapTicket(r, { slaHours: getSupportConfig(String(r.tenant_tier || "")).firstResponseSlaHours, now })
        );
        const durations = raw.map(resolutionHours).filter((h): h is number => h !== null);

        // Los contadores de las pills son globales, no del filtro aplicado: si
        // se contaran sobre el resultado filtrado, al filtrar por "Abierto"
        // todas las demás pills mostrarían 0.
        const [counts]: any = await pool.query(`SELECT status, COUNT(*) AS c FROM SupportTickets GROUP BY status`);
        const statusCounts = buildStatusCounts([]);
        for (const row of counts as { status: string; c: number }[]) {
            const key = (
                {
                    open: "OPEN",
                    in_progress: "IN_PROGRESS",
                    waiting_customer: "WAITING_USER",
                    resolved: "RESOLVED",
                    closed: "CLOSED",
                } as Record<string, TicketStatus>
            )[row.status];
            if (key) statusCounts[key] = Number(row.c);
        }

        const payload: GlobalSupportPayload = {
            summary: buildGlobalSupportSummary(tickets, durations),
            statusCounts,
            source: "live",
            lastUpdated: now.toISOString(),
        };
        return NextResponse.json(payload);
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "GET /api/admin/support/tickets" });
    }
}

/**
 * Asignación de un ticket a un agente ("Tomar" / reasignar).
 *
 * Sólo superadmin: es la cola interna del equipo. `assignedAdminEmail: null`
 * libera el ticket y lo devuelve a "Sin asignar".
 */
export async function PATCH(request: NextRequest) {
    try {
        const identity = await requireSuperAdmin(request);
        const body = await request.json().catch(() => ({}));

        const ticketId = Number(body.ticketId);
        if (!Number.isInteger(ticketId) || ticketId <= 0) {
            return NextResponse.json({ error: "ID de ticket inválido." }, { status: 400 });
        }

        // `"me"` evita que el cliente elija a quién asignar por email arbitrario:
        // tomar un ticket siempre asigna al que hace el pedido.
        const assignee =
            body.assignedAdminEmail === null
                ? null
                : body.assignedAdminEmail === "me" || !body.assignedAdminEmail
                    ? identity.email
                    : String(body.assignedAdminEmail).slice(0, 255);

        const [result]: any = await pool.query(
            `UPDATE SupportTickets
                SET assigned_admin_email = ?,
                    status = CASE WHEN ? IS NOT NULL AND status = 'open' THEN 'in_progress' ELSE status END
              WHERE id = ?`,
            [assignee, assignee, ticketId]
        );
        if (!result || result.affectedRows === 0) {
            return NextResponse.json({ error: "Ticket no encontrado." }, { status: 404 });
        }

        return NextResponse.json({ success: true, ticketId, assignedAdminEmail: assignee });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "PATCH /api/admin/support/tickets" });
    }
}
