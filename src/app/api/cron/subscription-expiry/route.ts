import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { sendEmailAsync, getSubscriptionEndedEmailHtml } from "@/lib/emailHelper";
import { serverError } from '@/lib/apiErrors';

/**
 * Cron: revoca acceso a tenants CANCELED cuyo período ya pagado
 * (access_until, seteado desde /api/webhooks/paddle vía Paddle
 * current_billing_period.ends_at) ya pasó.
 *
 * No revocamos acceso en el momento de la cancelación (eso dejaría al
 * cliente sin servicio por el resto de un período que ya pagó) — este job
 * es el que efectivamente corta el acceso, pasando el tenant a EXPIRED.
 * ClientShell.tsx ya redirige a /upgrade para subscription_status=EXPIRED
 * (mismo mecanismo que usa el vencimiento de trials), así que no hace
 * falta tocar el gate de acceso: alcanza con este cambio de estado.
 *
 * Mismo contrato de auth (CRON_SECRET) que /api/cron/trial-expiry.
 */
export async function GET(request: NextRequest) {
    try {
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
            const [expired] = await connection.query(
                `SELECT t.tenant_id, t.company_name, u.email, t.access_until
                 FROM Tenants t
                 LEFT JOIN Users u ON t.tenant_id = u.tenant_id AND u.role IN ('Admin','Owner')
                 WHERE t.subscription_status = 'CANCELED'
                   AND t.access_until IS NOT NULL
                   AND t.access_until < NOW()
                 LIMIT 100`
            ) as any;

            let expiredCount = 0;
            for (const tenant of expired) {
                await connection.query(
                    "UPDATE Tenants SET subscription_status = 'EXPIRED' WHERE tenant_id = ?",
                    [tenant.tenant_id]
                );

                await connection.query(
                    `INSERT INTO SignupEvents (tenant_id, user_email, event_type, metadata)
                     VALUES (?, ?, 'subscription_access_ended', ?)`,
                    [tenant.tenant_id, tenant.email, JSON.stringify({
                        access_until: tenant.access_until,
                        timestamp: new Date().toISOString()
                    })]
                );

                if (tenant.email) {
                    sendEmailAsync('Tu acceso a FinOps SaaS finalizó', getSubscriptionEndedEmailHtml(), tenant.email);
                }

                expiredCount++;
            }

            return NextResponse.json({
                success: true,
                processed: expiredCount,
                expired: expiredCount,
            });
        } finally {
            connection.release();
        }
    } catch (error: any) {
        console.error("Subscription Expiry Cron Error:", error);
        return serverError(error, { message: "Internal Server Error", status: 500 });
    }
}
