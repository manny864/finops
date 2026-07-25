import { describe, it, expect } from 'vitest';
import {
    awsMultiplierForTier,
    awsMonthlyTotal,
    getAwsDemoAccounts,
    getAwsCostByService,
    getAwsCostByRegion,
    getAwsDailyHistogram,
    getAwsRightsizing,
    getAwsOrphanResources,
    getAwsCommitmentSimulation,
    getAwsCostGroups,
    getAwsMockDataForRoute,
} from '@/lib/awsMockData';
import {
    isMockTenant,
    isAwsMockTenant,
    getMockDataForRoute,
    MOCK_AWS_TENANTS,
    MOCK_AZURE_TENANTS,
} from '@/lib/mockData';

const TIERS = ['essential', 'pro', 'business', 'enterprise'];

describe('awsMockData - escala por tier', () => {
    it('usa los mismos multiplicadores que los mocks de Azure', () => {
        expect(awsMultiplierForTier('essential')).toBe(1);
        expect(awsMultiplierForTier('pro')).toBe(3);
        expect(awsMultiplierForTier('professional')).toBe(3);
        expect(awsMultiplierForTier('business')).toBe(10);
        expect(awsMultiplierForTier('enterprise')).toBe(50);
    });

    it('cae a essential ante un tier desconocido en vez de romper', () => {
        expect(awsMultiplierForTier('no-existe')).toBe(1);
        expect(awsMultiplierForTier('')).toBe(1);
    });

    it('escala el gasto de forma estrictamente creciente entre tiers', () => {
        const totals = TIERS.map((t) => awsMonthlyTotal(awsMultiplierForTier(t)));
        for (let i = 1; i < totals.length; i++) {
            expect(totals[i]).toBeGreaterThan(totals[i - 1]);
        }
    });

    it('entrega más cuentas a medida que sube el tier', () => {
        const counts = TIERS.map((t) => getAwsDemoAccounts(t).length);
        for (let i = 1; i < counts.length; i++) {
            expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
        }
        expect(counts[0]).toBeGreaterThan(0);
    });
});

describe('awsMockData - determinismo', () => {
    it('devuelve exactamente lo mismo en dos llamadas seguidas', () => {
        for (const tier of TIERS) {
            expect(getAwsCostByService(tier)).toEqual(getAwsCostByService(tier));
            expect(getAwsCostByRegion(tier)).toEqual(getAwsCostByRegion(tier));
            expect(getAwsRightsizing(tier)).toEqual(getAwsRightsizing(tier));
            expect(getAwsCostGroups(tier)).toEqual(getAwsCostGroups(tier));
        }
    });
});

describe('awsMockData - forma de los datos', () => {
    it('genera identificadores de cuenta AWS de 12 dígitos', () => {
        for (const acc of getAwsDemoAccounts('enterprise')) {
            expect(acc.account_id).toMatch(/^\d{12}$/);
            expect(acc.role_arn).toBe(`arn:aws:iam::${acc.account_id}:role/CSCloudFinOpsReadOnly`);
        }
    });

    it('no repite números de cuenta entre las cuentas de demo', () => {
        const ids = getAwsDemoAccounts('enterprise').map((a) => a.account_id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('incluye al menos una cuenta en error para mostrar el camino no feliz', () => {
        const accounts = getAwsDemoAccounts('enterprise');
        expect(accounts.some((a) => a.sync_status === 'ERROR')).toBe(true);
    });

    it('reparte el gasto por servicio sumando el total del mes', () => {
        for (const tier of TIERS) {
            const total = awsMonthlyTotal(awsMultiplierForTier(tier));
            const sum = getAwsCostByService(tier).reduce((acc, s) => acc + s.cost, 0);
            expect(Math.abs(sum - total)).toBeLessThan(total * 0.01);
        }
    });

    it('reparte el gasto por región sumando el total del mes', () => {
        for (const tier of TIERS) {
            const total = awsMonthlyTotal(awsMultiplierForTier(tier));
            const sum = getAwsCostByRegion(tier).reduce((acc, r) => acc + r.cost, 0);
            expect(Math.abs(sum - total)).toBeLessThan(total * 0.01);
        }
    });

    it('usa códigos de servicio y región reales de AWS', () => {
        const services = getAwsCostByService('pro').map((s) => s.serviceCode);
        expect(services).toContain('AmazonEC2');
        expect(services.some((s) => s.startsWith('Microsoft.'))).toBe(false);

        const regions = getAwsCostByRegion('pro').map((r) => r.region);
        expect(regions).toContain('us-east-1');
        expect(regions.some((r) => r === 'eastus' || r === 'westeurope')).toBe(false);
    });

    it('produce un histograma diario ordenado y sin huecos de fecha', () => {
        const rows = getAwsDailyHistogram('business', 60);
        expect(rows).toHaveLength(60);
        for (let i = 1; i < rows.length; i++) {
            expect(rows[i].date > rows[i - 1].date).toBe(true);
        }
        for (const r of rows) {
            expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(r.cost).toBeGreaterThan(0);
        }
    });

    it('propone recursos huérfanos y rightsizing con ahorro positivo', () => {
        const rightsizing = getAwsRightsizing('business');
        expect(rightsizing.length).toBeGreaterThan(0);
        for (const r of rightsizing) {
            expect(r.savings).toBeGreaterThan(0);
            expect(r.current).not.toBe(r.recommended);
            expect(r.instanceId).toMatch(/^i-[0-9a-f]+$/);
        }

        const orphans = getAwsOrphanResources('business');
        expect(orphans.length).toBeGreaterThan(0);
        for (const o of orphans) {
            expect(o.monthlyCost).toBeGreaterThan(0);
        }
    });

    it('simula compromisos con más ahorro a 3 años que a 1 año', () => {
        for (const tier of TIERS) {
            const sim = getAwsCommitmentSimulation(tier);
            expect(sim.savingsPlan.threeYear.monthlySavings)
                .toBeGreaterThan(sim.savingsPlan.oneYear.monthlySavings);
            expect(sim.reservedInstances.threeYear.monthlySavings)
                .toBeGreaterThan(sim.reservedInstances.oneYear.monthlySavings);
            // El ahorro nunca puede superar el gasto on-demand que se compromete.
            expect(sim.savingsPlan.threeYear.monthlySavings).toBeLessThan(sim.onDemandSpend);
            expect(sim.reservedInstances.threeYear.monthlySavings).toBeLessThan(sim.onDemandSpend);
        }
    });

    it('usa Savings Plans y Reserved Instances, no los nombres de Azure', () => {
        const sim = getAwsCommitmentSimulation('business');
        expect(sim).toHaveProperty('savingsPlan');
        expect(sim).toHaveProperty('reservedInstances');
        expect(JSON.stringify(sim)).not.toMatch(/Azure|Hybrid Benefit/i);
    });
});

describe('getAwsMockDataForRoute', () => {
    it('marca todas las respuestas como mock y de proveedor AWS', () => {
        const routes = ['aws-accounts', 'dashboard_summary', 'cost-by-category', 'cost_groups', 'simulator', 'rightsizing', 'zombies', 'cost-by-region'];
        for (const route of routes) {
            const payload = getAwsMockDataForRoute(route, 'pro');
            expect(payload, `ruta ${route} sin datos`).not.toBeNull();
            expect(payload!.mock).toBe(true);
            expect(payload!.provider).toBe('AWS');
            expect(payload!.currency).toBe('USD');
        }
    });

    it('devuelve null en rutas sin equivalente AWS para que caiga al mock genérico', () => {
        expect(getAwsMockDataForRoute('academy', 'pro')).toBeNull();
        expect(getAwsMockDataForRoute('ruta-inventada', 'pro')).toBeNull();
    });

    it('escala el resumen del panel según el tier', () => {
        const essential = getAwsMockDataForRoute('dashboard_summary', 'essential')!;
        const enterprise = getAwsMockDataForRoute('dashboard_summary', 'enterprise')!;
        expect(Number(enterprise.actualCost)).toBeGreaterThan(Number(essential.actualCost));
        expect(Number(essential.actualCost)).toBeGreaterThan(0);
    });

    it('proyecta un costo mayor al real y un ahorro menor al total', () => {
        for (const tier of TIERS) {
            const s = getAwsMockDataForRoute('dashboard_summary', tier)!;
            expect(Number(s.projectedCost)).toBeGreaterThan(Number(s.actualCost));
            expect(Number(s.potentialSavings)).toBeLessThan(Number(s.actualCost));
            expect(Number(s.potentialSavings)).toBeGreaterThan(0);
        }
    });
});

describe('integración con los tenants de demo', () => {
    it('reconoce los tenants AWS como tenants de demo', () => {
        for (const id of MOCK_AWS_TENANTS) {
            expect(isMockTenant(id)).toBe(true);
            expect(isAwsMockTenant(id)).toBe(true);
        }
    });

    it('no confunde un tenant de demo Azure con uno de AWS', () => {
        for (const id of MOCK_AZURE_TENANTS) {
            expect(isMockTenant(id)).toBe(true);
            expect(isAwsMockTenant(id)).toBe(false);
        }
        expect(isAwsMockTenant('demo_tenant')).toBe(false);
    });

    it('no reutiliza identificadores entre los tenants Azure y AWS', () => {
        const all = [...MOCK_AZURE_TENANTS, ...MOCK_AWS_TENANTS];
        expect(new Set(all).size).toBe(all.length);
    });

    it('devuelve datos AWS cuando el tenant de demo es AWS', () => {
        const payload = getMockDataForRoute('dashboard_summary', MOCK_AWS_TENANTS[1]) as Record<string, unknown>;
        expect(payload.provider).toBe('AWS');
    });

    it('sigue devolviendo datos Azure para los tenants de demo Azure', () => {
        const payload = getMockDataForRoute('dashboard_summary', MOCK_AZURE_TENANTS[1]) as Record<string, unknown>;
        expect(payload.provider).not.toBe('AWS');
    });

    it('cae al mock genérico cuando la ruta no tiene versión AWS', () => {
        const payload = getMockDataForRoute('academy', MOCK_AWS_TENANTS[0]);
        expect(payload).toBeTruthy();
    });

    it('escala igual que Azure: mismo tier, mismo orden de magnitud', () => {
        for (let i = 0; i < MOCK_AWS_TENANTS.length; i++) {
            const aws = getMockDataForRoute('dashboard_summary', MOCK_AWS_TENANTS[i]) as Record<string, unknown>;
            const azure = getMockDataForRoute('dashboard_summary', MOCK_AZURE_TENANTS[i]) as Record<string, unknown>;
            const awsCost = Number(aws.actualCost);
            const azureCost = Number(azure.actualCost);
            expect(awsCost).toBeGreaterThan(0);
            expect(azureCost).toBeGreaterThan(0);
            const ratio = awsCost / azureCost;
            expect(ratio).toBeGreaterThan(0.2);
            expect(ratio).toBeLessThan(5);
        }
    });
});
