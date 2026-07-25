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
    getAwsChargebackMock,
    getAwsAllocationRulesMock,
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

describe('captured_savings (AWS)', () => {
    it('devuelve una serie de 6 meses con datos AWS', () => {
        const r = getAwsMockDataForRoute('captured_savings', 'business') as any;
        expect(r).not.toBeNull();
        expect(r.provider).toBe('AWS');
        expect(r.history).toHaveLength(6);
        expect(r.current.potentialSavings).toBeGreaterThan(0);
        // El ahorro capturado nunca puede superar al desperdicio total.
        for (const p of r.history) {
            expect(p.potentialSavings).toBeLessThan(p.totalWasted);
        }
    });

    it('escala con el tier', () => {
        const ess = getAwsMockDataForRoute('captured_savings', 'essential') as any;
        const ent = getAwsMockDataForRoute('captured_savings', 'enterprise') as any;
        expect(ent.current.potentialSavings).toBeGreaterThan(ess.current.potentialSavings);
    });
});

describe('white_board (AWS)', () => {
    it('sirve los bloques de costo con datos AWS', () => {
        const r = getAwsMockDataForRoute('white_board', 'business') as any;
        expect(r).not.toBeNull();
        expect(r.costs.currentFYCost).toBeGreaterThan(0);
        expect(r.costs.top3Services).toHaveLength(3);
        expect(r.top5Locations.length).toBeGreaterThan(0);
        // Las regiones tienen que ser de AWS, no de Azure.
        expect(r.top5Locations.some((l: any) => /^(us|eu|ap|sa)-/.test(l.name))).toBe(true);
    });

    it('no inventa inventario ni recomendaciones que AWS todavia no ingesta', () => {
        // Si algun dia estos dejan de estar en cero es porque se implemento la
        // ingesta: hay que actualizar el mock, no borrar el test.
        const r = getAwsMockDataForRoute('white_board', 'enterprise') as any;
        expect(r.governance.untagged.count).toBe(0);
        expect(r.recommendations.open).toBe(0);
        expect(r.top3ThreatCategories).toEqual([]);
    });
});

describe('top_expenses (AWS)', () => {
    it('rankea cuentas con alias legible y regiones AWS', () => {
        const r = getAwsMockDataForRoute('top_expenses', 'pro') as any;
        expect(r).not.toBeNull();
        expect(r.topSubscriptions.length).toBeGreaterThan(0);
        // El account ID suelto no dice nada: tiene que venir con el alias.
        expect(r.topSubscriptions[0].name).toMatch(/^.+ \(\d{12}\)$/);
        expect(r.topResourceGroups[0].name).toMatch(/^(us|eu|ap|sa)-/);
        // Ranking decreciente, si no el grafico se ve plano.
        const costs = r.topSubscriptions.map((s: any) => s.cost);
        expect([...costs].sort((a, b) => b - a)).toEqual(costs);
    });

    it('refleja que sin CUR no hay asignacion por centro de costo', () => {
        const r = getAwsMockDataForRoute('top_expenses', 'enterprise') as any;
        expect(r.topCostGroups).toEqual([{ name: 'Untagged/Unknown', cost: expect.any(Number) }]);
    });
});

describe('anomalies (AWS)', () => {    it('usa cuentas, regiones y unidades de facturacion de AWS', () => {
        const r = getAwsMockDataForRoute('anomalies', 'enterprise') as any;
        expect(r).not.toBeNull();
        expect(r.dailyCosts).toHaveLength(60);
        expect(r.anomalies.length).toBeGreaterThan(0);
        const a = r.anomalies[0];
        // En AWS la "suscripcion" es la cuenta: 12 digitos, no un sub-xxx.
        expect(a.subscription_id).toMatch(/^\d{12}$/);
        expect(a.top_contributors[0].resource_group).toMatch(/^(us|eu|ap|sa)-/);
        // Ningun servicio de Azure se debe colar en la atribucion de causa.
        const names = r.anomalies.map((x: any) => x.service).join(' ');
        expect(names).not.toMatch(/Azure|AKS|Cosmos DB|DTU/i);
    });

    it('es determinista entre llamadas', () => {
        const a = getAwsMockDataForRoute('anomalies', 'business') as any;
        const b = getAwsMockDataForRoute('anomalies', 'business') as any;
        expect(a.dailyCosts).toEqual(b.dailyCosts);
    });
});

describe('approvals (AWS)', () => {
    it('usa ARNs y acciones de AWS, nunca IDs de Azure', () => {
        const r = getAwsMockDataForRoute('approvals', 'business') as any;
        expect(r).not.toBeNull();
        expect(r.data.length).toBeGreaterThan(0);
        const serialized = JSON.stringify(r.data);
        expect(serialized).not.toMatch(/subscriptions\/|resourceGroups|Microsoft\.|Standard_[A-Z]|RIGHTSIZE_VM/i);
        for (const req of r.data) {
            expect(req.resource_id).toMatch(/^arn:aws:/);
            expect(req.estimated_savings).toBeGreaterThan(0);
            expect(['Pending', 'Approved', 'Rejected']).toContain(req.status);
            // La tabla de historial hace resolved_by.split('@'): no puede venir
            // en null para una solicitud ya resuelta.
            if (req.status !== 'Pending') expect(req.resolved_by).toBeTruthy();
        }
        // Los ids tienen que ser unicos: la lista se renderiza con key={id}.
        const ids = r.data.map((x: any) => x.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('acumula mas solicitudes en los tiers con mas cuentas', () => {
        const ess = (getAwsMockDataForRoute('approvals', 'essential') as any).data.length;
        const ent = (getAwsMockDataForRoute('approvals', 'enterprise') as any).data.length;
        expect(ent).toBeGreaterThan(ess);
    });
});

describe('alerts (AWS)', () => {
    it('no habla de suscripciones ni de servicios de Azure', () => {
        const r = getAwsMockDataForRoute('alerts', 'enterprise') as any;
        expect(r).not.toBeNull();
        expect(r.rules.length).toBeGreaterThan(0);
        const names = r.rules.map((x: any) => x.ruleName).join(' ');
        expect(names).not.toMatch(/Azure|Subscription|Suscripci|AKS|Hybrid Benefit/i);
        for (const rule of r.rules) {
            expect(['budget', 'anomaly', 'forecast', 'threshold', 'credential_expiry', 'ttl_expiry'])
                .toContain(rule.ruleType);
            expect(['email', 'webhook', 'teams', 'slack', 'servicenow']).toContain(rule.channel);
        }
    });

    it('destraba mas reglas a medida que sube el tier', () => {
        const counts = TIERS.map((t) => (getAwsMockDataForRoute('alerts', t) as any).rules.length);
        for (let i = 1; i < counts.length; i++) {
            expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
        }
    });
});

describe('orphans (AWS)', () => {
    it('nombra los recursos con la terminologia de AWS', () => {
        const types = getAwsOrphanResources('business').map((o) => o.type).join(' ');
        expect(types).not.toMatch(/Managed Disk|Virtual Machine|App Service|Public IP Address/i);
        expect(types).toMatch(/EBS Volume/);
        expect(types).toMatch(/Application Load Balancer/);
    });
});

describe('mocks de asignacion de costos AWS', () => {
    it('el chargeback reparte el total sin dejar costo fuera de ningun centro', () => {
        const { aggregated } = getAwsChargebackMock('enterprise');
        const suma = aggregated.reduce((s, a) => s + a.value, 0);
        // Las participaciones tienen que cubrir el 100%: si sumaran menos, la
        // demo mostraria un total que no coincide con el del dashboard.
        expect(aggregated.length).toBeGreaterThan(1);
        expect(suma).toBeGreaterThan(0);
        const detalle = getAwsChargebackMock('enterprise').detailed
            .reduce((s, d) => s + d.cost, 0);
        expect(Math.abs(detalle - suma) / suma).toBeLessThan(0.01);
    });

    it('el detalle usa region y servicio de AWS, no grupo de recursos ni ChargeType', () => {
        const { detailed } = getAwsChargebackMock('business');
        expect(detailed.length).toBeGreaterThan(0);
        for (const fila of detailed) {
            // En AWS `resourceGroup` transporta la region: si trajera un nombre
            // de grupo de recursos seria un dato de Azure filtrado.
            expect(fila.resourceGroup).toMatch(/^[a-z]{2}-[a-z]+-\d$/);
            expect(fila.chargeType).not.toMatch(/Usage|Purchase|Refund/);
            expect(fila.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it('escala con el tier', () => {
        const ess = getAwsChargebackMock('essential').aggregated.reduce((s, a) => s + a.value, 0);
        const ent = getAwsChargebackMock('enterprise').aggregated.reduce((s, a) => s + a.value, 0);
        expect(ent).toBeGreaterThan(ess);
    });

    it('las reglas de reparto suman 100% por recurso compartido y no nombran servicios de Azure', () => {
        const reglas = getAwsAllocationRulesMock();
        const porRecurso = new Map<string, number>();
        for (const r of reglas) {
            expect(r.resourceName).not.toMatch(/ExpressRoute|AKS|Microsoft\./i);
            porRecurso.set(r.resourceName, (porRecurso.get(r.resourceName) || 0) + r.allocationPercentage);
        }
        // Una regla que no cierra en 100 deja costo compartido sin repartir.
        for (const [, total] of porRecurso) expect(total).toBe(100);
        expect(new Set(reglas.map(r => r.id)).size).toBe(reglas.length);
    });

    it('el despachador entrega los mocks de asignacion a las rutas AWS', () => {
        const cb = getAwsMockDataForRoute('chargeback', 'business');
        expect(cb).not.toBeNull();
        expect(Array.isArray((cb as Record<string, unknown>).detailed)).toBe(true);
        const ar = getAwsMockDataForRoute('allocation-rules', 'business');
        expect(Array.isArray((ar as Record<string, unknown>).data)).toBe(true);
    });
});
