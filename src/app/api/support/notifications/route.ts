import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantAccess, requireRequestIdentity, hasSystemRole, AuthError } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";

/**
 * Novedades de soporte para la campanita del header (polling ligero).
 *
 * - Usuario de tenant (`?tenantId=`): mensajes nuevos del equipo de soporte
 *   (author_role='support') en tickets de su tenant desde `since`.
 * - Miembro de CSCloudSolutions con rol SUPERADMIN (`?scope=global`): mensajes
 *   nuevos de clientes (author_role='user') en cualquier tenant desde `since`.
 *
 * `since` es un ISO datetime gestionado por el cliente (localStorage); si es
 * inválido o falta, se usa "últimos 10 minutos" para no inundar.
 */
export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const scope = url.searchParams.get("scope");
        const sinceRaw = url.searchParams.get("since");
        const sinceDate = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw) : new Date(Date.now() - 10 * 60 * 1000);
        // MySQL DATETIME (UTC), acotado a máx 7 días hacia atrás para mantener la query barata.
        const minSince = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        const since = (sinceDate > minSince ? sinceDate : minSince).toISOString().slice(0, 19).replace("T", " ");

        if (scope === "global") {
            const identity = await requireRequestIdentity(request);
            const isSuper = identity.isCorporateDomain && (await hasSystemRole(identity.email, "SUPERADMIN"));
            if (!isSuper) {
                return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });
            }
            const [rows]: any = await pool.query(
                `SELECT m.ticket_id AS ticketId, t.subject, t.tenant_id AS tenantId, m.author_name AS authorName, m.created_at AS createdAt
                 FROM SupportTicketMessages m
                 JOIN SupportTickets t ON t.id = m.ticket_id
                 WHERE m.author_role = 'user' AND m.created_at > ?
                 ORDER BY m.created_at DESC
                 LIMIT 10`,
                [since]
            );
            return NextResponse.json({ success: true, count: rows.length, latest: rows });
        }

        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }
        await requireTenantAccess(request, tenantId);

        const [rows]: any = await pool.query(
            `SELECT m.ticket_id AS ticketId, t.subject, m.author_name AS authorName, m.created_at AS createdAt
             FROM SupportTicketMessages m
             JOIN SupportTickets t ON t.id = m.ticket_id
             WHERE t.tenant_id = ? AND m.author_role = 'support' AND m.created_at > ?
             ORDER BY m.created_at DESC
             LIMIT 10`,
            [tenantId, since]
        );
        return NextResponse.json({ success: true, count: rows.length, latest: rows });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "GET /api/support/notifications" });
    }
}
