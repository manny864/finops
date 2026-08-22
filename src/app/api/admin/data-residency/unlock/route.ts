import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId } = body;

        if (!tenantId) {
            return NextResponse.json(
                { error: "tenantId required" },
                { status: 400 }
            );
        }

        const identity = await requireSuperAdmin(request);

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [checkRows]: any = await connection.query(
                "SELECT data_residency FROM Tenants WHERE tenant_id = ? FOR UPDATE",
                [tenantId]
            );

            if (!checkRows || checkRows.length === 0) {
                await connection.rollback();
                return NextResponse.json(
                    { error: "Tenant not found" },
                    { status: 404 }
                );
            }

            await connection.query(
                "UPDATE Tenants SET data_residency_locked_at = NULL WHERE tenant_id = ?",
                [tenantId]
            );

            await connection.query(
                `INSERT INTO ActionLogs (tenant_id, user_email, action_type, resource_id, status, timestamp)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [tenantId, identity.email || "system", "DATA_RESIDENCY_UNLOCKED", tenantId, "SUCCESS"]
            );

            await connection.commit();

            return NextResponse.json({
                success: true,
                message: "Data residency region unlocked",
            });
        } catch (txErr) {
            await connection.rollback();
            throw txErr;
        } finally {
            connection.release();
        }
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
        }
        console.error("POST /api/admin/data-residency/unlock error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
