/**
 * Cost Explorer: cache, reintentos y errores accionables.
 *
 * Estos tests existen por una razon de costo, no de correccion: CE cobra USD
 * 0.01 por request y cada pagina de la paginacion cuenta aparte. Un bug que
 * saltee la cache no rompe nada visible — solo aparece en la factura de AWS del
 * cliente al mes siguiente. Por eso se afirma explicitamente cuantas veces se
 * llamo al SDK, no solo que el resultado sea correcto.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
const redisStore = new Map<string, string>();
const getMock = vi.fn(async (key: string) => redisStore.get(key) ?? null);
const setMock = vi.fn(async (key: string, value: string) => {
    redisStore.set(key, value);
    return 'OK';
});
const scanMock = vi.fn(async () => ['0', [...redisStore.keys()]] as [string, string[]]);
const delMock = vi.fn(async (...keys: string[]) => {
    let n = 0;
    for (const k of keys) if (redisStore.delete(k)) n++;
    return n;
});

vi.mock('@aws-sdk/client-cost-explorer', () => ({
    CostExplorerClient: class {
        send = sendMock;
    },
    GetCostAndUsageCommand: class {
        constructor(public input: unknown) { }
    },
}));

vi.mock('@/lib/redis', () => ({
    redis: {
        get: (k: string) => getMock(k),
        set: (k: string, v: string, ...rest: unknown[]) => setMock(k, v, ...rest),
        scan: (...args: unknown[]) => scanMock(...(args as [])),
        del: (...keys: string[]) => delMock(...keys),
    },
}));

import { getCostAndUsage, invalidateCostExplorerCache, AwsCostExplorerAccessError } from '@/lib/aws/costExplorer';

const creds = { accessKeyId: 'A', secretAccessKey: 'B', sessionToken: 'C', expiration: new Date() };

function pageWith(cost: string, nextToken?: string) {
    return {
        ResultsByTime: [{
            TimePeriod: { Start: '2026-01-01' },
            Groups: [{
                Keys: ['AmazonEC2', 'us-east-1'],
                Metrics: {
                    UnblendedCost: { Amount: cost },
                    AmortizedCost: { Amount: cost },
                    UsageQuantity: { Amount: '24' },
                },
            }],
        }],
        NextPageToken: nextToken,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    redisStore.clear();
});

describe('getCostAndUsage - cache', () => {
    it('la segunda llamada con la misma cuenta y rango no vuelve a pegarle a AWS', async () => {
        sendMock.mockResolvedValue(pageWith('10.50'));

        const first = await getCostAndUsage(creds, '2026-01-01', '2026-01-02', { accountId: '111122223333' });
        const second = await getCostAndUsage(creds, '2026-01-01', '2026-01-02', { accountId: '111122223333' });

        expect(sendMock).toHaveBeenCalledTimes(1);
        expect(second).toEqual(first);
        expect(second[0].unblendedCost).toBe(10.5);
    });

    it('no cachea si no se informa accountId: la clave seria ambigua entre cuentas', async () => {
        sendMock.mockResolvedValue(pageWith('1.00'));

        await getCostAndUsage(creds, '2026-01-01', '2026-01-02');
        await getCostAndUsage(creds, '2026-01-01', '2026-01-02');

        expect(sendMock).toHaveBeenCalledTimes(2);
        expect(setMock).not.toHaveBeenCalled();
    });

    it('cuentas distintas no comparten cache (evita filtrar costos entre tenants)', async () => {
        sendMock.mockResolvedValue(pageWith('7.00'));

        await getCostAndUsage(creds, '2026-01-01', '2026-01-02', { accountId: '111122223333' });
        await getCostAndUsage(creds, '2026-01-01', '2026-01-02', { accountId: '444455556666' });

        expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it('bypassCache fuerza ir a AWS y refresca lo cacheado', async () => {
        sendMock.mockResolvedValue(pageWith('3.00'));
        await getCostAndUsage(creds, '2026-01-01', '2026-01-02', { accountId: '111122223333' });

        sendMock.mockResolvedValue(pageWith('9.00'));
        const fresh = await getCostAndUsage(creds, '2026-01-01', '2026-01-02', {
            accountId: '111122223333', bypassCache: true,
        });

        expect(sendMock).toHaveBeenCalledTimes(2);
        expect(fresh[0].unblendedCost).toBe(9);

        const afterRefresh = await getCostAndUsage(creds, '2026-01-01', '2026-01-02', { accountId: '111122223333' });
        expect(afterRefresh[0].unblendedCost).toBe(9);
        expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it('un rango cerrado en el pasado se cachea 24h y uno que incluye hoy solo 1h', async () => {
        sendMock.mockResolvedValue(pageWith('1.00'));

        await getCostAndUsage(creds, '2026-01-01', '2026-01-02', { accountId: '111122223333' });
        expect(setMock.mock.calls[0][3]).toBe(24 * 60 * 60);

        const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        await getCostAndUsage(creds, '2026-01-01', future, { accountId: '111122223333' });
        expect(setMock.mock.calls[1][3]).toBe(60 * 60);
    });

    it('si Redis esta caido igual devuelve datos: la cache no puede ser un punto de falla', async () => {
        getMock.mockRejectedValueOnce(new Error('Stream is not writeable'));
        setMock.mockRejectedValueOnce(new Error('Stream is not writeable'));
        sendMock.mockResolvedValue(pageWith('5.00'));

        const rows = await getCostAndUsage(creds, '2026-01-01', '2026-01-02', { accountId: '111122223333' });

        expect(rows).toHaveLength(1);
        expect(rows[0].unblendedCost).toBe(5);
    });

    it('una entrada de cache corrupta provoca lectura fresca en vez de romper el sync', async () => {
        getMock.mockResolvedValueOnce('{"no soy un array":true}');
        sendMock.mockResolvedValue(pageWith('2.00'));

        const rows = await getCostAndUsage(creds, '2026-01-01', '2026-01-02', { accountId: '111122223333' });

        expect(sendMock).toHaveBeenCalledTimes(1);
        expect(rows[0].unblendedCost).toBe(2);
    });

    it('cachea el resultado completo de la paginacion, no solo la primera pagina', async () => {
        sendMock
            .mockResolvedValueOnce(pageWith('1.00', 'token-2'))
            .mockResolvedValueOnce(pageWith('2.00'));

        const first = await getCostAndUsage(creds, '2026-01-01', '2026-01-02', { accountId: '111122223333' });
        expect(first).toHaveLength(2);

        const cached = await getCostAndUsage(creds, '2026-01-01', '2026-01-02', { accountId: '111122223333' });
        expect(cached).toHaveLength(2);
        expect(sendMock).toHaveBeenCalledTimes(2);
    });
});

describe('getCostAndUsage - reintentos', () => {
    it('reintenta ante throttling y termina devolviendo los datos', async () => {
        const throttle = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
        sendMock
            .mockRejectedValueOnce(throttle)
            .mockRejectedValueOnce(throttle)
            .mockResolvedValueOnce(pageWith('4.00'));

        const rows = await getCostAndUsage(creds, '2026-01-01', '2026-01-02', { accountId: '111122223333' });

        expect(sendMock).toHaveBeenCalledTimes(3);
        expect(rows[0].unblendedCost).toBe(4);
    });

    it('reintenta ante 5xx identificado por codigo HTTP y no por nombre', async () => {
        const serverError = Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 503 } });
        sendMock.mockRejectedValueOnce(serverError).mockResolvedValueOnce(pageWith('1.00'));

        const rows = await getCostAndUsage(creds, '2026-01-01', '2026-01-02');

        expect(sendMock).toHaveBeenCalledTimes(2);
        expect(rows).toHaveLength(1);
    });

    it('NO reintenta un error de validacion: reintentar solo gastaria mas dinero', async () => {
        const validation = Object.assign(new Error('start date must be before end date'), {
            name: 'ValidationException',
        });
        sendMock.mockRejectedValue(validation);

        await expect(
            getCostAndUsage(creds, '2026-02-01', '2026-01-01', { accountId: '111122223333' })
        ).rejects.toThrow('start date must be before end date');

        expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it('deja de reintentar y propaga tras agotar los intentos', async () => {
        const throttle = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
        sendMock.mockRejectedValue(throttle);

        await expect(getCostAndUsage(creds, '2026-01-01', '2026-01-02')).rejects.toThrow('Rate exceeded');
        expect(sendMock).toHaveBeenCalledTimes(4);
    });

    it('un resultado fallido no queda cacheado', async () => {
        const throttle = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
        sendMock.mockRejectedValue(throttle);

        await expect(
            getCostAndUsage(creds, '2026-01-01', '2026-01-02', { accountId: '111122223333' })
        ).rejects.toThrow();

        expect(setMock).not.toHaveBeenCalled();
    });
});

describe('getCostAndUsage - permisos', () => {
    it('traduce AccessDeniedException en un mensaje que dice que permiso falta', async () => {
        const denied = Object.assign(new Error('User is not authorized to perform: ce:GetCostAndUsage'), {
            name: 'AccessDeniedException',
        });
        sendMock.mockRejectedValue(denied);

        await expect(
            getCostAndUsage(creds, '2026-01-01', '2026-01-02')
        ).rejects.toBeInstanceOf(AwsCostExplorerAccessError);

        // Un error de permisos no se resuelve reintentando: seria gastar 4 requests.
        expect(sendMock).toHaveBeenCalledTimes(1);

        await expect(
            getCostAndUsage(creds, '2026-01-01', '2026-01-02')
        ).rejects.toThrow(/ce:GetCostAndUsage/);
    });
});

describe('invalidateCostExplorerCache', () => {
    it('borra las entradas de la cuenta al eliminarla', async () => {
        sendMock.mockResolvedValue(pageWith('1.00'));
        await getCostAndUsage(creds, '2026-01-01', '2026-01-02', { accountId: '111122223333' });
        expect(redisStore.size).toBe(1);

        const deleted = await invalidateCostExplorerCache('111122223333');

        expect(deleted).toBe(1);
        expect(redisStore.size).toBe(0);
    });

    it('usa SCAN y no KEYS, que bloquearia el servidor Redis entero', async () => {
        await invalidateCostExplorerCache('111122223333');
        expect(scanMock).toHaveBeenCalled();
    });

    it('si Redis falla devuelve 0 en vez de abortar el borrado de la cuenta', async () => {
        scanMock.mockRejectedValueOnce(new Error('down'));
        await expect(invalidateCostExplorerCache('111122223333')).resolves.toBe(0);
    });
});
