import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { requireRequestIdentity, AuthError } from "@/lib/requestAuth";
import { serverError } from '@/lib/apiErrors';

export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();

        const identity = await requireRequestIdentity(request);
        const tenantId = identity.tenantId;
        const email = identity.email;

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // Ensure OnboardingProgress row exists and mark all non-skipped steps as completed
            await connection.query(
                `INSERT INTO OnboardingProgress (tenant_id) 
                 VALUES (?) 
                 ON DUPLICATE KEY UPDATE 
                    step_welcome = IF(step_welcome = 'skipped', 'skipped', 'completed'),
                    step_azure_sp = IF(step_azure_sp = 'skipped', 'skipped', 'completed'),
                    step_first_sync = IF(step_first_sync = 'skipped', 'skipped', 'completed'),
                    step_first_budget = IF(step_first_budget = 'skipped', 'skipped', 'completed'),
                    step_notifications = IF(step_notifications = 'skipped', 'skipped', 'completed'),
                    completed_at = NOW()`,
                [tenantId]
            );

            // Mark tenant as onboarded
            await connection.query(
                'UPDATE Tenants SET is_onboarded = TRUE WHERE tenant_id = ?',
                [tenantId]
            );

            // Fire SignupEvents onboarding_completed
            await connection.query(
                `INSERT INTO SignupEvents (tenant_id, user_email, event_type, metadata)
                 VALUES (?, ?, 'onboarding_completed', ?)`,
                [tenantId, email, JSON.stringify({ timestamp: new Date().toISOString() })]
            );

            await connection.commit();

            return NextResponse.json({ success: true, message: "Onboarding completed." });
        } catch (dbError) {
            await connection.rollback();
            throw dbError;
        } finally {
            connection.release();
        }
    } catch (error: any) {
        console.error("[Onboarding Finish API] Error:", error);
        if (error.name === "AuthError") {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        return serverError(error, { message: "Internal Server Error", status: 500 });
    }
}
