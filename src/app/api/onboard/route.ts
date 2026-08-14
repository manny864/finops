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
        // 'professional' y PricingPage.tsx manda 'pro'/'business' en minúscula.
        // Sin esta normalización, el plan 'professional' no matcheaba ningún
        // branch y el usuario quedaba provisionado silenciosamente como
        // Professional/PENDING_PAYMENT sin trial.
        // INTENCIÓN DE CHECKOUT vs LOGIN COMÚN.
        //
        // Este endpoint se llama en CADA LOGIN_SUCCESS de MSAL (ver AuthProvider.tsx),
        // no sólo al contratar. El cliente manda `plan` desde
        // sessionStorage['pendingUpgrade'], que se setea al elegir un plan en la
        // pantalla de precios; en un login común viene null.
        //
        // El `|| 'professional'` de antes (con valor 'essential') convertía ese
        // null en un plan real, así que cualquier login creaba un tenant. Ahora
        // null significa lo que significa: "vengo a entrar, no a contratar" — y
        // sin fila previa no se crea nada.
        const requestedPlan = reqBody.plan ? String(reqBody.plan).toLowerCase() : null;
        const isCheckoutIntent = requestedPlan !== null;
        const rawPlan = requestedPlan || 'professional';
        // 'essential' es alias legacy (tier descontinuado, ver migrations/): un
        // valor viejo cacheado en sessionStorage['pendingUpgrade'] cae acá en
        // vez de romper el plan.
        const plan = rawPlan === 'professional' || rawPlan === 'essential' ? 'pro' : rawPlan;

        // Un login común sobre una organización que no tiene suscripción NO crea el
        // tenant. Los únicos caminos de alta son: checkout (este endpoint con plan
        // explícito, que además nace en PENDING_PAYMENT hasta que Paddle confirma),
        // pago del Marketplace de Azure (su webhook), o alta explícita de un
        // SuperAdmin. Para un tenant que ya existe esto no cambia nada.
        if (!isCheckoutIntent) {
            const [existing] = await pool.query<any[]>(
                'SELECT 1 FROM Tenants WHERE tenant_id = ? LIMIT 1',
                [tenantId]
            );
            if (!existing || existing.length === 0) {
                console.log(`[onboard] login sin suscripción para tenant ${tenantId} — no se crea tenant`);
                return NextResponse.json(
                    {
                        success: false,
                        error: 'Esta organización no tiene una suscripción activa. Contratá un plan para comenzar.',
                        needsSubscription: true,
                    },
                    { status: 403 }
                );
            }
        }

        // EL TRIAL NO SE OTORGA ACÁ — SE OTORGA AL PASAR POR EL CHECKOUT.
        //
        // Antes este endpoint escribía subscription_status = 'TRIAL' con 7 días de
        // trial_ends_at calculados localmente, según el `plan` que mandaba el
        // CLIENTE en el body. O sea: cualquier usuario autenticado se auto-otorgaba
        // un trial (y podía pedir 'business') sin pasar nunca por Paddle.
        //
        // Ahora la fila nace en PENDING_PAYMENT, que verifySubscription() NO
        // considera acceso válido (sólo ACTIVE y TRIAL lo son, ver
        // src/lib/apiSecurity.ts). Quien promueve el tenant es el webhook de Paddle
        // en subscription.created: mapea status 'trialing' → 'TRIAL' y guarda el
        // trial_ends_at que informa Paddle, que es la fuente autoritativa.
        //
        // POR QUÉ SE SIGUE CREANDO LA FILA. El webhook de Paddle sólo hace UPDATE,
        // nunca INSERT: necesita que el tenant exista para poder promoverlo, y el
        // checkout se abre con custom_data.tenant_id. Así que la fila tiene que
        // existir ANTES del checkout — pero inerte. Un tenant en PENDING_PAYMENT no
        // da acceso a nada.
        //
        // El `plan` del cliente se conserva sólo como intención declarada (qué
        // eligió en la pantalla de precios, útil para el funnel y para prellenar el
        // checkout). El tier efectivo lo resuelve el webhook desde el priceId /
        // custom_data, no desde este parámetro.
        const subStatus = 'PENDING_PAYMENT';
        const trialInterval = 0;

        let tier = 'Professional';
        if (plan === 'pro') {
            tier = 'Professional';
        } else if (plan === 'business') {
            tier = 'Business';
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
            // trial_ends_at queda NULL a propósito: lo escribe el webhook de Paddle
            // con la fecha que informa Paddle al confirmar el checkout. Calcularlo
            // acá era lo que permitía auto-otorgarse un trial de 7 días.
            const trialEndsAtValue = null;

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
            if (plan === 'pro' || plan === 'business') {
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

            // Determine role for this user.
            // El PRIMER usuario del tenant es su creador -> Owner (dueño del
            // tenant: acceso completo, incluye cambio de plan y facturación —
            // ver jerarquía Reader < Colaborador < Admin < Owner en el manual
            // de usuario y docs/roles-y-permisos.md). Los usuarios siguientes
            // entran como Reader (solo lectura) y un Admin/Owner los promueve
            // desde /admin/users. (Antes el creador quedaba Admin y nadie
            // recibía nunca Owner, aunque medio código ya lo chequeaba.)
            const [existingUsers] = await connection.query(
                'SELECT COUNT(*) as cnt FROM Users WHERE tenant_id = ? AND (entra_oid IS NULL OR entra_oid <> ?)',
                [tenantId, entraOid]
            );
            const existingCount = Array.isArray(existingUsers) && existingUsers.length > 0
                ? Number((existingUsers[0] as { cnt: number }).cnt)
                : 0;
            const userRole = existingCount === 0 ? 'Owner' : 'Reader';
            let systemRole = 'USER';

            // Auto-promote CSCloudSolutions master tenant admins to SUPERADMIN
            if (email.toLowerCase().endsWith('@cscloudsolutions.com.ar') && tenantId === SUPERADMIN_BOOTSTRAP_TENANT_ID) {
                systemRole = 'SUPERADMIN';
            }

            // Límite de usuarios por plan (Professional=5,
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
                    ? String((tenantTierRows[0] as { tier?: string }).tier || 'Professional')
                    : 'Professional';
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
                const tierName = tier === 'Professional' ? 'Professional' : tier === 'Business' ? 'Business' : 'Professional';
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
