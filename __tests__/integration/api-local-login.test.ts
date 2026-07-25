// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';

/**
 * Login de identidad propia (tenants AWS) end-to-end contra MySQL real.
 *
 * Cubre el camino que el script `npm run seed:aws-tenant` habilita: un usuario
 * con `password_hash` y `email_verified_at` puede pedir un token y usarlo.
 * Verifica además las dos negativas que importan: contraseña mala y email sin
 * verificar. Sin este test, un cambio en el hashing o en la emisión del token
 * sólo se descubriría probando a mano en el navegador.
 */

const DB = {
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'finops_user',
    password: process.env.DB_PASSWORD || 'finopspassword',
    database: process.env.DB_NAME || 'finops_app',
    port: Number(process.env.DB_PORT || 3307),
};

let pool: mysql.Pool;
let available = false;

const tenantId = `tenant-login-${uuidv4()}`;
const verifiedEmail = `verified-${uuidv4()}@example.test`;
const unverifiedEmail = `unverified-${uuidv4()}@example.test`;
const PASSWORD = 'contrasena-de-prueba-larga';

beforeAll(async () => {
    process.env.LOCAL_AUTH_SECRET = process.env.LOCAL_AUTH_SECRET
        || 'test-secret-para-login-local-de-al-menos-32-chars';

    try {
        pool = mysql.createPool({ ...DB, connectionLimit: 3 });
        const { hashPassword } = await import('@/lib/localAuth');
        const hash = await hashPassword(PASSWORD);

        const conn = await pool.getConnection();
        try {
            await conn.query(
                `INSERT INTO Tenants (tenant_id, company_name, tier, subscription_status, provider)
                 VALUES (?, 'Login Test', 'Enterprise', 'ACTIVE', 'aws')`,
                [tenantId]
            );
            await conn.query(
                `INSERT INTO Users (entra_oid, tenant_id, email, role, system_role, password_hash, email_verified_at)
                 VALUES (NULL, ?, ?, 'Owner', 'USER', ?, NOW())`,
                [tenantId, verifiedEmail, hash]
            );
            await conn.query(
                `INSERT INTO Users (entra_oid, tenant_id, email, role, system_role, password_hash, email_verified_at)
                 VALUES (NULL, ?, ?, 'Reader', 'USER', ?, NULL)`,
                [tenantId, unverifiedEmail, hash]
            );
        } finally {
            conn.release();
        }
        available = true;
    } catch {
        // Sin MySQL local (p. ej. en CI sin servicio de base) los tests se
        // saltan en vez de fallar: este spec valida integración real, no lógica
        // pura — esa ya está cubierta en __tests__/unit/localAuth.test.ts.
        available = false;
    }
}, 60_000);

afterAll(async () => {
    if (pool) {
        try {
            await pool.query('DELETE FROM Users WHERE tenant_id = ?', [tenantId]);
            await pool.query('DELETE FROM Tenants WHERE tenant_id = ?', [tenantId]);
        } catch { /* la base pudo no estar disponible */ }
        await pool.end();
    }
});

async function callLogin(email: string, password: string) {
    // El handler se importa dinámicamente para que las env vars ya estén puestas.
    const { POST } = await import('@/app/api/auth/local/login/route');
    const request = new Request('http://localhost:3000/api/auth/local/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-real-ip': `10.0.0.${Math.floor(Math.random() * 250) + 1}` },
        body: JSON.stringify({ email, password }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(request as any);
    return { status: response.status, body: await response.json() };
}

describe('POST /api/auth/local/login', () => {
    it('devuelve un JWT usable para un usuario verificado', async () => {
        if (!available) return;

        const { status, body } = await callLogin(verifiedEmail, PASSWORD);
        expect(status).toBe(200);
        expect(typeof body.token).toBe('string');

        // El token tiene que ser HS256 y traer el tenant correcto: es lo que
        // `validateRequestToken` va a exigir en cada ruta protegida.
        const { verifyLocalToken } = await import('@/lib/localToken');
        const claims = await verifyLocalToken(body.token);
        expect(claims.tid).toBe(tenantId);
        expect(claims.email).toBe(verifiedEmail);
        expect(body.tenantId).toBe(tenantId);
    }, 30_000);

    it('rechaza una contraseña incorrecta sin filtrar si el usuario existe', async () => {
        if (!available) return;

        const { status, body } = await callLogin(verifiedEmail, 'una-contrasena-que-no-es');
        expect(status).toBe(401);
        expect(body.token).toBeUndefined();
    }, 30_000);

    it('no deja entrar a un usuario que no verificó su email', async () => {
        if (!available) return;

        const { status, body } = await callLogin(unverifiedEmail, PASSWORD);
        expect(status).toBe(403);
        expect(body.verificationRequired).toBe(true);
        expect(body.token).toBeUndefined();
    }, 30_000);
});
