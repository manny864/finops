// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { withDeadline, TenantSyncTimeout } from '@/app/api/cron/sync/route';

/**
 * Cubre el techo de tiempo por tenant del cron `sync`.
 *
 * Sin esto, UNA llamada colgada a Azure se comía la corrida entera: en prod la del
 * 2026-07-30 murió 20 s después de arrancar y nunca llegó al segundo tenant, sin
 * dejar ni línea de fin ni error.
 */
describe('withDeadline', () => {
    it('devuelve el resultado si el trabajo termina a tiempo', async () => {
        await expect(withDeadline(Promise.resolve('ok'), 1000, 'tenant A')).resolves.toBe('ok');
    });

    it('rechaza con TenantSyncTimeout si el trabajo se cuelga', async () => {
        vi.useFakeTimers();
        try {
            // Una promesa que nunca resuelve = la llamada colgada a Azure.
            const colgado = new Promise<string>(() => { /* nunca resuelve */ });
            const raced = withDeadline(colgado, 5000, 'tenant colgado');
            const assertion = expect(raced).rejects.toBeInstanceOf(TenantSyncTimeout);
            await vi.advanceTimersByTimeAsync(5001);
            await assertion;
        } finally {
            vi.useRealTimers();
        }
    });

    it('propaga el error original si el trabajo falla antes del techo', async () => {
        const boom = Promise.reject(new Error('429 de Cost Management'));
        await expect(withDeadline(boom, 10_000, 'tenant B')).rejects.toThrow('429 de Cost Management');
    });

    it('un fallo posterior al techo no queda como unhandled rejection', async () => {
        vi.useFakeTimers();
        const unhandled: unknown[] = [];
        const onUnhandled = (e: unknown) => unhandled.push(e);
        process.on('unhandledRejection', onUnhandled);
        try {
            // El trabajo falla DESPUÉS de que el deadline ya rechazó: la promesa
            // perdedora sigue viva y sin oyentes. Sin el catch interno de
            // withDeadline, esto tumbaba el proceso.
            let fail: (e: Error) => void = () => {};
            const lento = new Promise<string>((_r, reject) => { fail = reject; });
            const raced = withDeadline(lento, 1000, 'tenant C');
            const assertion = expect(raced).rejects.toBeInstanceOf(TenantSyncTimeout);
            await vi.advanceTimersByTimeAsync(1001);
            await assertion;

            fail(new Error('el 429 llegó tarde'));
            await vi.advanceTimersByTimeAsync(10);
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', onUnhandled);
            vi.useRealTimers();
        }
    });

    it('con techo 0 o negativo no aplica deadline (permite desactivarlo)', async () => {
        await expect(withDeadline(Promise.resolve('sin techo'), 0, 'tenant D')).resolves.toBe('sin techo');
    });
});
