import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";

function getUserOid(identity: any): string | null {
    return identity?.claims?.oid || identity?.email || null;
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    let identity;
    try {
        identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return NextResponse.json({ error: "Auth error" }, { status: 401 });
    }

    const userOid = getUserOid(identity);
    if (!userOid) return NextResponse.json({ success: true, pins: [] });

    try {
        const [rows]: any = await pool.query(
            `SELECT widget_key AS widgetKey, position, settings_json AS settings
             FROM UserDashboardPins
             WHERE tenant_id = ? AND user_oid = ?
             ORDER BY position ASC, id ASC`,
            [tenantId, userOid]
        );
        return NextResponse.json({ success: true, pins: rows || [] });
    } catch (err: any) {
        console.error("[dashboard/pins] GET error:", err?.message);
        return NextResponse.json({ success: false, pins: [], error: err?.message });
    }
}

export async function POST(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    let identity;
    try {
        identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return NextResponse.json({ error: "Auth error" }, { status: 401 });
    }

    const userOid = getUserOid(identity);
    if (!userOid) return NextResponse.json({ error: "No se pudo identificar al usuario" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const widgetKey: string = body?.widgetKey;
    const settings = body?.settings ?? null;
    if (!widgetKey || typeof widgetKey !== "string" || widgetKey.length > 100) {
        return NextResponse.json({ error: "widgetKey inválido" }, { status: 400 });
    }

    try {
        const [maxRows]: any = await pool.query(
            `SELECT COALESCE(MAX(position), -1) + 1 AS nextPos
             FROM UserDashboardPins WHERE tenant_id = ? AND user_oid = ?`,
            [tenantId, userOid]
        );
        const nextPos = maxRows?.[0]?.nextPos ?? 0;
        await pool.query(
            `INSERT INTO UserDashboardPins (tenant_id, user_oid, widget_key, position, settings_json)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json)`,
            [tenantId, userOid, widgetKey, nextPos, settings ? JSON.stringify(settings) : null]
        );
        return NextResponse.json({ success: true, widgetKey, position: nextPos });
    } catch (err: any) {
        console.error("[dashboard/pins] POST error:", err?.message);
        return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const widgetKey = searchParams.get("widgetKey");
    if (!tenantId || !widgetKey) {
        return NextResponse.json({ error: "Faltan tenantId o widgetKey" }, { status: 400 });
    }

    let identity;
    try {
        identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return NextResponse.json({ error: "Auth error" }, { status: 401 });
    }

    const userOid = getUserOid(identity);
    if (!userOid) return NextResponse.json({ error: "No se pudo identificar al usuario" }, { status: 400 });

    try {
        await pool.query(
            `DELETE FROM UserDashboardPins WHERE tenant_id = ? AND user_oid = ? AND widget_key = ?`,
            [tenantId, userOid, widgetKey]
        );
        return NextResponse.json({ success: true, widgetKey });
    } catch (err: any) {
        console.error("[dashboard/pins] DELETE error:", err?.message);
        return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    let identity;
    try {
        identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return NextResponse.json({ error: "Auth error" }, { status: 401 });
    }

    const userOid = getUserOid(identity);
    if (!userOid) return NextResponse.json({ error: "No se pudo identificar al usuario" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const order: string[] = Array.isArray(body?.order) ? body.order : [];
    if (order.length === 0) return NextResponse.json({ success: true });

    try {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            for (let i = 0; i < order.length; i++) {
                await conn.query(
                    `UPDATE UserDashboardPins SET position = ?
                     WHERE tenant_id = ? AND user_oid = ? AND widget_key = ?`,
                    [i, tenantId, userOid, order[i]]
                );
            }
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("[dashboard/pins] PATCH error:", err?.message);
        return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
    }
}
