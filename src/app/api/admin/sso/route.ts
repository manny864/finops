import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

/**
 * GET /api/admin/sso?tenantId=xxx
 * Retrieve TenantSSO configuration for the tenant
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json(
                { success: false, error: "Missing tenantId" },
                { status: 400 }
            );
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        const [rows] = await pool.query(
            `SELECT id, tenant_id, workos_org_id, workos_connection_id, domain, enabled, created_at, updated_at
             FROM TenantSSO WHERE tenant_id = ?`,
            [tenantId]
        );

        const config =
            Array.isArray(rows) && rows.length > 0
                ? rows[0]
                : {
                      tenant_id: tenantId,
                      workos_org_id: null,
                      workos_connection_id: null,
                      domain: null,
                      enabled: false,
                  };

        return NextResponse.json({ success: true, config });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json(
                { success: false, error: errorMessage(err) },
                { status: errorStatus(err) }
            );
        }
        console.error("Admin SSO GET error:", err);
        return NextResponse.json(
            { success: false, error: errorMessage(err) || "Error fetching SSO config" },
            { status: 500 }
        );
    }
}

/**
 * PUT /api/admin/sso
 * Upsert TenantSSO configuration
 */
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const {
            tenantId,
            workos_org_id,
            workos_connection_id,
            domain,
            enabled,
        } = body as {
            tenantId?: string;
            workos_org_id?: string;
            workos_connection_id?: string;
            domain?: string;
            enabled?: boolean;
        };

        if (!tenantId) {
            return NextResponse.json(
                { success: false, error: "Missing tenantId" },
                { status: 400 }
            );
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        // Upsert TenantSSO
        await pool.query(
            `INSERT INTO TenantSSO (tenant_id, workos_org_id, workos_connection_id, domain, enabled)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                workos_org_id = VALUES(workos_org_id),
                workos_connection_id = VALUES(workos_connection_id),
                domain = VALUES(domain),
                enabled = VALUES(enabled),
                updated_at = CURRENT_TIMESTAMP`,
            [
                tenantId,
                workos_org_id || null,
                workos_connection_id || null,
                domain || null,
                enabled ? 1 : 0,
            ]
        );

        return NextResponse.json({
            success: true,
            message: "SSO config updated",
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json(
                { success: false, error: errorMessage(err) },
                { status: errorStatus(err) }
            );
        }
        console.error("Admin SSO PUT error:", err);
        return NextResponse.json(
            { success: false, error: errorMessage(err) || "Error updating SSO config" },
            { status: 500 }
        );
    }
}
