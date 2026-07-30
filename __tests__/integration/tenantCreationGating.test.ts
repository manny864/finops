// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Cubre las tres barreras de alta de tenants puestas el 2026-07-30. Son caminos de
 * seguridad y ninguno tenía test: esto es lo que evita que alguien reponga el
 * `|| 'essential'` o la auto-provisión sin darse cuenta.
 *
 *   1. Un token del directorio de cuentas personales de Microsoft se rechaza.
 *   2. Un login común (sin plan) sobre una organización sin suscripción NO crea
 *      tenant.
 *   3. El checkout crea el tenant SIN acceso (PENDING_PAYMENT, trial_ends_at NULL):
 *      el trial lo otorga el webhook de Paddle, no este endpoint.
 */

vi.mock('@/modules/storage/db', () => ({
    default: { query: vi.fn(), getConnection: vi.fn() },
    initializeDatabase: vi.fn(async () => {}),
}));

vi.mock('@/lib/emailHelper', () => ({
    sendEmailAsync: vi.fn(),
    getWelcomeEmailHtml: vi.fn(() => '<html></html>'),
    getInternalSignupAlertEmailHtml: vi.fn(() => '<html></html>'),
}));

import pool from '@/modules/storage/db';

describe('rechazo del directorio de cuentas personales (MSA)', () => {
    // El chequeo vive antes de la verificación de firma, así que alcanza un token
    // con el payload armado a mano — no hace falta firmarlo.
    function tokenWithTid(tid: string): string {
        const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
        return `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({ tid, email: 'x@outlook.com' })}.fakesig`;
    }

    async function callWithTid(tid: string) {
        const { requireRequestIdentity } = await import('@/lib/requestAuth');
        const request = new NextRequest('http://localhost/api/whatever', {
            headers: { authorization: `Bearer ${tokenWithTid(tid)}` },
        });
        return requireRequestIdentity(request);
    }

    it('rechaza con 403 el tid del directorio MSA', async () => {
        const { MSA_CONSUMERS_TENANT_ID } = await import('@/lib/requestAuth');
        await expect(callWithTid(MSA_CONSUMERS_TENANT_ID)).rejects.toMatchObject({ status: 403 });
    });

    it('lo rechaza sin importar el casing del GUID', async () => {
        const { MSA_CONSUMERS_TENANT_ID } = await import('@/lib/requestAuth');
        await expect(callWithTid(MSA_CONSUMERS_TENANT_ID.toUpperCase())).rejects.toMatchObject({
            status: 403,
        });
    });

    it('un tid de organización NO se rechaza por este motivo', async () => {
        const { PERSONAL_ACCOUNT_REJECTION } = await import('@/lib/requestAuth');
        // Igual falla —el token es falso y en el entorno de test no hay audience
        // configurada— pero por cualquier motivo MENOS el rechazo de cuenta
        // personal. Esto es lo que garantiza que el filtro no se lleve puestos a
        // los tenants de organización.
        const err = await callWithTid('81ebe027-e6af-4e09-bc73-58c9012c6408').catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.message).not.toBe(PERSONAL_ACCOUNT_REJECTION);
        expect(err.status).not.toBe(403);
    });
});

describe('POST /api/onboard — alta de tenant', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.doMock('@/lib/requestAuth', () => ({
            requireRequestIdentity: vi.fn(async () => ({
                email: 'user@empresa.com',
                tenantId: 'tenant-nuevo',
                isCorporateDomain: false,
                claims: { tid: 'tenant-nuevo', oid: 'oid-1' },
            })),
            AuthError: class extends Error {},
        }));
    });

    it('un login común sin plan y sin suscripción no crea tenant', async () => {
        (pool.query as any).mockResolvedValueOnce([[]]); // no existe la fila

        const { POST } = await import('@/app/api/onboard/route');
        const response = await POST(
            new NextRequest('http://localhost/api/onboard', {
                method: 'POST',
                body: JSON.stringify({ plan: null }),
            })
        );
        const json = await response.json();

        expect(response.status).toBe(403);
        expect(json.needsSubscription).toBe(true);
        // La prueba de que no creó nada: nunca abrió la transacción.
        expect(pool.getConnection).not.toHaveBeenCalled();
    });

    it('con plan explícito crea el tenant sin acceso: PENDING_PAYMENT y trial_ends_at NULL', async () => {
        const queries: Array<{ sql: string; params: any[] }> = [];
        const connection = {
            beginTransaction: vi.fn(async () => {}),
            commit: vi.fn(async () => {}),
            rollback: vi.fn(async () => {}),
            release: vi.fn(),
            query: vi.fn(async (sql: string, params: any[] = []) => {
                queries.push({ sql: String(sql), params });
                return [[], []];
            }),
        };
        (pool.getConnection as any).mockResolvedValue(connection);

        const { POST } = await import('@/app/api/onboard/route');
        await POST(
            new NextRequest('http://localhost/api/onboard', {
                method: 'POST',
                body: JSON.stringify({ plan: 'business' }),
            })
        );

        const insert = queries.find((q) => q.sql.includes('INSERT IGNORE INTO Tenants'));
        expect(insert, 'debería insertar el tenant para poder abrir el checkout').toBeDefined();

        // VALUES (tenant_id, company_name, tier, subscription_status, trial_ends_at, …)
        expect(insert!.params[3]).toBe('PENDING_PAYMENT');
        expect(insert!.params[4]).toBeNull();
        // Nunca debe nacer con acceso concedido.
        expect(insert!.params).not.toContain('TRIAL');
        expect(insert!.params).not.toContain('ACTIVE');
    });
});
