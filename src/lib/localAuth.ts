import crypto from "crypto";
import bcrypt from "bcryptjs";
import type { PoolConnection } from "mysql2/promise";

/**
 * Primitivas de la identidad propia (Fase 2 — tenants AWS).
 * Todo lo que toca contraseñas y tokens de un solo uso vive acá, para que las
 * rutas de /api/auth/local/* no reimplementen ninguna decisión de seguridad.
 */

/** Coste de bcrypt. 12 ≈ 250ms en el VPS actual: caro para fuerza bruta, tolerable en login. */
const BCRYPT_ROUNDS = 12;

export const PASSWORD_MIN_LENGTH = 12;

export type AuthTokenPurpose = "verify_email" | "password_reset" | "invite";

/** TTL por propósito. El de reset es corto a propósito: es el más peligroso si se filtra. */
const TOKEN_TTL_MS: Record<AuthTokenPurpose, number> = {
    verify_email: 24 * 60 * 60 * 1000,
    password_reset: 60 * 60 * 1000,
    invite: 7 * 24 * 60 * 60 * 1000,
};

export function normalizeEmail(email: string): string {
    return String(email || "").trim().toLowerCase();
}

/**
 * Política de contraseña. Deliberadamente corta: longitud es lo único que
 * mueve la aguja contra fuerza bruta offline. Las reglas de composición
 * ("una mayúscula, un símbolo") empujan a la gente a `Password1!` y NIST las
 * desaconseja explícitamente desde SP 800-63B.
 */
export function validatePasswordPolicy(password: string): string | null {
    if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
        return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
    }
    if (password.length > 200) {
        // bcrypt trunca a 72 bytes; además evita DoS por hasheo de payloads enormes.
        return "La contraseña no puede superar los 200 caracteres.";
    }
    return null;
}

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    if (!hash) return false;
    return bcrypt.compare(password, hash);
}

/**
 * Comparación de contraseña en tiempo (aproximadamente) constante respecto a
 * si el usuario existe: si no hay hash, igual se gasta un bcrypt contra un
 * hash dummy. Sin esto, un 401 instantáneo vs uno de 250ms le dice al
 * atacante qué emails están registrados.
 */
// Hash real de una contraseña descartada, con el mismo coste (12) que los
// reales. Tiene que ser un hash bcrypt VÁLIDO: contra uno inválido, compare()
// devuelve false de inmediato sin gastar tiempo, y el timing vuelve a filtrar
// si el email existe — que es justo lo que esto viene a evitar.
const DUMMY_HASH = "$2b$12$ae4nJcpYZfljVyEn0q/WDOtyXXmqk0V3/2EPpHtpiEZVrhcNfciSa";

export async function verifyPasswordConstantTime(password: string, hash: string | null): Promise<boolean> {
    if (!hash) {
        await bcrypt.compare(password, DUMMY_HASH).catch(() => false);
        return false;
    }
    return verifyPassword(password, hash);
}

function sha256Hex(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Genera un token de un solo uso y persiste SOLO su hash. El valor devuelto es
 * el único momento en que el token existe en claro — va directo al email y no
 * se vuelve a poder derivar desde la base.
 */
export async function createAuthToken(
    connection: PoolConnection,
    tenantId: string,
    email: string,
    purpose: AuthTokenPurpose
): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS[purpose]);

    // Invalida los tokens previos del mismo propósito: pedir un reset nuevo
    // debe matar el link viejo, si no un mail interceptado sigue sirviendo.
    await connection.query(
        `UPDATE AuthTokens SET used_at = NOW()
          WHERE tenant_id = ? AND email = ? AND purpose = ? AND used_at IS NULL`,
        [tenantId, normalizeEmail(email), purpose]
    );

    await connection.query(
        `INSERT INTO AuthTokens (tenant_id, email, purpose, token_hash, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [tenantId, normalizeEmail(email), purpose, sha256Hex(rawToken), expiresAt]
    );

    return rawToken;
}

export type ConsumedToken = { tenantId: string; email: string };

/**
 * Valida y quema un token. Devuelve null si no existe, ya se usó o venció —
 * los tres casos indistinguibles a propósito para no filtrar información.
 *
 * El UPDATE condicional es lo que hace la operación atómica: dos requests
 * simultáneas con el mismo token, solo una ve affectedRows = 1.
 */
export async function consumeAuthToken(
    connection: PoolConnection,
    purpose: AuthTokenPurpose,
    rawToken: string
): Promise<ConsumedToken | null> {
    if (!rawToken || typeof rawToken !== "string") return null;
    const tokenHash = sha256Hex(rawToken);

    const [rows] = await connection.query(
        `SELECT tenant_id, email FROM AuthTokens
          WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > NOW()
          LIMIT 1`,
        [tokenHash, purpose]
    );
    const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as { tenant_id: string; email: string }) : null;
    if (!row) return null;

    const [result] = await connection.query(
        `UPDATE AuthTokens SET used_at = NOW()
          WHERE token_hash = ? AND used_at IS NULL`,
        [tokenHash]
    );
    if ((result as { affectedRows?: number }).affectedRows !== 1) return null;

    return { tenantId: row.tenant_id, email: row.email };
}

/**
 * Un email de un usuario local tiene que ser único a nivel GLOBAL, no por
 * tenant: el login local sólo recibe email+password, así que si el mismo email
 * tuviera cuenta local en dos tenants no habría forma de resolver a cuál
 * entrar. (Los usuarios de Entra no tienen esta restricción — ahí el tenant
 * viene en el claim `tid` del token.)
 */
export async function localEmailTaken(connection: PoolConnection, email: string): Promise<boolean> {
    const [rows] = await connection.query(
        "SELECT 1 FROM Users WHERE email = ? AND password_hash IS NOT NULL LIMIT 1",
        [normalizeEmail(email)]
    );
    return Array.isArray(rows) && rows.length > 0;
}

export function buildAppUrl(path: string): string {
    const base = (process.env.NEXT_PUBLIC_APP_URL || "https://app.cscloudsolutions.com.ar").replace(/\/$/, "");
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
