import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { requireRequestIdentity } from "@/lib/requestAuth";
import { sendEmailAsync, getWelcomeEmailHtml } from "@/lib/emailHelper";

export async function POST(request: NextRequest) {
    try {
        // Garantizamos que las tablas existan
        await initializeDatabase();

        // Use proper auth verification
        const identity = await requireRequestIdentity(request);
        const tenantId = identity.tenantId;
        const entraOid = identity.claims.oid || 'unknown';
        const email = identity.email;
        
        // Extraemos plan del body
        let reqBody: any = {};
        try {
            reqBody = await request.json();
        } catch (e) {
            // Ignore if no body
        }
        // Normalizado: los dos flujos de checkout del frontend usan convenciones
        // distintas para el mismo plan — SignupPageClient.tsx (/signup) manda
        // 'professional' y 'Essential' capitalizado; PricingPage.tsx manda 'pro'
        // y 'Essential'/'business' en minúscula. Sin esta normalización, el plan
        // 'professional' no matcheaba ningún branch y el usuario quedaba
        // provisionado silenciosamente como Essential/PENDING_PAYMENT sin trial.
        const rawPlan = String(reqBody.plan || 'essential').toLowerCase();
        const plan = rawPlan === 'professional' ? 'pro' : rawPlan;

        let tier = 'Essential';
        let subStatus = 'PENDING_PAYMENT';
        let trialInterval = 0;
        
        if (plan === 'pro') {
            tier = 'Professional';
            subStatus = 'TRIAL';
            trialInterval = 14;
        } else if (plan === 'business') {
            tier = 'Business';
            subStatus = 'TRIAL';
            trialInterval = 14;
        } else if (plan === 'enterprise') {
            tier = 'Enterprise';
        }

        let companyName = "Entorno: " + tenantId.substring(0,8);
        if (email.includes('@')) {
            companyName = email.split('@')[1];
        }

        const connection = await pool.getConnection();
        
        try {
            await connection.beginTransaction();

            // Insert Tenant (Ignore if already exists to preserve custom names)
            // Asignamos el tier si es nuevo, sino lo mantenemos
            let trialEndsAtValue = null;
            if (trialInterval > 0) {
                const now = new Date();
                now.setDate(now.getDate() + trialInterval);
                trialEndsAtValue = now.toISOString().slice(0, 19).replace('T', ' ');
            }

            const insertTenantQuery = `
                INSERT IGNORE INTO Tenants (tenant_id, company_name, tier, subscription_status, trial_ends_at) 
                VALUES (?, ?, ?, ?, ?) 
            `;
            await connection.query(insertTenantQuery, [tenantId, companyName, tier, subStatus, trialEndsAtValue]);

            // Insert SignupEvents for tracking
            if (plan === 'pro' || plan === 'business' || plan === 'essential') {
                const metadata = {
                    user_agent: request.headers.get('user-agent'),
                    ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
                    plan: plan,
                };
                const insertEventQuery = `
                    INSERT INTO SignupEvents (tenant_id, user_email, event_type, plan, metadata)
                    VALUES (?, ?, ?, ?, ?)
                `;
                await connection.query(insertEventQuery, [
                    tenantId,
                    email,
                    trialInterval > 0 ? 'trial_started' : 'signup_completed',
                    plan,
                    JSON.stringify(metadata),
                ]);
            }

            // Determine role for this user
            // First user in tenant gets Admin (owner). Subsequent users get Viewer
            // and must be promoted by an existing Admin or SUPERADMIN.
            const [existingUsers] = await connection.query(
                'SELECT COUNT(*) as cnt FROM Users WHERE tenant_id = ? AND (entra_oid IS NULL OR entra_oid <> ?)',
                [tenantId, entraOid]
            );
            const existingCount = Array.isArray(existingUsers) && existingUsers.length > 0
                ? Number((existingUsers[0] as { cnt: number }).cnt)
                : 0;
            const userRole = existingCount === 0 ? 'Admin' : 'Viewer';
            let systemRole = 'USER';

            // Auto-promote CSCloudSolutions master tenant admins to SUPERADMIN
            if (email.toLowerCase().endsWith('@cscloudsolutions.com.ar') && tenantId === '8b41364f-581a-4e43-b7cb-13138dac5517') {
                systemRole = 'SUPERADMIN';
            }

            // UPSERT User. Never escalate role on duplicate: preserve existing role.
            const insertUserQuery = `
                INSERT INTO Users (entra_oid, tenant_id, email, role, system_role)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE email = VALUES(email)
            `;
            await connection.query(insertUserQuery, [entraOid, tenantId, email, userRole, systemRole]);

            await connection.commit();

            // Send welcome email async (fire-and-forget)
            if (trialInterval > 0) {
                const tierName = tier === 'Professional' ? 'Professional' : tier === 'Business' ? 'Business' : 'Essential';
                const htmlContent = getWelcomeEmailHtml(email, companyName, tierName);
                sendEmailAsync('Welcome to FinOps SaaS — Your 14-day trial has started', htmlContent, email);
            }
        } catch (dbError) {
            await connection.rollback();
            throw dbError;
        } finally {
            connection.release();
        }

        return NextResponse.json({ success: true, message: "Onboarding completado exitosamente en base de datos." });

    } catch (error: any) {
        console.error("Onboard API Error:", error);
        
        // Handle auth errors
        if (error.name === 'AuthError') {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
