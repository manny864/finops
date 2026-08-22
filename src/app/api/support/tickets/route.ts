import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";
import rateLimiter from "@/lib/rateLimiter";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import {
    getSupportConfig,
    SUPPORT_SUBJECT_MAX,
    SUPPORT_BODY_MAX,
} from "@/lib/supportConfig";
import {
    buildUserSupportSummary,
    categoryToDb,
    computeSlaDeadline,
    mapTicket,
    priorityToDb,
    type RawTicketRow,
} from "@/services/supportTickets.service";
import { TICKET_RELATED_MODULES, type UserSupportPayload } from "@/types/supportTickets.types";

// RBAC: cualquier usuario del tenant puede ver y crear tickets de soporte
// (feature disponible desde el tier Professional). La cuota mensual de creación
// depende del tier (ver src/lib/supportConfig.ts).
//
// El guard va ANTES del check de mock a propósito: la rama mock lee `Tenants`
// para resolver el tier, así que un llamador anónimo con ?tenantId=demo-x
// alcanzaría estado real. Ver DOC-01 en docs/security/audit-2026-08-21.md.

const CATEGORIES = ["CONSULTA", "FACTURACION_AZURE", "CONEXION_TENANT", "INCIDENCIA_TECNICA", "SOLICITUD_FEATURE"] as const;
const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            const mock = getMockDataForRoute("support", tenantId) as {
                tickets?: RawTicketRow[];
                quota?: { monthlyLimit: number | null; usedThisMonth: number; firstResponseSlaHours: number };
            };
            const slaHours = mock.quota?.firstResponseSlaHours ?? 4;
            const tickets = (mock.tickets || []).map((r) => mapTicket(r, { slaHours, tenantDisplayName: "Demo Corp" }));
            const payload: UserSupportPayload = {
                summary: buildUserSupportSummary(tickets, slaHours),
                source: "mock",
                mock: true,
                quota: mock.quota || { monthlyLimit: null, usedThisMonth: tickets.length, firstResponseSlaHours: slaHours },
                lastUpdated: new Date().toISOString(),
            };
            return NextResponse.json(payload);
        }

        const [tenants]: any = await pool.query(
            "SELECT tier, company_name FROM Tenants WHERE tenant_id = ?",
            [tenantId]
        );
        if (!tenants || tenants.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }
        const config = getSupportConfig(tenants[0].tier);

        const [rows]: any = await pool.query(
            `SELECT t.id, t.tenant_id, t.subject, t.category, t.status, t.priority,
                    t.created_by_email, t.created_by_name,
                    t.created_at, t.updated_at, t.last_message_at,
                    t.sla_deadline, t.first_responded_at, t.resolved_at,
                    t.assigned_admin_email, t.related_module,
                    (SELECT COUNT(*) FROM SupportTicketMessages m WHERE m.ticket_id = t.id) AS message_count,
                    (SELECT m2.body FROM SupportTicketMessages m2
                      WHERE m2.ticket_id = t.id AND m2.is_internal_note = 0
                      ORDER BY m2.created_at DESC LIMIT 1) AS last_message_snippet
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

        const now = new Date();
        const tickets = (rows as RawTicketRow[]).map((r) =>
            mapTicket(r, { slaHours: config.firstResponseSlaHours, now, tenantDisplayName: tenants[0].company_name })
        );

        const payload: UserSupportPayload = {
            summary: buildUserSupportSummary(tickets, config.firstResponseSlaHours),
            source: "live",
            quota: {
                monthlyLimit: config.monthlyTicketQuota,
                usedThisMonth: Number(used[0]?.c || 0),
                firstResponseSlaHours: config.firstResponseSlaHours,
            },
            lastUpdated: now.toISOString(),
        };
        return NextResponse.json(payload);
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
        // Acepta el contrato del dominio (MAYÚSCULAS) y traduce al ENUM de MySQL.
        const category = CATEGORIES.includes(body.category) ? body.category : "CONSULTA";
        const priority = PRIORITIES.includes(body.priority) ? body.priority : "MEDIUM";
        const relatedModule = TICKET_RELATED_MODULES.includes(body.relatedModule) ? body.relatedModule : null;
        // `messageText` es el nombre del contrato; `message` se sigue aceptando
        // para no romper a un cliente viejo que todavía esté en caché.
        const rawMessage = typeof body.messageText === "string" ? body.messageText : body.message;
        const message = typeof rawMessage === "string" ? rawMessage.trim() : "";

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
        const slaDeadline = computeSlaDeadline(new Date(), config.firstResponseSlaHours);
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const [result]: any = await conn.query(
                `INSERT INTO SupportTickets
                   (tenant_id, subject, category, priority, created_by_email, created_by_name, related_module, sla_deadline)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    tenantId,
                    subject,
                    categoryToDb(category),
                    priorityToDb(priority),
                    identity.email,
                    authorName,
                    relatedModule,
                    new Date(slaDeadline),
                ]
            );
            const ticketId = result.insertId;
            await conn.query(
                `INSERT INTO SupportTicketMessages (ticket_id, author_email, author_name, author_role, body)
                 VALUES (?, ?, ?, 'user', ?)`,
                [ticketId, identity.email, authorName, message]
            );
            await conn.commit();
            return NextResponse.json(
                { success: true, ticketId, ticketNumber: `TICK-${ticketId}`, slaDeadlineIso: slaDeadline },
                { status: 201 }
            );
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
