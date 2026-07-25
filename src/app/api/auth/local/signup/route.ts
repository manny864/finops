import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import rateLimiter from "@/lib/rateLimiter";
import {
    createAuthToken,
    hashPassword,
    localEmailTaken,
    normalizeEmail,
    validatePasswordPolicy,
    buildAppUrl,
} from "@/lib/localAuth";
import { isLocalAuthConfigured } from "@/lib/localToken";
import {
    sendEmailAsync,
    getInternalSignupAlertEmailHtml,
    getVerifyEmailHtml,
} from "@/lib/emailHelper";

/**
 * Alta de tenant con identidad propia (sin Entra) — el camino de signup de los
 * clientes AWS. Ver docs/aws-multicloud-handoff.md §3.1.
 *
 * Diferencias con /api/onboard (el equivalente Entra):
 *  - NO requiere estar autenticado: es el punto de entrada anónimo.
 *  - Genera el `tenant_id` (UUID) en vez de tomarlo del claim `tid`.
 *  - Crea al usuario con `password_hash` y SIN `entra_oid`.
 *  - El usuario no puede loguearse hasta verificar el email.
 */

const PLAN_MAP: Record<string, { tier: string; subStatus: string; trialDays: number }> = {
    essential: { tier: "Essential", subStatus: "TRIAL", trialDays: 7 },
    pro: { tier: "Professional", subStatus: "TRIAL", trialDays: 7 },
    professional: { tier: "Professional", subStatus: "TRIAL", trialDays: 7 },
    business: { tier: "Business", subStatus: "TRIAL", trialDays: 7 },
    enterprise: { tier: "Enterprise", subStatus: "PENDING_PAYMENT", trialDays: 0 },
};

export async function POST(request: NextRequest) {
    if (!isLocalAuthConfigured()) {
        return NextResponse.json({ error: "El alta con email no está habilitada." }, { status: 503 });
    }

    // Rate limit por IP: 5 altas por hora. Sin esto, este endpoint crea filas
    // en Tenants y dispara emails sin ningún coste para el atacante.
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim()
        || request.headers.get("x-real-ip")
        || "unknown";
    const limit = await rateLimiter.checkByKeyDistributed(`signup-local:${ip}`, 5, 60 * 60 * 1000);
    if (!limit.allowed) {
        return NextResponse.json({ error: "Demasiados intentos. Probá de nuevo más tarde." }, { status: 429 });
    }

    let body: Record<string, unknown> = {};
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Body inválido." }, { status: 400 });
    }

    const email = normalizeEmail(String(body.email || ""));
    const password = String(body.password || "");
    const companyNameInput = String(body.companyName || "").trim();
    const rawPlan = String(body.plan || "essential").toLowerCase();
    const provider = String(body.provider || "aws").toLowerCase();

    if (!email.includes("@") || email.length > 255) {
        return NextResponse.json({ error: "Email inválido." }, { status: 400 });
    }
    const passwordError = validatePasswordPolicy(password);
    if (passwordError) {
        return NextResponse.json({ error: passwordError }, { status: 400 });
    }
    if (provider !== "aws" && provider !== "azure") {
        return NextResponse.json({ error: "Proveedor inválido." }, { status: 400 });
    }

    const plan = PLAN_MAP[rawPlan] || PLAN_MAP.essential;
    const companyName = companyNameInput || email.split("@")[1];

    await initializeDatabase();
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // Unicidad global del email local. Se chequea DENTRO de la transacción
        // porque hoy no hay UNIQUE KEY que lo respalde (ver el comentario
        // ponytail en migrations/20260725-004-local-auth.sql).
        if (await localEmailTaken(connection, email)) {
            await connection.rollback();
            // Mismo mensaje y mismo status que el camino feliz sería lo ideal
            // contra enumeración, pero acá el usuario necesita saber que ya
            // tiene cuenta para poder recuperarla. Es el trade-off estándar
            // en signup (a diferencia del reset, donde sí se oculta).
            return NextResponse.json({ error: "Ese email ya tiene una cuenta." }, { status: 409 });
        }

        const tenantId = crypto.randomUUID();
        const trialEndsAt = plan.trialDays > 0
            ? new Date(Date.now() + plan.trialDays * 24 * 60 * 60 * 1000)
                .toISOString().slice(0, 19).replace("T", " ")
            : null;

        await connection.query(
            `INSERT INTO Tenants (tenant_id, company_name, tier, subscription_status, trial_ends_at, provider)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [tenantId, companyName, plan.tier, plan.subStatus, trialEndsAt, provider]
        );

        // Creador del tenant => Owner, igual que en /api/onboard.
        await connection.query(
            `INSERT INTO Users (entra_oid, tenant_id, email, role, system_role, password_hash)
             VALUES (NULL, ?, ?, 'Owner', 'USER', ?)`,
            [tenantId, email, await hashPassword(password)]
        );

        await connection.query(
            `INSERT INTO SignupEvents (tenant_id, user_email, event_type, plan, metadata)
             VALUES (?, ?, ?, ?, ?)`,
            [
                tenantId,
                email,
                plan.trialDays > 0 ? "trial_started" : "signup_completed",
                rawPlan,
                JSON.stringify({ ip, provider, auth: "local", user_agent: request.headers.get("user-agent") }),
            ]
        );

        const token = await createAuthToken(connection, tenantId, email, "verify_email");

        await connection.commit();

        const verifyUrl = buildAppUrl(`/verify-email?token=${encodeURIComponent(token)}`);
        sendEmailAsync("Confirmá tu email — CSCloudSolutions", getVerifyEmailHtml(verifyUrl), email);

        sendEmailAsync(
            `Nuevo signup (${provider.toUpperCase()}): ${companyName} (${plan.tier})`,
            getInternalSignupAlertEmailHtml({
                tenantId,
                companyName,
                tier: plan.tier,
                userEmail: email,
                trialEndsAt,
            }),
            "soporte@cscloudsolutions.com.ar"
        );

        // No se devuelve token de sesión: primero hay que verificar el email.
        return NextResponse.json({ ok: true, tenantId, verificationRequired: true }, { status: 201 });
    } catch (error) {
        await connection.rollback();
        console.error("[auth/local/signup]", error);
        return NextResponse.json({ error: "No se pudo crear la cuenta." }, { status: 500 });
    } finally {
        connection.release();
    }
}
