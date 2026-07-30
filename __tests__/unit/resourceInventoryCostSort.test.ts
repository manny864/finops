// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Cubre el orden por costo real de /api/resources/search (2026-07-30).
 *
 * Resource Graph no conoce el costo — vive en Cost Management, un servicio
 * aparte. Para ordenar por costo de verdad hay que costear TODO el conjunto
 * filtrado antes de paginar, no sólo la página pedida. Eso es una consulta a
 * Cost Management proporcional al tenant, así que sólo se activa por debajo de
 * SORT_BY_COST_MAX_RESOURCES (500) — por encima se degrada al orden alfabético
 * de siempre, con `sortedByCost: false` para que la UI avise en vez de mentir
 * el orden en silencio.
 */

const TENANT = '81ebe027-e6af-4e09-bc73-58c9012c6408';

vi.mock('@/lib/azure', () => ({
    getAzureCredential: async () => ({ fake: true }),
    getSubscriptionsForTenant: async () => ['sub-a'],
}));

vi.mock('@/lib/azureSubscriptionNames', () => ({
    getSubscriptionNameMap: async () => new Map([['sub-a', 'Sub A']]),
    resolveSubscriptionName: (id: string) => (id === 'sub-a' ? 'Sub A' : id),
}));

vi.mock('@/lib/azureCostColumn', () => ({
    resolveCostColumn: async () => 'CostUSD',
    degradeCostColumn: async () => undefined,
    isCostUsdUnsupportedError: () => false,
}));

// Tres recursos, costo INVERSO al orden alfabético: r-a es el más barato,
// r-c el más caro. Si el orden fuera por nombre (comportamiento viejo),
// r-a saldría primero; ordenado por costo real, r-c va primero.
const RESOURCES = [
    { id: '/sub/r-a', name: 'r-a', subscriptionId: 'sub-a', resourceGroup: 'rg1', tags: {}, createdTime: null },
    { id: '/sub/r-b', name: 'r-b', subscriptionId: 'sub-a', resourceGroup: 'rg1', tags: {}, createdTime: null },
    { id: '/sub/r-c', name: 'r-c', subscriptionId: 'sub-a', resourceGroup: 'rg1', tags: {}, createdTime: null },
];
const COSTS: Record<string, number> = { '/sub/r-a': 1, '/sub/r-b': 50, '/sub/r-c': 999 };

function mockResourceGraph(resources: typeof RESOURCES) {
    vi.doMock('@azure/arm-resourcegraph', () => ({
        ResourceGraphClient: class {
            async resources({ query }: { query: string }) {
                if (query.includes('summarize c = count()')) {
                    return { data: [{ c: resources.length }] };
                }
                if (query.includes('| project id, subscriptionId')) {
                    return { data: resources.map(r => ({ id: r.id, subscriptionId: r.subscriptionId })) };
                }
                if (query.includes('where id in (')) {
                    const m = query.match(/where id in \(([^)]*)\)/);
                    const ids = new Set((m?.[1] || '').split(',').map(s => s.replace(/'/g, '')));
                    return { data: resources.filter(r => ids.has(r.id)) };
                }
                if (query.includes('order by name asc')) {
                    const sorted = [...resources].sort((a, b) => a.name.localeCompare(b.name));
                    return { data: sorted };
                }
                // summarize by resourceGroup/subscriptionId, tags CostCenter, etc.
                return { data: [] };
            }
        },
    }));
}

function mockCostManagement(costs: Record<string, number>) {
    vi.doMock('@azure/arm-costmanagement', () => ({
        CostManagementClient: class {
            query = {
                usage: async (_scope: string, options: any) => {
                    const ids: string[] = options.dataset.filter.dimensions.values;
                    return {
                        columns: [{ name: 'CostUSD' }, { name: 'ResourceId' }],
                        rows: ids.map(id => [costs[id] || 0, id]),
                    };
                },
            };
        },
    }));
}

describe('searchResources — orden por costo real', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('con el conjunto por debajo del techo, ordena de mayor a menor costo real (no por nombre)', async () => {
        mockResourceGraph(RESOURCES);
        mockCostManagement(COSTS);
        const { searchResources } = await import('@/modules/collectors/azure/resourceInventoryService');

        const result = await searchResources(TENANT, { page: 1, pageSize: 15 });

        expect(result.sortedByCost).toBe(true);
        expect(result.rows.map(r => r.name)).toEqual(['r-c', 'r-b', 'r-a']);
        expect(result.rows.map(r => r.periodCost)).toEqual([999, 50, 1]);
    });

    it('pagina sobre el orden por costo, no sobre el orden alfabético', async () => {
        mockResourceGraph(RESOURCES);
        mockCostManagement(COSTS);
        const { searchResources } = await import('@/modules/collectors/azure/resourceInventoryService');

        // pageSize=1: página 2 tiene que ser el SEGUNDO más caro (r-b), no "b"
        // alfabético (que también sería r-b acá, así que se confirma con la 3).
        const page2 = await searchResources(TENANT, { page: 2, pageSize: 1 });
        const page3 = await searchResources(TENANT, { page: 3, pageSize: 1 });

        expect(page2.rows.map(r => r.name)).toEqual(['r-b']);
        expect(page3.rows.map(r => r.name)).toEqual(['r-a']);
    });

    it('por encima del techo, degrada a orden alfabético y marca sortedByCost=false', async () => {
        const many = Array.from({ length: 501 }, (_, i) => ({
            id: `/sub/r-${String(i).padStart(4, '0')}`,
            name: `r-${String(i).padStart(4, '0')}`,
            subscriptionId: 'sub-a',
            resourceGroup: 'rg1',
            tags: {},
            createdTime: null,
        }));
        mockResourceGraph(many);
        mockCostManagement({});
        const { searchResources } = await import('@/modules/collectors/azure/resourceInventoryService');

        const result = await searchResources(TENANT, { page: 1, pageSize: 15 });

        expect(result.sortedByCost).toBe(false);
        // Orden alfabético de siempre: los primeros 15 por nombre.
        expect(result.rows[0].name).toBe('r-0000');
        expect(result.rows[14].name).toBe('r-0014');
    });
});
