import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";
import rateLimiter from "@/lib/rateLimiter";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import {
    getSupportConfig,
    SUPPORT_TICKET_CATEGORIES,
    SUPPORT_TICKET_PRIORITIES,
    SUPPORT_SUBJECT_MAX,
    SUPPORT_BODY_MAX,
} from "@/lib/supportConfig";

// RBAC: cualquier usuario del tenant puede ver y crear tickets de soporte
// (feature disponible desde el tier Essential). La cuota mensual de creación
// depende del tier (ver src/lib/supportConfig.ts).

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("support", tenantId));
        }

        const [tenants]: any = await pool.query(
            "SELECT tier FROM Tenants WHERE tenant_id = ?",
            [tenantId]
        );
        if (!tenants || tenants.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }
        const config = getSupportConfig(tenants[0].tier);

        const [rows]: any = await pool.query(
            `SELECT t.id, t.subject, t.category, t.status, t.priority,
                    t.created_by_email, t.created_by_name,
                    t.created_at, t.updated_at, t.last_message_at,
                    (SELECT COUNT(*) FROM SupportTicketMessages m WHERE m.ticket_id = t.id) AS message_count
             FROM SupportTickets t
             WHERE t.tenant_id = ?
             ORDER BY t.last_message_at DESC
             LIMIT 200`,
            [tenantId]
        );

        // Tickets creados en el mes calendario en curso (para mostrar la cuota).
        const [used]: any = await pool.query(
            `SELECT COUNT(*) AS c FROM SupportTickets
             WHERE tenant_id = ?
               AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')`,
            [tenantId]
        );

        return NextResponse.json({
            success: true,
            tickets: rows,
            quota: {
                monthlyLimit: config.monthlyTicketQuota,
                usedThisMonth: Number(used[0]?.c || 0),
                firstResponseSlaHours: config.firstResponseSlaHours,
            },
        });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "GET /api/support/tickets" });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }

        const identity = await requireTenantAccess(request, tenantId);

        const subject = typeof body.subject === "string" ? body.subject.trim() : "";
        const message = typeof body.message === "string" ? body.message.trim() : "";
        const category = SUPPORT_TICKET_CATEGORIES.includes(body.category) ? body.category : "question";
        const priority = SUPPORT_TICKET_PRIORITIES.includes(body.priority) ? body.priority : "medium";

        if (subject.length < 3 || subject.length > SUPPORT_SUBJECT_MAX) {
            return NextResponse.json({ error: `El asunto debe tener entre 3 y ${SUPPORT_SUBJECT_MAX} caracteres.` }, { status: 400 });
        }
        if (message.length < 1 || message.length > SUPPORT_BODY_MAX) {
            return NextResponse.json({ error: `El mensaje debe tener entre 1 y ${SUPPORT_BODY_MAX} caracteres.` }, { status: 400 });
        }

        // Anti-spam: máx 10 creaciones/hora por (tenant, usuario), además de la cuota mensual.
        const rl = await rateLimiter.checkByKeyDistributed(
            `support-create:${tenantId}:${identity.email}`, 10, 60 * 60 * 1000
        );
        if (!rl.allowed) {
            return NextResponse.json({ error: "Demasiados tickets creados. Intenta más tarde." }, { status: 429 });
        }

        const [tenants]: any = await pool.query(
            "SELECT tier FROM Tenants WHERE tenant_id = ?",
            [tenantId]
        );
        if (!tenants || tenants.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }
        const config = getSupportConfig(tenants[0].tier);

        if (config.monthlyTicketQuota !== null) {
            const [used]: any = await pool.query(
                `SELECT COUNT(*) AS c FROM SupportTickets
                 WHERE tenant_id = ?
                   AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')`,
                [tenantId]
            );
            if (Number(used[0]?.c || 0) >= config.monthlyTicketQuota) {
                return NextResponse.json({
                    error: `Alcanzaste la cuota mensual de ${config.monthlyTicketQuota} tickets de tu plan. Considera actualizar tu tier para soporte ampliado.`,
                    quotaExceeded: true,
                }, { status: 403 });
            }
        }

        const authorName = typeof identity.claims.name === "string" ? identity.claims.name : identity.email;
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const [result]: any = await conn.query(
                `INSERT INTO SupportTickets (tenant_id, subject, category, priority, created_by_email, created_by_name)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [tenantId, subject, category, priority, identity.email, authorName]
            );
            const ticketId = result.insertId;
            await conn.query(
                `INSERT INTO SupportTicketMessages (ticket_id, author_email, author_name, author_role, body)
                 VALUES (?, ?, ?, 'user', ?)`,
                [ticketId, identity.email, authorName, message]
            );
            await conn.commit();
            return NextResponse.json({ success: true, ticketId }, { status: 201 });
        } catch (txErr) {
            await conn.rollback();
            throw txErr;
        } finally {
            conn.release();
        }
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "POST /api/support/tickets" });
    }
}
