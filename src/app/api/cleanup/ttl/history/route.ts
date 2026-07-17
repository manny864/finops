/**
 * GET /api/cleanup/ttl/history — histórico de eliminaciones TTL ("Consultás
 * el histórico de qué se eliminó y cuándo", paso 4 del manual). Poblado
 * desde /api/remediation cuando domain='ttl' (ver TtlDeletions en la
 * migración 20260718-001).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("ttl_history", tenantId));
        }

        const [rows]: any = await pool.query(
            `SELECT id, resource_id AS resourceId, resource_name AS resourceName, resource_type AS resourceType,
                    resource_group AS resourceGroup, expiration_date AS expirationDate,
                    deleted_by AS deletedBy, deleted_at AS deletedAt
             FROM TtlDeletions WHERE tenant_id = ? ORDER BY deleted_at DESC LIMIT 500`,
            [tenantId]
        );

        return NextResponse.json({ success: true, deletions: rows || [] });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[ttl/history] GET error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
