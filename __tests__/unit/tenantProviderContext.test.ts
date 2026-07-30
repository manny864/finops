/**
 * Contexto de proveedor por tenant.
 *
 * El producto es Azure-only: `getTenantProviders` siempre resuelve azure=true,
 * sin importar el valor crudo de la columna. Lo que importa acá es la
 * resiliencia (base caída, tenant sin fila) y el cache por tenant/TTL, no la
 * clasificación por proveedor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/modules/storage/db', () => ({
    default: { query: (...args: unknown[]) => queryMock(...args) },
}));

import {
    getTenantProviders,
    tenantUsesAzure,
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
    it('mapea provider="azure" a azure', async () => {
        queryMock.mockResolvedValue(rowsWith('azure'));
        const p = await getTenantProviders(T);
        expect(p).toEqual({ setting: 'azure', azure: true });
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
        expect(p).toEqual({ setting: 'azure', azure: true });
    });

    it('un fallo de base no se cachea: el proximo request reintenta', async () => {
        queryMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        await getTenantProviders(T);

        queryMock.mockResolvedValue(rowsWith('azure'));
        expect((await getTenantProviders(T)).azure).toBe(true);
    });

    it('un tenant sin fila tampoco se cachea: puede estar creandose', async () => {
        queryMock.mockResolvedValueOnce([[], []]);
        expect((await getTenantProviders(T)).azure).toBe(true);

        queryMock.mockResolvedValue(rowsWith('azure'));
        expect((await getTenantProviders(T)).azure).toBe(true);
        expect(queryMock).toHaveBeenCalledTimes(2);
    });
});

describe('cache', () => {
    it('no repite la query dentro del TTL', async () => {
        queryMock.mockResolvedValue(rowsWith('azure'));
        await getTenantProviders(T);
        await getTenantProviders(T);
        await getTenantProviders(T);
        expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it('cachea por tenant: no filtra el estado de uno a otro', async () => {
        queryMock.mockResolvedValueOnce(rowsWith('azure')).mockResolvedValueOnce(rowsWith('azure'));
        expect((await getTenantProviders('t1')).azure).toBe(true);
        expect((await getTenantProviders('t2')).azure).toBe(true);
    });

    it('invalidateTenantProviders fuerza releer', async () => {
        queryMock.mockResolvedValueOnce(rowsWith('azure'));
        expect((await getTenantProviders(T)).azure).toBe(true);

        queryMock.mockResolvedValueOnce(rowsWith('azure'));
        invalidateTenantProviders(T);

        const after = await getTenantProviders(T);
        expect(after.azure).toBe(true);
        expect(queryMock).toHaveBeenCalledTimes(2);
    });

    it('invalidar un tenant no invalida a los demas', async () => {
        queryMock.mockResolvedValue(rowsWith('azure'));
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
            queryMock.mockResolvedValue(rowsWith('azure'));
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
    it('tenantUsesAzure es true para cualquier tenant', async () => {
        queryMock.mockResolvedValue(rowsWith('azure'));
        expect(await tenantUsesAzure(T)).toBe(true);
    });

    it('providerIdsFor lista el proveedor activo', () => {
        expect(providerIdsFor({ setting: 'azure', azure: true })).toEqual(['azure']);
    });
});
