import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { recordTenantLifecycleTransition } from "@/services/tenantLifecycle.service";
import { sendEmailAsync, getTrialReminderEmailHtml, getTrialExpiredEmailHtml } from "@/lib/emailHelper";
import { serverError } from '@/lib/apiErrors';

export async function GET(request: NextRequest) {
    try {
        // Verify cron secret via header (not query string, which leaks via proxies/logs)
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            console.error('CRON_SECRET not configured or too short');
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        await initializeDatabase();

        const connection = await pool.getConnection();
        
        try {
            // Find expired trials
            const [expiredTrials] = await connection.query(
                `SELECT t.tenant_id, t.company_name, u.email, t.trial_ends_at
                 FROM Tenants t
                 LEFT JOIN Users u ON t.tenant_id = u.tenant_id AND u.role IN ('Admin','Owner')
                 WHERE t.subscription_status = 'TRIAL' AND t.trial_ends_at < NOW()
                 LIMIT 100`
            ) as any;

            let expiredCount = 0;
            for (const tenant of expiredTrials) {
                // Update status to EXPIRED
                // MEJ-12: un trial que vence sin convertir también es churn.
                await recordTenantLifecycleTransition(tenant.tenant_id, 'EXPIRED', {
                    actor: 'cron-trial-expiry',
                    reason: 'contract_expired',
                });

                // Insert SignupEvents
                await connection.query(
                    `INSERT INTO SignupEvents (tenant_id, user_email, event_type, metadata)
                     VALUES (?, ?, 'trial_expired', ?)`,
                    [tenant.tenant_id, tenant.email, JSON.stringify({ 
                        trial_ends_at: tenant.trial_ends_at,
                        timestamp: new Date().toISOString()
                    })]
                );

                // Send email
                if (tenant.email) {
                    const htmlContent = getTrialExpiredEmailHtml();
                    sendEmailAsync('Your FinOps SaaS trial has ended', htmlContent, tenant.email);
                }

                expiredCount++;
            }

            // Find trials ending in 2 days (for reminder email)
            const [reminderTrials] = await connection.query(
                `SELECT t.tenant_id, t.company_name, u.email, t.trial_ends_at, t.last_trial_reminder_at
                 FROM Tenants t
                 LEFT JOIN Users u ON t.tenant_id = u.tenant_id AND u.role IN ('Admin','Owner')
                 WHERE t.subscription_status = 'TRIAL'
                   AND t.trial_ends_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 2 DAY)
                   AND (t.last_trial_reminder_at IS NULL OR t.last_trial_reminder_at < DATE_SUB(NOW(), INTERVAL 24 HOUR))
                 LIMIT 100`
            ) as any;

            let reminderCount = 0;
            for (const tenant of reminderTrials) {
                // Calculate days left
                const now = new Date();
                const endDate = new Date(tenant.trial_ends_at);
                const diffTime = endDate.getTime() - now.getTime();
                const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                // Send reminder email
                if (tenant.email && daysLeft > 0) {
                    const htmlContent = getTrialReminderEmailHtml(daysLeft);
                    sendEmailAsync(`Only ${daysLeft} day(s) left in your FinOps trial!`, htmlContent, tenant.email);
                }

                // Update last_trial_reminder_at
                await connection.query(
                    'UPDATE Tenants SET last_trial_reminder_at = NOW() WHERE tenant_id = ?',
                    [tenant.tenant_id]
                );

                reminderCount++;
            }

            return NextResponse.json({ 
                success: true,
                processed: expiredCount + reminderCount,
                expired: expiredCount,
                reminded: reminderCount
            });

        } finally {
            connection.release();
        }

    } catch (error) {
        console.error("Trial Expiry Cron Error:", error);
        return serverError(error, { message: "Internal Server Error", status: 500 });
    }
}
