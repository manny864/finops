/**
 * POST/DELETE /api/cost-groups/[name]/resource-groups — ajuste manual de
 * membresía de un Cost Group creado por el usuario (match_type seteado):
 * suma o quita un Resource Group puntual además de lo que ya capture la
 * regla de tag/patrón, para los casos que no siguen la convención exacta.
 *
 * Solo aplica a grupos custom — los legacy (auto-descubiertos por el tag
 * CostCenter) no tienen membresía editable, se derivan 100% del tag.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, requireTenantAccess, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { invalidateCache, costGroupsCacheKeys } from "@/lib/cache";

async function assertCustomGroup(tenantId: string, name: string): Promise<void> {
    const [rows]: any = await pool.query(
        `SELECT match_type FROM CostGroups WHERE tenant_id = ? AND name = ? LIMIT 1`,
        [tenantId, name]
    );
    if (!rows?.[0] || rows[0].match_type == null) {
        throw new AuthError(
            "Solo se puede ajustar la membresía de un Cost Group creado con una regla propia (no de los auto-descubiertos por tag).",
            400
        );
    }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
    try {
        const { name: rawName } = await params;
        const name = decodeURIComponent(rawName);
        const body = await request.json();
        const { tenantId, resourceGroup } = body;

        if (!tenantId || !resourceGroup || !String(resourceGroup).trim()) {
            return NextResponse.json({ error: "Faltan tenantId o resourceGroup" }, { status: 400 });
        }

        const identity = await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true });
        }

        await requireTenantTier(request, tenantId, "Business");
        await assertCustomGroup(tenantId, name);

        await pool.query(
            `INSERT INTO CostGroupResourceGroups (tenant_id, group_name, resource_group, assigned_by)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE assigned_by = VALUES(assigned_by)`,
            [tenantId, name, String(resourceGroup).trim(), identity.email]
        );

        await invalidateCache(...costGroupsCacheKeys(tenantId));

        return NextResponse.json({ success: true }, { status: 201 });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[cost-groups/resource-groups] POST error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
    try {
        const { name: rawName } = await params;
        const name = decodeURIComponent(rawName);
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const resourceGroup = url.searchParams.get("resourceGroup");

        if (!tenantId || !resourceGroup) {
            return NextResponse.json({ error: "Faltan tenantId o resourceGroup" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true });
        }

        await requireTenantTier(request, tenantId, "Business");

        await pool.query(
            `DELETE FROM CostGroupResourceGroups WHERE tenant_id = ? AND group_name = ? AND resource_group = ?`,
            [tenantId, name, resourceGroup]
        );

        await invalidateCache(...costGroupsCacheKeys(tenantId));

        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[cost-groups/resource-groups] DELETE error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

/**
 * GET /api/cost-groups/[name]/resource-groups — lista los RGs asignados
 * manualmente a un grupo custom (para mostrarlos en el modal de detalle).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
    try {
        const { name: rawName } = await params;
        const name = decodeURIComponent(rawName);
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, resourceGroups: [] });
        }

        const [rows]: any = await pool.query(
            `SELECT resource_group AS resourceGroup, assigned_by AS assignedBy, assigned_at AS assignedAt
             FROM CostGroupResourceGroups WHERE tenant_id = ? AND group_name = ? ORDER BY assigned_at DESC`,
            [tenantId, name]
        );

        return NextResponse.json({ success: true, resourceGroups: rows || [] });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[cost-groups/resource-groups] GET error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
