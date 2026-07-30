// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Fija la garantía del fix del 2026-07-30: las consultas de costo con scope
 * 'All' NUNCA deben pegarle al management group.
 *
 * El agregado del MG va retrasado respecto al de suscripción y devuelve montos
 * incompletos SIN error (HTTP 200 con menos filas), así que el fallback
 * per-subscription no se activaba y los KPIs de Costo Actual / Proyectado
 * quedaban por debajo del valor real de Cost Management. Medido en prod sobre un
 * tenant de UNA sola suscripción: MG 7.62 vs suscripción 12.77 (portal 12.78).
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
