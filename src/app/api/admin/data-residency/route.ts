import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess, requireTenantRole } from "@/lib/requestAuth";

const VALID_REGIONS = ["EU", "US", "LATAM", "APAC", "GLOBAL"];

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json(
                { error: "tenantId query parameter required" },
                { status: 400 }
            );
        }

        await requireTenantAccess(request, tenantId);

        const [rows]: any = await pool.query(
            "SELECT data_residency, data_residency_locked_at FROM Tenants WHERE tenant_id = ?",
            [tenantId]
        );

        if (!rows || rows.length === 0) {
            return NextResponse.json(
                { error: "Tenant not found" },
                { status: 404 }
            );
        }

        const { data_residency: region, data_residency_locked_at: locked_at } = rows[0];

        return NextResponse.json({
            region: region || "GLOBAL",
            locked_at,
            can_change: !locked_at,
            available_regions: VALID_REGIONS,
        });
    } catch (err: any) {
        if (err instanceof AuthError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        console.error("GET /api/admin/data-residency error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const shouldLock = searchParams.get("lock") === "true";

        const body = await request.json();
        const { tenantId, region, reason } = body;

        if (!tenantId || !region) {
            return NextResponse.json(
                { error: "tenantId and region required" },
                { status: 400 }
            );
        }

        if (!VALID_REGIONS.includes(region)) {
            return NextResponse.json(
                { error: `Invalid region. Must be one of: ${VALID_REGIONS.join(", ")}` },
                { status: 400 }
            );
        }

        // Require OWNER role for the tenant
        const identity = await requireTenantRole(request, tenantId, ["Admin", "OWNER"]);

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // Check if region is locked
            const [checkRows]: any = await connection.query(
                "SELECT data_residency, data_residency_locked_at FROM Tenants WHERE tenant_id = ? FOR UPDATE",
                [tenantId]
            );

            if (!checkRows || checkRows.length === 0) {
                await connection.rollback();
                return NextResponse.json(
                    { error: "Tenant not found" },
                    { status: 404 }
                );
            }

            const { data_residency: currentRegion, data_residency_locked_at } = checkRows[0];

            if (data_residency_locked_at) {
                await connection.rollback();
                return NextResponse.json(
                    { error: "Region locked. Contact support." },
                    { status: 423 }
                );
            }

            // Update tenant data_residency
            await connection.query(
                "UPDATE Tenants SET data_residency = ? WHERE tenant_id = ?",
                [region, tenantId]
            );

            // Insert into DataResidencyChanges audit log
            await connection.query(
                `INSERT INTO DataResidencyChanges (tenant_id, changed_by, from_region, to_region, reason)
                 VALUES (?, ?, ?, ?, ?)`,
                [tenantId, identity.email || identity.claims.oid || "unknown", currentRegion || "GLOBAL", region, reason || null]
            );

            // Insert into ActionLogs
            await connection.query(
                `INSERT INTO ActionLogs (tenant_id, user_email, action_type, resource_id, status, timestamp)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [tenantId, identity.email || "system", "DATA_RESIDENCY_CHANGED", tenantId, "SUCCESS"]
            );

            // Optionally lock the region
            if (shouldLock) {
                await connection.query(
                    "UPDATE Tenants SET data_residency_locked_at = NOW() WHERE tenant_id = ?",
                    [tenantId]
                );
            }

            await connection.commit();

            return NextResponse.json({
                success: true,
                message: `Data residency changed to ${region}${shouldLock ? " and locked" : ""}`,
                region,
                locked: shouldLock,
            });
        } catch (txErr) {
            await connection.rollback();
            throw txErr;
        } finally {
            connection.release();
        }
    } catch (err: any) {
        if (err instanceof AuthError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        console.error("PUT /api/admin/data-residency error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
