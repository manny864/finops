/**
 * GET/POST/DELETE /api/cleanup/ttl/policies — políticas TTL ("Creás una
 * política TTL: qué tipo de recurso, cuántos días de vida", paso 1 del
 * manual). Mismo patrón RBAC que /api/cost-groups (Business+, Admin/Owner
 * para escritura): es una acción de gobernanza, no de eliminación directa
 * (el tier de borrado real sigue gateado a Enterprise vía canDeleteResources
 * 'ttl', sin cambios acá).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { TTL_RESOURCE_TYPES } from "@/services/ttlService";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("ttl_policies", tenantId));
        }

        const [rows]: any = await pool.query(
            `SELECT id, name, resource_type AS resourceType, days_to_live AS daysToLive,
                    description, enabled, created_by AS createdBy, created_at AS createdAt
             FROM TtlPolicies WHERE tenant_id = ? ORDER BY created_at DESC`,
            [tenantId]
        );

        return NextResponse.json({ success: true, policies: rows || [] });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[ttl/policies] GET error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

const NAME_MAX_LEN = 255;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, name, resourceType, daysToLive, description } = body;

        if (!tenantId || !name || typeof name !== "string" || !name.trim()) {
            return NextResponse.json({ error: "Faltan tenantId o name" }, { status: 400 });
        }
        if (name.trim().length > NAME_MAX_LEN) {
            return NextResponse.json({ error: `El nombre no puede superar ${NAME_MAX_LEN} caracteres` }, { status: 400 });
        }
        if (!TTL_RESOURCE_TYPES.includes(resourceType)) {
            return NextResponse.json({ error: `resourceType debe ser uno de: ${TTL_RESOURCE_TYPES.join(", ")}` }, { status: 400 });
        }
        const days = Number(daysToLive);
        if (!Number.isFinite(days) || days < 1 || days > 3650) {
            return NextResponse.json({ error: "daysToLive debe ser un número entre 1 y 3650" }, { status: 400 });
        }

        const identity = await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, name: name.trim() });
        }

        await requireTenantTier(request, tenantId, "Business");

        try {
            await pool.query(
                `INSERT INTO TtlPolicies (tenant_id, name, resource_type, days_to_live, description, created_by)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [tenantId, name.trim(), resourceType, Math.round(days), description ? String(description).trim().slice(0, 1000) : null, identity.email]
            );
        } catch (e: any) {
            if (e?.code === "ER_DUP_ENTRY") {
                return NextResponse.json({ error: `Ya existe una política llamada "${name.trim()}"` }, { status: 409 });
            }
            throw e;
        }

        return NextResponse.json({ success: true, name: name.trim() }, { status: 201 });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[ttl/policies] POST error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const id = url.searchParams.get("id");
        if (!tenantId || !id) return NextResponse.json({ error: "Faltan tenantId o id" }, { status: 400 });

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true });
        }

        await requireTenantTier(request, tenantId, "Business");

        await pool.query(`DELETE FROM TtlPolicies WHERE tenant_id = ? AND id = ?`, [tenantId, Number(id)]);

        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[ttl/policies] DELETE error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
