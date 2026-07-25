#!/usr/bin/env tsx
/**
 * Crea un tenant AWS con su usuario Owner ya verificado, para poder probar el
 * panel AWS en local sin depender del email de verificación.
 *
 * POR QUÉ EXISTE
 * --------------
 * El alta real (`POST /api/auth/local/signup`) deja al usuario en estado
 * "no verificado" y le manda un link por email. En local no hay SMTP
 * configurado, así que ese email no llega nunca y el usuario queda encerrado
 * fuera de su propia cuenta: se puede crear la cuenta pero no entrar. Este
 * script salta ese paso (y sólo ese) escribiendo `email_verified_at`.
 *
 * NO es un atajo de producción: se niega a correr con NODE_ENV=production
 * (ver assertNotProduction). Un script que crea un Owner con una contraseña
 * elegida por quien lo ejecuta es, literalmente, una puerta trasera; la única
 * razón por la que es aceptable acá es que la base es descartable.
 *
 * USO
 *   npm run seed:aws-tenant -- --email=demo@acme.test --password='una-larga-de-12+'
 *
 * Opciones:
 *   --email      (obligatoria)  Email del Owner.
 *   --password   (obligatoria)  Mínimo 12 caracteres (misma política que el signup real).
 *   --company    Nombre de la empresa. Default: el dominio del email.
 *   --tier       Essential | Professional | Business | Enterprise. Default: Enterprise.
 *   --provider   aws | azure | both. Default: aws. ('both' sólo tiene sentido en Enterprise.)
 *   --tenant-id  Reutilizar un tenant existente en vez de crear uno nuevo.
 *
 * Es idempotente por email: si el usuario ya existe, actualiza su contraseña y
 * lo deja verificado en vez de fallar. Así se puede correr de nuevo cuando uno
 * se olvidó qué contraseña había puesto.
 */
import crypto from "crypto";
import pool, { initializeDatabase } from "../src/modules/storage/db";
import { hashPassword, normalizeEmail, validatePasswordPolicy } from "../src/lib/localAuth";
import { tierAllowsMultiProvider } from "../src/lib/providerPolicy";

type Args = Record<string, string>;

function parseArgs(argv: string[]): Args {
    const args: Args = {};
    for (const raw of argv) {
        const match = /^--([^=]+)=?(.*)$/.exec(raw);
        if (match) args[match[1]] = match[2];
    }
    return args;
}

/**
 * El guard más importante del archivo. Sin esto, alguien con acceso al repo en
 * el VPS puede crear un Owner en el tenant que quiera con la contraseña que
 * quiera, sin dejar rastro en los logs de la app.
 */
function assertNotProduction(): void {
    if (process.env.NODE_ENV === "production") {
        console.error(
            "[seed-aws-tenant] ABORTADO: este script no corre en producción.\n" +
            "  Crea un Owner con una contraseña arbitraria y salta la verificación de email.\n" +
            "  En producción el alta se hace por /signup y los usuarios se agregan por invitación."
        );
        process.exit(1);
    }
}

const VALID_TIERS = ["Essential", "Professional", "Business", "Enterprise"] as const;
const VALID_PROVIDERS = ["aws", "azure", "both"] as const;

async function main() {
    assertNotProduction();

    const args = parseArgs(process.argv.slice(2));
    const email = normalizeEmail(args.email || "");
    const password = args.password || "";

    if (!email.includes("@")) {
        console.error("[seed-aws-tenant] Falta --email=alguien@dominio.test");
        process.exit(1);
    }
    const passwordError = validatePasswordPolicy(password);
    if (passwordError) {
        console.error(`[seed-aws-tenant] ${passwordError}`);
        console.error("  Uso: npm run seed:aws-tenant -- --email=demo@acme.test --password='...'");
        process.exit(1);
    }

    const tier = args.tier || "Enterprise";
    if (!VALID_TIERS.includes(tier as (typeof VALID_TIERS)[number])) {
        console.error(`[seed-aws-tenant] --tier inválido: ${tier}. Válidos: ${VALID_TIERS.join(", ")}`);
        process.exit(1);
    }

    const provider = (args.provider || "aws") as (typeof VALID_PROVIDERS)[number];
    if (!VALID_PROVIDERS.includes(provider)) {
        console.error(`[seed-aws-tenant] --provider inválido: ${provider}. Válidos: ${VALID_PROVIDERS.join(", ")}`);
        process.exit(1);
    }
    // Misma regla que el runtime: 'both' es una capability de Enterprise. Si el
    // seed pudiera saltearla, las pruebas locales pasarían con un estado que la
    // app nunca produce.
    if (provider === "both" && !tierAllowsMultiProvider(tier)) {
        console.error(`[seed-aws-tenant] provider='both' requiere tier Enterprise (recibido: ${tier}).`);
        process.exit(1);
    }

    const companyName = args.company || email.split("@")[1];

    await initializeDatabase();
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // Si el email ya existe, reutilizamos SU tenant: crear uno nuevo dejaría
        // al usuario apuntando a dos tenants y el login elegiría cualquiera.
        const [existingRows] = await connection.query(
            "SELECT id, tenant_id FROM Users WHERE email = ? LIMIT 1",
            [email]
        );
        const existing = (existingRows as Array<{ id: number; tenant_id: string }>)[0];

        let tenantId = args["tenant-id"] || existing?.tenant_id || crypto.randomUUID();
        let created = false;

        const [tenantRows] = await connection.query(
            "SELECT tenant_id FROM Tenants WHERE tenant_id = ? LIMIT 1",
            [tenantId]
        );
        if ((tenantRows as unknown[]).length === 0) {
            await connection.query(
                `INSERT INTO Tenants (tenant_id, company_name, tier, subscription_status, provider)
                 VALUES (?, ?, ?, 'ACTIVE', ?)`,
                [tenantId, companyName, tier, provider]
            );
            created = true;
        } else {
            await connection.query(
                "UPDATE Tenants SET tier = ?, provider = ?, subscription_status = 'ACTIVE' WHERE tenant_id = ?",
                [tier, provider, tenantId]
            );
        }

        const passwordHash = await hashPassword(password);

        if (existing) {
            await connection.query(
                `UPDATE Users
                    SET password_hash = ?, email_verified_at = NOW(), role = 'Owner', tenant_id = ?
                  WHERE id = ?`,
                [passwordHash, tenantId, existing.id]
            );
        } else {
            await connection.query(
                `INSERT INTO Users (entra_oid, tenant_id, email, role, system_role, password_hash, email_verified_at)
                 VALUES (NULL, ?, ?, 'Owner', 'USER', ?, NOW())`,
                [tenantId, email, passwordHash]
            );
        }

        await connection.commit();

        console.log("");
        console.log(`[seed-aws-tenant] ${created ? "Tenant creado" : "Tenant actualizado"}.`);
        console.log(`  tenant_id : ${tenantId}`);
        console.log(`  empresa   : ${companyName}`);
        console.log(`  tier      : ${tier}`);
        console.log(`  provider  : ${provider}`);
        console.log(`  usuario   : ${email} (rol Owner, email ya verificado)`);
        console.log("");
        console.log("  Entrá en http://localhost:3000/es/login → \"Continuar con email\".");
        console.log("");
    } catch (error) {
        await connection.rollback();
        console.error("[seed-aws-tenant] error:", error);
        process.exit(1);
    } finally {
        connection.release();
        await pool.end();
    }
}

main().catch((err) => {
    console.error("[seed-aws-tenant] error fatal:", err);
    process.exit(1);
});
