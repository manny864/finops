import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { requireRequestIdentity } from "@/lib/requestAuth";
import { sendEmailAsync, getWelcomeEmailHtml, getInternalSignupAlertEmailHtml } from "@/lib/emailHelper";
import { altaDeMiembro } from "@/services/tenantMembership.service";
import { SUPERADMIN_BOOTSTRAP_TENANT_ID } from "@/lib/superAdminBootstrap";
import { atribuirReferido } from "@/services/affiliates.service";
import rateLimiter from "@/lib/rateLimiter";
import { readJsonCapped, BodyLimitError } from "@/lib/readJsonCapped";
import { trustedClientIp } from "@/lib/trustedClientIp";

/** PERIM-04: el cliente llama una vez por LOGIN_SUCCESS; 10/min sobra para uso legítimo. */
const ONBOARD_LIMIT_PER_MIN = 10;
/** El body legítimo es `{"plan": "..."}`. */
const ONBOARD_MAX_BODY_BYTES = 4 * 1024;
const MAX_PLAN_LENGTH = 32;

export async function POST(request: NextRequest) {
    try {
        // PERIM-04: identidad primero. Un JWT inválido no inicializa la base ni
        // consume cuota de nadie.
        const identity = await requireRequestIdentity(request);
        const tenantId = identity.tenantId;
        const entraOid = identity.claims.oid || 'unknown';
        const email = identity.email;

        // Cuota por identidad verificada (tenant del token + usuario), no por un
        // valor que el cliente pueda elegir.
        const quota = await rateLimiter.checkByKeyDistributed(
            `onboard:${tenantId}:${identity.claims.oid || email.toLowerCase()}`,
            ONBOARD_LIMIT_PER_MIN
        );
        if (!quota.allowed) {
            return NextResponse.json(
                { success: false, error: 'Demasiados intentos de registro. Esperá un minuto y volvé a intentar.' },
                { status: 429, headers: { 'Retry-After': '60' } }
            );
        }

        // Body opcional: sin body (o vacío) equivale a login común. Se lee con
        // tope; JSON roto sigue tratándose como "sin plan", como antes.
        let reqBody: Record<string, unknown> = {};
        if (request.body) {
            try {
                const parsed = await readJsonCapped(request, ONBOARD_MAX_BODY_BYTES);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    reqBody = parsed as Record<string, unknown>;
                }
            } catch (e) {
                if (e instanceof BodyLimitError && e.status === 413) {
                    return NextResponse.json({ success: false, error: 'Payload demasiado grande.' }, { status: 413 });
                }
            }
        }
        if (reqBody.plan != null && (typeof reqBody.plan !== 'string' || reqBody.plan.length > MAX_PLAN_LENGTH)) {
            return NextResponse.json({ success: false, error: 'Plan inválido.' }, { status: 400 });
        }

        // Garantizamos que las tablas existan (deduplicado por promesa y
        // recordado por proceso; sólo después de autenticar y admitir).
        await initializeDatabase();
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
        const requestedPlan = typeof reqBody.plan === 'string' && reqBody.plan ? reqBody.plan.toLowerCase() : null;
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
                    // Sólo la IP con contrato de proxy confiable (PERIM-05); XFF lo
                    // escribe el cliente y no sirve como dato de auditoría.
                    ip: trustedClientIp(request),
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

            // Alta del usuario: misma regla de admisión que usa el guard (`altaDeMiembro`): el primer usuario del
            // tenant queda Owner, los siguientes Reader (ver docs/roles-y-permisos.md), con el límite de usuarios del
            // plan sólo para altas NUEVAS y sin escalar el rol de quien ya existe.
            let systemRole = 'USER';
            // Auto-promote CSCloudSolutions master tenant admins to SUPERADMIN
            if (email.toLowerCase().endsWith('@cscloudsolutions.com.ar') && tenantId === SUPERADMIN_BOOTSTRAP_TENANT_ID) {
                systemRole = 'SUPERADMIN';
            }
            const alta = await altaDeMiembro(connection, { tenantId, entraOid, email }, { modo: 'login', systemRole });
            if (alta.resultado === 'sin-cupo') {
                await connection.rollback();
                return NextResponse.json({
                    error: `Tu organización alcanzó el límite de usuarios del plan ${alta.tier} (${alta.limite}). Pedile a un administrador que libere un usuario o actualice el plan para agregar más.`,
                }, { status: 403 });
            }
            if (alta.resultado !== 'creado' && alta.resultado !== 'existente') {
                // En modo login el tenant ya existe (se creó o se verificó arriba) y el primer usuario es Owner.
                throw new Error(`Alta de miembro imposible: ${alta.resultado}`);
            }
            const isNewUser = alta.esNuevo;

            // Atribucion del programa de afiliados. El codigo llega en la cookie
            // `affiliate_ref` que puso AffiliateTracker cuando el visitante entro
            // por un link `?ref=`.
            //
            // Va DESPUES del upsert de Users, no antes: el guard de auto-referido
            // consulta esa tabla, y en el primer alta la fila todavia no existia.
            // Ademas se le pasa el mail de la identidad que MSAL ya verifico, que
            // es lo unico no falsificable que tenemos en esta request.
            //
            // Es idempotente (uq_referral_tenant, primer toque gana), asi que
            // correr esto en cada LOGIN_SUCCESS no reasigna nada.
            const refCookie = request.cookies.get("affiliate_ref")?.value;
            if (refCookie) {
                const atribucion = await atribuirReferido(connection, tenantId, refCookie, email);
                if (!atribucion.atribuido && atribucion.motivo === "auto-referido") {
                    console.warn(`[affiliates] auto-referido rechazado para el tenant ${tenantId}`);
                }
            }

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
