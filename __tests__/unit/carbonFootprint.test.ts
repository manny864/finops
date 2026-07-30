// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Cubre el punto único de cómputo de huella de carbono (2026-07-30), extraído de
 * /api/intelligence/sustainability para que el KPI "Impacto Ambiental" del
 * Dashboard General lea el mismo dato real en vez de una fórmula inventada sobre
 * el ahorro en dólares ((totalSavings/100)*15, que además estaba duplicada en el
 * cliente y en el servidor).
 */

vi.mock('@/lib/redis', () => ({
    redis: { get: async () => null, set: async () => 'OK' },
}));

const TENANT = '81ebe027-e6af-4e09-bc73-58c9012c6408';

describe('getCachedCarbonFootprint', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('degrada con avoided=0 sin lanzar, si el tenant no tiene credenciales', async () => {
        vi.doMock('@/lib/azure', () => ({
            getAzureCredential: async () => { throw new Error('sin credenciales'); },
            getSubscriptionsForTenant: async () => [],
        }));
        const { getCachedCarbonFootprint } = await import('@/lib/carbonFootprint');

        const result = await getCachedCarbonFootprint(TENANT, 'All');

        expect(result.degraded).toBe(true);
        expect(result.avoided).toBe(0);
        expect(result.footprint).toBe(0);
    });

    it('calcula avoided a partir de los discos zombie que devuelve Resource Graph', async () => {
        vi.doMock('@/lib/azure', () => ({
            getAzureCredential: async () => ({ fake: true }),
            getSubscriptionsForTenant: async () => ['sub-a'],
        }));
        vi.doMock('@azure/arm-resourcegraph', () => ({
            ResourceGraphClient: class {
                async resources({ query }: { query: string }) {
                    if (query.includes('virtualMachines')) return { data: [] };
                    if (query.includes('Unattached')) {
                        return { data: [{ name: 'disk-huerfano', location: 'eastus', sizeGB: 128 }] };
                    }
                    if (query.includes('storageAccounts')) return { data: [] };
                    return { data: [] };
                }
            },
        }));
        const { getCachedCarbonFootprint } = await import('@/lib/carbonFootprint');

        const result = await getCachedCarbonFootprint(TENANT, 'All');

        expect(result.degraded).toBeFalsy();
        expect(result.zombieCount).toBe(1);
        // Un disco huérfano corriendo 730h tiene que dejar ALGO de huella evitable.
        expect(result.avoided).toBeGreaterThan(0);
    });
});
