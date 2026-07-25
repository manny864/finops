/**
 * Contexto de proveedor por tenant.
 *
 * Lo que importa acá no es solo que devuelva el valor correcto, sino que el
 * fallback sea el histórico (Azure): un tenant Azure que quede mal clasificado
 * como AWS deja de ver sus propios datos en vivo, que es peor que una query de
 * más. Por eso se testea explícitamente el comportamiento ante base caída.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/modules/storage/db', () => ({
    default: { query: (...args: unknown[]) => queryMock(...args) },
}));

import {
    getTenantProviders,
    tenantUsesAzure,
    tenantUsesAws,
    invalidateTenantProviders,
    providerIdsFor,
    __clearTenantProvidersCache,
} from '@/lib/tenantProviderContext';

const T = 'tenant-a';

beforeEach(() => {
    vi.clearAllMocks();
    __clearTenantProvidersCache();
});

function rowsWith(provider: string | null) {
    return [[{ provider }], []];
}

describe('getTenantProviders', () => {
    it('mapea provider="aws" a solo AWS', async () => {
        queryMock.mockResolvedValue(rowsWith('aws'));
        const p = await getTenantProviders(T);
        expect(p).toEqual({ setting: 'aws', azure: false, aws: true });
    });

    it('mapea provider="both" a los dos proveedores activos', async () => {
        queryMock.mockResolvedValue(rowsWith('both'));
        expect(await getTenantProviders(T)).toEqual({ setting: 'both', azure: true, aws: true });
    });

    it('un valor desconocido en la columna no deja al tenant sin proveedor', async () => {
        queryMock.mockResolvedValue(rowsWith('gcp'));
        const p = await getTenantProviders(T);
        expect(p.setting).toBe('azure');
        expect(p.azure).toBe(true);
    });

    it('provider NULL (tenants previos a la columna) se lee como Azure', async () => {
        queryMock.mockResolvedValue(rowsWith(null));
        expect((await getTenantProviders(T)).azure).toBe(true);
    });
});

describe('resiliencia', () => {
    it('con la base caida degrada a Azure en vez de propagar el error', async () => {
        queryMock.mockRejectedValue(new Error('ECONNREFUSED'));
        const p = await getTenantProviders(T);
        expect(p).toEqual({ setting: 'azure', azure: true, aws: false });
    });

    it('un fallo de base no se cachea: el proximo request reintenta', async () => {
        queryMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        await getTenantProviders(T);

        queryMock.mockResolvedValue(rowsWith('aws'));
        expect((await getTenantProviders(T)).aws).toBe(true);
    });

    it('un tenant sin fila tampoco se cachea: puede estar creandose', async () => {
        queryMock.mockResolvedValueOnce([[], []]);
        expect((await getTenantProviders(T)).azure).toBe(true);

        queryMock.mockResolvedValue(rowsWith('aws'));
        expect((await getTenantProviders(T)).aws).toBe(true);
        expect(queryMock).toHaveBeenCalledTimes(2);
    });
});

describe('cache', () => {
    it('no repite la query dentro del TTL', async () => {
        queryMock.mockResolvedValue(rowsWith('aws'));
        await getTenantProviders(T);
        await getTenantProviders(T);
        await getTenantProviders(T);
        expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it('cachea por tenant: no filtra el proveedor de uno a otro', async () => {
        queryMock.mockResolvedValueOnce(rowsWith('aws')).mockResolvedValueOnce(rowsWith('azure'));
        expect((await getTenantProviders('t1')).aws).toBe(true);
        expect((await getTenantProviders('t2')).azure).toBe(true);
        expect((await getTenantProviders('t2')).aws).toBe(false);
    });

    it('invalidateTenantProviders fuerza releer tras un cambio de tier', async () => {
        queryMock.mockResolvedValueOnce(rowsWith('both'));
        expect((await getTenantProviders(T)).aws).toBe(true);

        // Downgrade: el tenant queda solo con Azure.
        queryMock.mockResolvedValueOnce(rowsWith('azure'));
        invalidateTenantProviders(T);

        const after = await getTenantProviders(T);
        expect(after.aws).toBe(false);
        expect(after.azure).toBe(true);
    });

    it('invalidar un tenant no invalida a los demas', async () => {
        queryMock.mockResolvedValue(rowsWith('aws'));
        await getTenantProviders('t1');
        await getTenantProviders('t2');
        expect(queryMock).toHaveBeenCalledTimes(2);

        invalidateTenantProviders('t1');
        await getTenantProviders('t2');
        expect(queryMock).toHaveBeenCalledTimes(2);
    });

    it('expira pasado el TTL de un minuto', async () => {
        vi.useFakeTimers();
        try {
            queryMock.mockResolvedValue(rowsWith('aws'));
            await getTenantProviders(T);
            vi.advanceTimersByTime(61_000);
            await getTenantProviders(T);
            expect(queryMock).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('atajos', () => {
    it('tenantUsesAzure es false para un tenant AWS puro', async () => {
        queryMock.mockResolvedValue(rowsWith('aws'));
        expect(await tenantUsesAzure(T)).toBe(false);
        expect(await tenantUsesAws(T)).toBe(true);
    });

    it('ambos son true con provider="both"', async () => {
        queryMock.mockResolvedValue(rowsWith('both'));
        expect(await tenantUsesAzure(T)).toBe(true);
        expect(await tenantUsesAws(T)).toBe(true);
    });

    it('providerIdsFor lista los proveedores activos', () => {
        expect(providerIdsFor({ setting: 'both', azure: true, aws: true })).toEqual(['azure', 'aws']);
        expect(providerIdsFor({ setting: 'aws', azure: false, aws: true })).toEqual(['aws']);
    });
});
