/**
 * Admin endpoint para crear/listar notification channels.
 * Auth: requireTenantRole(['Admin','Owner']) — solo admins del tenant.
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole, requireTenantAccess } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        // Fallback de esquema: las columnas de 20260822-008 pueden no existir
        // todavía en esta réplica. Se filtra por ER_BAD_FIELD_ERROR para que un
        // timeout se propague en vez de disfrazarse de "esquema viejo".
        let rawRows: any[];
        try {
            const [result] = await pool.query(
                `SELECT id, type, name, config_json, severity_filter, enabled, created_at, updated_at,
                        event_categories, rate_limit_minutes, last_delivered_at, last_delivery_status
                 FROM NotificationChannels WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200`,
                [tenantId]
            );
            rawRows = result as any[];
        } catch (schemaErr: any) {
            if (schemaErr?.code !== 'ER_BAD_FIELD_ERROR') throw schemaErr;
            const [legacy] = await pool.query(
                `SELECT id, type, name, config_json, severity_filter, enabled, created_at, updated_at
                 FROM NotificationChannels WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200`,
                [tenantId]
            );
            rawRows = legacy as any[];
        }
        // config_json llega como string o como objeto según el driver — normalizamos
        // a objeto para que el form de edición pueda prellenar webhook_url / recipients.
        const rows = (rawRows as any[]).map((r) => ({
            ...r,
            config_json: typeof r.config_json === "string" ? JSON.parse(r.config_json || "{}") : (r.config_json || {}),
            // event_categories es JSON NULL = todas las categorias (comportamiento
            // previo a la migracion); se normaliza a array para el cliente.
            event_categories: typeof r.event_categories === "string"
                ? JSON.parse(r.event_categories || "[]")
                : (r.event_categories || []),
        }));

        const [tenantRows] = await pool.query(
            "SELECT notifications_enabled FROM Tenants WHERE tenant_id = ? LIMIT 1",
            [tenantId]
        );
        const notificationsEnabled = Boolean((tenantRows as any[])[0]?.notifications_enabled ?? true);

        // Disparos de los ultimos 30 dias, para el KPI. NotificationLog ya
        // registra cada envio; el indice (tenant_id, sent_at) de 20260822-008
        // evita el full scan en cada carga de la pestana.
        let dispatchedLast30DaysCount = 0;
        try {
            const [logRows] = await pool.query(
                `SELECT COUNT(*) AS total FROM NotificationLog
                 WHERE tenant_id = ? AND sent_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
                [tenantId]
            );
            dispatchedLast30DaysCount = Number((logRows as any[])[0]?.total || 0);
        } catch {
            // Sin la tabla el KPI queda en 0; no justifica romper la pantalla.
        }

        return NextResponse.json({ success: true, channels: rows, notificationsEnabled, dispatchedLast30DaysCount });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(err) }, { status: errorStatus(err) });
        }
        return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId, notificationsEnabled } = body as { tenantId?: string; notificationsEnabled?: boolean };

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        await pool.query(
            "UPDATE Tenants SET notifications_enabled = ? WHERE tenant_id = ?",
            [Boolean(notificationsEnabled), tenantId]
        );

        return NextResponse.json({ success: true });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(err) }, { status: errorStatus(err) });
        }
        return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId, type, name, config_json, severity_filter } = body as {
            tenantId?: string;
            type?: string;
            name?: string;
            config_json?: Record<string, unknown>;
            severity_filter?: string;
        };

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        // Validate type
        if (!type || !["slack", "teams", "email"].includes(type)) {
            return NextResponse.json(
                { success: false, error: "type must be 'slack', 'teams', or 'email'" },
                { status: 400 }
            );
        }

        if (!name || !config_json) {
            return NextResponse.json({ success: false, error: "Falta name o config_json" }, { status: 400 });
        }

        // Validate config per type
        if (type === "slack" || type === "teams") {
            if (!config_json.webhook_url || typeof config_json.webhook_url !== "string") {
                return NextResponse.json(
                    { success: false, error: "config_json debe tener webhook_url válida" },
                    { status: 400 }
                );
            }
            try {
                new URL(config_json.webhook_url);
            } catch {
                return NextResponse.json(
                    { success: false, error: "webhook_url debe ser una URL válida" },
                    { status: 400 }
                );
            }
        } else if (type === "email") {
            if (!Array.isArray(config_json.recipients) || config_json.recipients.length === 0) {
                return NextResponse.json(
                    { success: false, error: "config_json.recipients debe ser un array no vacío" },
                    { status: 400 }
                );
            }
        }

        const filter = severity_filter || "info,warning,error";

        const [result] = await pool.query(
            `INSERT INTO NotificationChannels (tenant_id, type, name, config_json, severity_filter, enabled)
             VALUES (?, ?, ?, ?, ?, TRUE)`,
            [tenantId, type, name, JSON.stringify(config_json), filter]
        );

        const inserted = result as any;

        return NextResponse.json({
            success: true,
            channel: {
                id: inserted.insertId,
                type,
                name,
                severity_filter: filter,
                enabled: true,
                created_at: new Date().toISOString(),
            },
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(err) }, { status: errorStatus(err) });
        }
        return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 });
    }
}
