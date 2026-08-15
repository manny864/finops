// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Fija la garantía del 2026-07-30: las consultas de costo con scope 'All' no
 * deben pegarle al management group.
 *
 * El MG llamado como el tenant NO EXISTE — en prod la llamada fallaba con
 * BadRequest ("Management group 81ebe027-… does not exist") y recién entonces se
 * caía al camino per-subscription. Saltearlo evita una llamada garantizada a
 * fallar por cada consulta.
 *
 * ⚠ Este test NO cubre el desfase de los KPIs contra el portal. La versión
 * original de este comentario atribuía ese desfase al MG (supuestamente un
 * agregado retrasado que respondía 200 con menos filas); era un diagnóstico
 * equivocado. La causa real es el 429 que agota los reintentos de la consulta MTD
 * y hace que el KPI caiga en silencio al valor incompleto de CostSnapshots.
 *
 * Si alguien vuelve a poner el scope de MG como camino feliz, este test falla.
 */

const usageScopes: string[] = [];
const forecastScopes: string[] = [];

vi.mock('@azure/arm-costmanagement', () => ({
    CostManagementClient: class {
        query = {
            usage: async (scope: string) => {
                usageScopes.push(scope);
                return {
                    columns: [{ name: 'CostUSD' }, { name: 'UsageDate' }, { name: 'SubscriptionId' }],
                    rows: [[1.23, '20260730', 'sub-a']],
                };
            },
        };
        forecast = {
            usage: async (scope: string) => {
                forecastScopes.push(scope);
                return { columns: [{ name: 'CostUSD' }, { name: 'UsageDate' }], rows: [[1, '20260731']] };
            },
        };
    },
}));

vi.mock('@/lib/azure', () => ({
    getAzureCredential: async () => ({ getToken: async () => ({ token: 'fake-token' }) }),
    getAllSubscriptionsForTenant: async () => ['sub-a', 'sub-b'],
}));

vi.mock('@/lib/redis', () => ({
    redis: { get: async () => null, set: async () => 'OK' },
}));

vi.mock('@/lib/azureCostColumn', () => ({
    resolveCostColumn: async () => 'CostUSD',
    degradeCostColumn: async () => undefined,
    isCostUsdUnsupportedError: () => false,
    withCostColumn: (o: any) => o,
    findCostColumnIndex: () => 0,
}));

const TENANT = '81ebe027-e6af-4e09-bc73-58c9012c6408';

beforeEach(() => {
    // Reloj fijo a mitad de mes. getCostForecast tiene una guarda deliberada que
    // el ÚLTIMO día del mes corta y devuelve [] sin llamar a la API (Azure
    // rechaza timePeriod.from === to con 400, ver billingService.ts), así que sin
    // fijar la fecha este archivo falla cada día 31 — pasó en CI el
    // 2026-07-31T00:00Z, con el run del commit anterior en verde a las 23:5x del
    // día 30. Se falsea SÓLO Date: setTimeout queda real para no colgar los
    // backoffs internos del servicio. Directiva AGENTS.md #16.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));

    usageScopes.length = 0;
    forecastScopes.length = 0;
    // Descubrimiento de suscripciones (el camino per-subscription lo consulta por REST).
    vi.stubGlobal('fetch', async () => ({
        ok: true,
        json: async () => ({
            value: [
                { subscriptionId: 'sub-a', state: 'Enabled' },
                { subscriptionId: 'sub-b', state: 'Enabled' },
            ],
        }),
    }));
});

afterEach(() => {
    vi.useRealTimers();
});

describe("scope de Cost Management para 'All'", () => {
    it('getCurrentMonthAmortizedCosts itera suscripciones y no toca el management group', async () => {
        const { getCurrentMonthAmortizedCosts } = await import('@/modules/collectors/azure/billingService');
        await getCurrentMonthAmortizedCosts(TENANT, 'All', 'ActualCost');

        expect(usageScopes.length).toBeGreaterThan(0);
        expect(usageScopes.some((s) => s.includes('managementGroups'))).toBe(false);
        expect(usageScopes).toContain('/subscriptions/sub-a');
        expect(usageScopes).toContain('/subscriptions/sub-b');
    });

    it('getCostForecast tampoco usa el management group', async () => {
        const { getCostForecast } = await import('@/modules/collectors/azure/billingService');
        await getCostForecast(TENANT, 'All', 'ActualCost');

        expect(forecastScopes.some((s) => s.includes('managementGroups'))).toBe(false);
        expect(forecastScopes).toContain('/subscriptions/sub-a');
    });

    it('getYesterdaysCost suma por suscripción, sin management group', async () => {
        const { getYesterdaysCost } = await import('@/modules/collectors/azure/billingService');
        const total = await getYesterdaysCost(TENANT);

        expect(usageScopes.some((s) => s.includes('managementGroups'))).toBe(false);
        expect(usageScopes).toContain('/subscriptions/sub-a');
        expect(usageScopes).toContain('/subscriptions/sub-b');
        // 1.23 por cada una de las dos suscripciones.
        expect(total.toFixed(2)).toBe('2.46');
    });

    it('un subscriptionId explícito sigue usando el scope de esa suscripción', async () => {
        const { getCurrentMonthAmortizedCosts } = await import('@/modules/collectors/azure/billingService');
        await getCurrentMonthAmortizedCosts(TENANT, 'sub-a', 'ActualCost');

        expect(usageScopes).toEqual(['/subscriptions/sub-a']);
    });
});
