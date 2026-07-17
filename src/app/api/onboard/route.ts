import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { requireRequestIdentity } from "@/lib/requestAuth";
import { sendEmailAsync, getWelcomeEmailHtml, getInternalSignupAlertEmailHtml } from "@/lib/emailHelper";
import { getUserLimit } from "@/lib/tierLogic";
import { SUPERADMIN_BOOTSTRAP_TENANT_ID } from "@/lib/superAdminBootstrap";

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

        if (plan === 'essential') {
            subStatus = 'TRIAL';
            trialInterval = 7;
        } else if (plan === 'pro') {
            tier = 'Professional';
            subStatus = 'TRIAL';
            trialInterval = 7;
        } else if (plan === 'business') {
            tier = 'Business';
            subStatus = 'TRIAL';
            trialInterval = 7;
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

            // Defaults de IA para tenants nuevos (Configuración de IA Global,
            // Super Admin) — cada tenant puede después ajustarlos en su propia
            // Configuración de IA. Si no hay override global, se usan los
            // mismos defaults que la columna (medium/true/true).
            const [aiDefaultRows] = await connection.query(
                `SELECT setting_key, setting_value FROM GlobalSettings
                 WHERE setting_key IN ('ai_anomaly_sensitivity', 'ai_share_resource_names', 'ai_share_tags')`
            );
            const aiDefaults: Record<string, string> = {};
            for (const row of aiDefaultRows as any[]) aiDefaults[row.setting_key] = row.setting_value;
            const defaultSensitivity = aiDefaults.ai_anomaly_sensitivity || 'medium';
            const defaultShareResourceNames = aiDefaults.ai_share_resource_names !== 'false';
            const defaultShareTags = aiDefaults.ai_share_tags !== 'false';

            const insertTenantQuery = `
                INSERT IGNORE INTO Tenants (tenant_id, company_name, tier, subscription_status, trial_ends_at, ai_anomaly_sensitivity, ai_share_resource_names, ai_share_tags)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;
            await connection.query(insertTenantQuery, [tenantId, companyName, tier, subStatus, trialEndsAtValue, defaultSensitivity, defaultShareResourceNames, defaultShareTags]);

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
            if (email.toLowerCase().endsWith('@cscloudsolutions.com.ar') && tenantId === SUPERADMIN_BOOTSTRAP_TENANT_ID) {
                systemRole = 'SUPERADMIN';
            }

            // Límite de usuarios por plan (Essential=1, Professional=5,
            // Business=20, Enterprise=sin límite). Solo bloquea altas
            // NUEVAS — un usuario ya provisionado (mismo entra_oid) siempre
            // puede seguir logueándose aunque el tenant esté hoy en o sobre
            // el límite (p. ej. después de un downgrade).
            const [isNewUserRows] = await connection.query(
                'SELECT 1 FROM Users WHERE tenant_id = ? AND entra_oid = ? LIMIT 1',
                [tenantId, entraOid]
            );
            const isNewUser = !Array.isArray(isNewUserRows) || isNewUserRows.length === 0;

            if (isNewUser && systemRole !== 'SUPERADMIN') {
                const [tenantTierRows] = await connection.query(
                    'SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1',
                    [tenantId]
                );
                const currentTier = (Array.isArray(tenantTierRows) && tenantTierRows.length > 0)
                    ? String((tenantTierRows[0] as { tier?: string }).tier || 'Essential')
                    : 'Essential';
                const userLimit = getUserLimit(currentTier);
                // existingCount ya excluye a este usuario (entra_oid <> ?), así que
                // agregarlo llevaría el total a existingCount + 1.
                if (Number.isFinite(userLimit) && existingCount + 1 > userLimit) {
                    await connection.rollback();
                    return NextResponse.json({
                        error: `Tu organización alcanzó el límite de usuarios del plan ${currentTier} (${userLimit}). Pedile a un administrador que libere un usuario o actualice el plan para agregar más.`,
                    }, { status: 403 });
                }
            }

            // UPSERT User. Never escalate role on duplicate: preserve existing role.
            const insertUserQuery = `
                INSERT INTO Users (entra_oid, tenant_id, email, role, system_role)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE email = VALUES(email)
            `;
            await connection.query(insertUserQuery, [entraOid, tenantId, email, userRole, systemRole]);

            await connection.commit();

            // Send welcome email async (fire-and-forget) — SOLO en el signup real
            // del usuario (primera vez que se crea su fila en Users), no en cada
            // login. Este endpoint se llama en /api/onboard en cada LOGIN_SUCCESS
            // de MSAL (ver AuthProvider.tsx), así que sin el guard `isNewUser` el
            // email se reenviaba cada vez que el usuario iniciaba sesión.
            if (trialInterval > 0 && isNewUser) {
                const tierName = tier === 'Professional' ? 'Professional' : tier === 'Business' ? 'Business' : 'Essential';
                const htmlContent = getWelcomeEmailHtml(email, companyName, tierName);
                sendEmailAsync('Welcome to FinOps SaaS — Your 7-day trial has started', htmlContent, email);

                // Alerta interna paralela a soporte@ — solo cuando se completa un
                // signup real (nuevo tenant/usuario con trial), no en cada login.
                const internalHtml = getInternalSignupAlertEmailHtml({
                    tenantId,
                    companyName,
                    tier: tierName,
                    userEmail: email,
                    trialEndsAt: trialEndsAtValue,
                });
                sendEmailAsync(`Nuevo signup: ${companyName} (${tierName})`, internalHtml, 'soporte@cscloudsolutions.com.ar');
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
