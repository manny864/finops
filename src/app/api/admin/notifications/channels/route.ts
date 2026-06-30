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

        const [rows] = await pool.query(
            `SELECT id, type, name, severity_filter, enabled, created_at, updated_at
             FROM NotificationChannels WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200`,
            [tenantId]
        );
        return NextResponse.json({ success: true, channels: rows });
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
