/**
 * Admin endpoint para actualizar/eliminar notification channels y probar.
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const body = await request.json().catch(() => ({}));
        const { tenantId, name, severity_filter, enabled, config_json } = body as {
            tenantId?: string;
            name?: string;
            severity_filter?: string;
            enabled?: boolean;
            config_json?: Record<string, unknown>;
        };

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        // Verify channel belongs to tenant (traemos el type para validar config_json)
        const [rows] = await pool.query(
            "SELECT id, type FROM NotificationChannels WHERE id=? AND tenant_id=?",
            [parseInt(id), tenantId]
        );

        if ((rows as any[]).length === 0) {
            return NextResponse.json({ success: false, error: "Channel not found" }, { status: 404 });
        }

        const channelType = (rows as any[])[0].type as string;

        const updates: string[] = [];
        const values: any[] = [];

        if (name !== undefined) {
            updates.push("name=?");
            values.push(name);
        }
        if (severity_filter !== undefined) {
            updates.push("severity_filter=?");
            values.push(severity_filter);
        }
        if (enabled !== undefined) {
            updates.push("enabled=?");
            values.push(enabled);
        }
        if (config_json !== undefined) {
            // Misma validación que en el POST, según el tipo del canal (no editable).
            if (channelType === "slack" || channelType === "teams") {
                if (!config_json.webhook_url || typeof config_json.webhook_url !== "string") {
                    return NextResponse.json({ success: false, error: "config_json debe tener webhook_url válida" }, { status: 400 });
                }
                try {
                    new URL(config_json.webhook_url);
                } catch {
                    return NextResponse.json({ success: false, error: "webhook_url debe ser una URL válida" }, { status: 400 });
                }
            } else if (channelType === "email") {
                if (!Array.isArray(config_json.recipients) || config_json.recipients.length === 0) {
                    return NextResponse.json({ success: false, error: "config_json.recipients debe ser un array no vacío" }, { status: 400 });
                }
            }
            updates.push("config_json=?");
            values.push(JSON.stringify(config_json));
        }

        if (updates.length === 0) {
            return NextResponse.json({ success: true, message: "No updates provided" });
        }

        values.push(parseInt(id));
        values.push(tenantId);

        await pool.query(
            `UPDATE NotificationChannels SET ${updates.join(", ")} WHERE id=? AND tenant_id=?`,
            values
        );

        return NextResponse.json({ success: true });
    } catch (err: any) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: err.message }, { status: err.status });
        }
        return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        // Verify channel belongs to tenant
        const [rows] = await pool.query(
            "SELECT id FROM NotificationChannels WHERE id=? AND tenant_id=?",
            [parseInt(id), tenantId]
        );

        if ((rows as any[]).length === 0) {
            return NextResponse.json({ success: false, error: "Channel not found" }, { status: 404 });
        }

        await pool.query("DELETE FROM NotificationChannels WHERE id=? AND tenant_id=?", [parseInt(id), tenantId]);

        return NextResponse.json({ success: true });
    } catch (err: any) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: err.message }, { status: err.status });
        }
        return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
    }
}
