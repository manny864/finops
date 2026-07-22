/**
 * Admin endpoint para crear/listar notification channels.
 * Auth: requireTenantRole(['Admin','Owner']) — solo admins del tenant.
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole, requireTenantAccess } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        const [rawRows] = await pool.query(
            `SELECT id, type, name, config_json, severity_filter, enabled, created_at, updated_at
             FROM NotificationChannels WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200`,
            [tenantId]
        );
        // config_json llega como string o como objeto según el driver — normalizamos
        // a objeto para que el form de edición pueda prellenar webhook_url / recipients.
        const rows = (rawRows as any[]).map((r) => ({
            ...r,
            config_json: typeof r.config_json === "string" ? JSON.parse(r.config_json || "{}") : (r.config_json || {}),
        }));

        const [tenantRows] = await pool.query(
            "SELECT notifications_enabled FROM Tenants WHERE tenant_id = ? LIMIT 1",
            [tenantId]
        );
        const notificationsEnabled = Boolean((tenantRows as any[])[0]?.notifications_enabled ?? true);

        return NextResponse.json({ success: true, channels: rows, notificationsEnabled });
    } catch (err: any) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: err.message }, { status: err.status });
        }
        return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
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
    } catch (err: any) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: err.message }, { status: err.status });
        }
        return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
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
    } catch (err: any) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: err.message }, { status: err.status });
        }
        return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
    }
}
