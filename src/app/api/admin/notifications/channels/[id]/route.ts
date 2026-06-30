/**
 * Admin endpoint para actualizar/eliminar notification channels y probar.
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole, requireTenantAccess } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { notifyTenant } from "@/lib/notifications";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const body = await request.json().catch(() => ({}));
        const { tenantId, name, severity_filter, enabled } = body as {
            tenantId?: string;
            name?: string;
            severity_filter?: string;
            enabled?: boolean;
        };

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
