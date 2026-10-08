import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess, requireTenantRole } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const tenantId = searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });

        await requireTenantAccess(req, tenantId, { allowSuperAdmin: true });

        // Tenant demo: se sirve el payload de ejemplo en vez de consultar
        // Azure/DB, que para el tenant de demostración no tienen datos.
        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("tags", tenantId));
        }


        // La tabla quedó en snake_case canónico (20261008-010); la respuesta mantiene tag_key/required.
        const [rows] = await pool.query(
            "SELECT id, tenant_id, policy_name AS tag_key, is_required AS required, created_at FROM TaggingPolicies WHERE tenant_id = ?",
            [tenantId]
        );
        return NextResponse.json({ policies: rows });
    } catch (e: unknown) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { tenantId, tagKey, required } = body;
        
        if (!tenantId || !tagKey) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

        // Las políticas definen el cumplimiento de Tag Governance: escribirlas pide Admin/Owner.
        await requireTenantRole(req, tenantId, ["Admin", "Owner"]);

        await pool.query(
            "INSERT INTO TaggingPolicies (tenant_id, policy_name, is_required) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE is_required = VALUES(is_required)",
            [tenantId, tagKey, required === undefined || required ? 1 : 0]
        );
        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const body = await req.json();
        const { id } = body;
        if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

        const [rows] = await pool.query(
            "SELECT tenant_id FROM TaggingPolicies WHERE id = ? LIMIT 1",
            [id]
        );
        if (!Array.isArray(rows) || rows.length === 0) {
            return NextResponse.json({ error: "Policy not found" }, { status: 404 });
        }

        const tenantId = (rows[0] as { tenant_id?: string }).tenant_id;
        if (!tenantId) {
            return NextResponse.json({ error: "Policy tenant inválido" }, { status: 400 });
        }

        await requireTenantRole(req, tenantId, ["Admin", "Owner"]);
        await pool.query("DELETE FROM TaggingPolicies WHERE id = ? AND tenant_id = ?", [id, tenantId]);
        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}
