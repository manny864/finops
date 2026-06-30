import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { requireSuperAdmin } from "@/lib/requestAuth";

export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();

        // Verify superadmin access
        await requireSuperAdmin(request);

        const connection = await pool.getConnection();
        
        try {
            // Get KPIs
            const [signups30d] = await connection.query(
                `SELECT COUNT(DISTINCT tenant_id) as count
                 FROM SignupEvents
                 WHERE event_type IN ('signup_started', 'signup_completed', 'trial_started')
                   AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
                 LIMIT 1`
            ) as any;

            const [trialsActive] = await connection.query(
                `SELECT COUNT(DISTINCT tenant_id) as count
                 FROM Tenants
                 WHERE subscription_status = 'TRIAL' AND trial_ends_at > NOW()
                 LIMIT 1`
            ) as any;

            const [converted] = await connection.query(
                `SELECT COUNT(DISTINCT tenant_id) as count
                 FROM SignupEvents
                 WHERE event_type = 'converted_to_paid'
                   AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
                 LIMIT 1`
            ) as any;

            const signups30dCount = signups30d?.[0]?.count || 0;
            const trialsActiveCount = trialsActive?.[0]?.count || 0;
            const convertedCount = converted?.[0]?.count || 0;
            const conversionPct = signups30dCount > 0 ? ((convertedCount / signups30dCount) * 100).toFixed(2) : '0.00';

            // Get churn
            const [churned] = await connection.query(
                `SELECT COUNT(DISTINCT tenant_id) as count
                 FROM SignupEvents
                 WHERE event_type = 'churned'
                   AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
                 LIMIT 1`
            ) as any;
            const churnedCount = churned?.[0]?.count || 0;
            const churnPct = signups30dCount > 0 ? ((churnedCount / signups30dCount) * 100).toFixed(2) : '0.00';

            // Get funnel data
            const [funnelData] = await connection.query(
                `SELECT 
                    event_type,
                    COUNT(DISTINCT tenant_id) as count
                FROM SignupEvents
                WHERE event_type IN ('signup_started', 'trial_started', 'onboarding_completed', 'converted_to_paid')
                GROUP BY event_type
                ORDER BY FIELD(event_type, 'signup_started', 'trial_started', 'onboarding_completed', 'converted_to_paid')`
            ) as any;

            // Get recent signups
            const [recentSignups] = await connection.query(
                `SELECT 
                    se.tenant_id,
                    se.user_email,
                    se.plan,
                    t.subscription_status as status,
                    DATEDIFF(COALESCE(t.trial_ends_at, DATE_ADD(NOW(), INTERVAL 14 DAY)), NOW()) as trial_days_left,
                    se.created_at
                FROM SignupEvents se
                LEFT JOIN Tenants t ON se.tenant_id = t.tenant_id
                WHERE se.event_type IN ('trial_started', 'signup_completed')
                ORDER BY se.created_at DESC
                LIMIT 50`
            ) as any;

            return NextResponse.json({
                kpis: {
                    signups_30d: signups30dCount,
                    trials_active: trialsActiveCount,
                    converted: convertedCount,
                    conversion_pct: conversionPct,
                    churn_pct: churnPct,
                },
                funnel: funnelData.map((row: any) => ({
                    stage: row.event_type,
                    count: row.count,
                })),
                recent_signups: recentSignups.map((row: any) => ({
                    tenant_id: row.tenant_id,
                    email: row.user_email,
                    plan: row.plan,
                    status: row.status,
                    trial_days_left: row.trial_days_left || 0,
                    created_at: row.created_at,
                })),
            });

        } finally {
            connection.release();
        }

    } catch (error: any) {
        console.error("Funnel API Error:", error);
        
        if (error.name === 'AuthError') {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        
        return NextResponse.json({ error: "Internal Server Error", details: error.message }, { status: 500 });
    }
}
