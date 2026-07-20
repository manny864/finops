import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { requireSuperAdmin } from "@/lib/requestAuth";
import { serverError } from '@/lib/apiErrors';

export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();

        // Verify superadmin access
        const identity = await requireSuperAdmin(request);
        const adminEmail = identity.email;

        const body = await request.json() as any;
        const { tenantId, days } = body;

        if (!tenantId || !days || days <= 0) {
            return NextResponse.json(
                { error: "Invalid request. tenantId and days (>0) are required." },
                { status: 400 }
            );
        }

        if (days > 365) {
            return NextResponse.json(
                { error: "Cannot extend trial by more than 365 days." },
                { status: 400 }
            );
        }

        const connection = await pool.getConnection();
        
        try {
            await connection.beginTransaction();

            // Get current tenant status
            const [tenants] = await connection.query(
                'SELECT subscription_status, trial_ends_at FROM Tenants WHERE tenant_id = ? LIMIT 1',
                [tenantId]
            ) as any;

            if (!tenants || tenants.length === 0) {
                // Sin rollback acá, la transacción quedaba abierta cuando la
                // conexión volvía al pool (finally sólo hace release, no commit
                // ni rollback) — el próximo request que tomara esa conexión
                // heredaba una transacción huérfana.
                await connection.rollback();
                return NextResponse.json(
                    { error: "Tenant not found" },
                    { status: 404 }
                );
            }

            const tenant = tenants[0];
            const wasExpired = tenant.subscription_status === 'EXPIRED';

            // Calculate new trial_ends_at
            let newTrialEndsAt: string;
            if (wasExpired || !tenant.trial_ends_at) {
                // If expired or no previous trial, set to now + days
                const now = new Date();
                now.setDate(now.getDate() + days);
                newTrialEndsAt = now.toISOString().slice(0, 19).replace('T', ' ');
            } else {
                // Otherwise, add days to existing trial_ends_at
                const endDate = new Date(tenant.trial_ends_at);
                endDate.setDate(endDate.getDate() + days);
                newTrialEndsAt = endDate.toISOString().slice(0, 19).replace('T', ' ');
            }

            // Update trial_ends_at and status if was expired
            const newStatus = wasExpired ? 'TRIAL' : tenant.subscription_status;
            await connection.query(
                'UPDATE Tenants SET trial_ends_at = ?, subscription_status = ? WHERE tenant_id = ?',
                [newTrialEndsAt, newStatus, tenantId]
            );

            // Get user email from Users table
            const [users] = await connection.query(
                'SELECT email FROM Users WHERE tenant_id = ? AND role IN ("Admin","Owner") LIMIT 1',
                [tenantId]
            ) as any;
            const userEmail = users && users.length > 0 ? users[0].email : 'unknown';

            // Insert SignupEvents
            await connection.query(
                `INSERT INTO SignupEvents (tenant_id, user_email, event_type, metadata)
                 VALUES (?, ?, 'trial_extended', ?)`,
                [tenantId, userEmail, JSON.stringify({
                    days: days,
                    admin_email: adminEmail,
                    was_expired: wasExpired,
                    new_trial_ends_at: newTrialEndsAt,
                    timestamp: new Date().toISOString()
                })]
            );

            await connection.commit();

            return NextResponse.json({
                success: true,
                message: `Trial extended by ${days} days`,
                tenant_id: tenantId,
                new_trial_ends_at: newTrialEndsAt,
                was_expired: wasExpired,
                status_changed: wasExpired ? 'EXPIRED -> TRIAL' : 'no change'
            });

        } catch (dbError) {
            await connection.rollback();
            throw dbError;
        } finally {
            connection.release();
        }

    } catch (error: any) {
        console.error("Extend Trial API Error:", error);
        
        if (error.name === 'AuthError') {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        
        return serverError(error, { message: "Internal Server Error", status: 500 });
    }
}
