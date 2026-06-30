import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { requireTenantAccess } from "@/lib/requestAuth";

export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();

        const identity = await requireTenantAccess(request, "");
        const tenantId = identity.tenantId;
        const email = identity.email;

        const connection = await pool.getConnection();
        
        try {
            await connection.beginTransaction();

            // Update Tenant to mark as onboarded
            await connection.query(
                'UPDATE Tenants SET is_onboarded = TRUE WHERE tenant_id = ?',
                [tenantId]
            );

            // Insert SignupEvents for onboarding_completed
            await connection.query(
                `INSERT INTO SignupEvents (tenant_id, user_email, event_type, metadata)
                 VALUES (?, ?, 'onboarding_completed', ?)`,
                [tenantId, email, JSON.stringify({ timestamp: new Date().toISOString() })]
            );

            await connection.commit();
        } catch (dbError) {
            await connection.rollback();
            throw dbError;
        } finally {
            connection.release();
        }

        return NextResponse.json({ success: true, message: "Onboarding marked as complete." });
    } catch (error: any) {
        console.error("Onboard Complete API Error:", error);
        
        if (error.name === 'AuthError') {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        
        return NextResponse.json({ error: "Internal Server Error", details: error.message }, { status: 500 });
    }
}
