import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCoinIndexSummary } from '@/services/coinIndexService';

vi.mock('@/modules/storage/db', () => ({
    default: {
        query: vi.fn(),
    },
    initializeDatabase: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/services/azureAdvisor.service', () => ({
    getAdvisorExecutiveData: vi.fn(),
}));

import pool from '@/modules/storage/db';
import { getAdvisorExecutiveData } from '@/services/azureAdvisor.service';

describe('coinIndexService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns consistent mock data for demo tenants', async () => {
        const result = await getCoinIndexSummary('demo-tenant', 90);

        expect(result.success).toBe(true);
        expect(result.mock).toBe(true);
        expect(result.windowDays).toBe(90);

        // Conciliación de 5 estados.
        //
        // Antes se afirmaba TODO en pending (75/0/0/0/0). Eso daba 0% de COIN y
        // "0 de 75 implementadas" justo en la pantalla que mide la tasa de
        // ejecucion, que es de donde salen las capturas del marketplace. No se
        // notaba porque el navegador recibia otro mock, interceptado en
        // TenantProvider, que mostraba 67,3% pero sin recomendaciones (el modal
        // salia vacio). Al sacar esa intercepcion, este mock pasa a ser el que
        // se ve, asi que reparte estados de forma realista.
        expect(result.statusBreakdown).toBeDefined();
        expect(result.statusBreakdown.total).toBe(75);
        expect(result.statusBreakdown.pending).toBe(14);
        expect(result.statusBreakdown.accepted).toBe(6);
        expect(result.statusBreakdown.implemented).toBe(50);
        expect(result.statusBreakdown.snoozed).toBe(3);
        expect(result.statusBreakdown.dismissed).toBe(2);

        // 50/75 = 66,7%: el numero con el que se hicieron las capturas.
        expect(result.coinVolumeRate).toBe(66.7);

        // El COIN financiero tiene que reconciliar con la lista, no ser 0 fijo.
        expect(result.totalPotentialSavingsUsd).toBeGreaterThan(0);
        expect(result.realizedSavingsUsd).toBeGreaterThan(0);
        expect(result.realizedSavingsUsd).toBeLessThanOrEqual(result.totalPotentialSavingsUsd);

        // Las cinco quick wins son PENDIENTES: la tarjeta se llama
        // "Top Quick Wins Pending Implementation".
        expect(result.quickWins?.length).toBe(5);
        expect(result.quickWins?.every((q: any) => q.status === 'pending')).toBe(true);

        // Suma de estados debe ser exactamente igual a total
        const sum =
            result.statusBreakdown.pending +
            result.statusBreakdown.accepted +
            result.statusBreakdown.implemented +
            result.statusBreakdown.snoozed +
            result.statusBreakdown.dismissed;
        expect(sum).toBe(result.statusBreakdown.total);

        // Cálculo dual de COIN. El financiero se deriva de las recomendaciones
        // implementadas; antes eran 420 y 0 fijos y no reconciliaban con nada.
        expect(result.coinFinancialRate).toBeGreaterThan(0);

        // 5 Pilares WAF
        expect(result.breakdown).toHaveLength(5);
        const categories = result.breakdown.map((b) => b.category);
        expect(categories).toContain('Cost');
        expect(categories).toContain('Security');
        expect(categories).toContain('Reliability');
        expect(categories).toContain('Performance');
        expect(categories).toContain('OperationalExcellence');

        // Serie mensual (6 meses) con benchmark 70%
        expect(result.monthly).toHaveLength(6);
        expect(result.monthly[0].benchmarkTarget).toBe(70);

        // Top Quick Wins
        expect(result.quickWins.length).toBeGreaterThanOrEqual(1);
        expect(result.quickWins[0].estimatedMonthlySavingsUsd).toBeGreaterThan(0);
        expect(result.quickWins[0].targetModuleUrl).toBeDefined();
    });

    it('calculates exact rates and properly excludes dismissed and snoozed recommendations for live tenants', async () => {
        const mockActions = [
            {
                recommendation_id: 'rec-cost-imp',
                category: 'Cost',
                status: 'implemented',
                user_email: 'admin@corp.com',
                expires_at: null,
                updated_at: new Date().toISOString(),
            },
            {
                recommendation_id: 'rec-cost-snooze',
                category: 'Cost',
                status: 'suppressed',
                user_email: 'admin@corp.com',
                expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
                updated_at: new Date().toISOString(),
            },
            {
                recommendation_id: 'rec-cost-dismiss',
                category: 'Cost',
                status: 'dismissed',
                user_email: 'admin@corp.com',
                expires_at: null,
                updated_at: new Date().toISOString(),
            },
        ];

        (pool.query as any).mockImplementation((sql: string) => {
            if (sql.includes('UPDATE RecommendationActions')) return Promise.resolve([{}]);
            if (sql.includes('FROM RecommendationActions') && sql.includes('DATE_FORMAT')) {
                return Promise.resolve([[
                    { month: new Date().toISOString().slice(0, 7), implemented: 1, total: 4 }
                ]]);
            }
            if (sql.includes('FROM RecommendationActions')) return Promise.resolve([mockActions]);
            return Promise.resolve([[]]);
        });

        (getAdvisorExecutiveData as any).mockResolvedValue({
            success: true,
            recommendations: {
                Cost: [
                    {
                        id: 'rec-cost-imp',
                        name: 'Upgrade VM to latest Gen',
                        category: 'Cost',
                        monthlySavingsUSD: 100,
                        annualSavingsUSD: 1200,
                        resourceName: 'vm-prod-app-01',
                        subscriptionName: 'Producción Corporativa',
                    },
                    {
                        id: 'rec-cost-pending-1',
                        name: 'Delete unattached disks',
                        category: 'Cost',
                        monthlySavingsUSD: 50,
                        annualSavingsUSD: 600,
                        resourceName: 'disk-orphan-01',
                        subscriptionName: 'Producción Corporativa',
                    },
                ],
                Security: [
                    {
                        id: 'rec-sec-pending',
                        name: 'Enable MFA',
                        category: 'Security',
                        monthlySavingsUSD: 0,
                        resourceName: 'sub-prod',
                        subscriptionName: 'Producción Corporativa',
                    }
                ],
                HighAvailability: [],
                Performance: [],
                OperationalExcellence: [],
            },
        });

        const result = await getCoinIndexSummary('real-tenant-guid-123', 90);

        expect(result.success).toBe(true);
        expect(result.mock).toBeUndefined();

        // Estados: 2 pending (1 cost, 1 sec), 1 implemented (cost), 1 snoozed (cost), 1 dismissed (cost) = total 5
        expect(result.statusBreakdown.implemented).toBe(1);
        expect(result.statusBreakdown.snoozed).toBe(1);
        expect(result.statusBreakdown.dismissed).toBe(1);
        expect(result.statusBreakdown.pending).toBe(2);
        expect(result.statusBreakdown.total).toBe(5);

        // COIN por volumen: 1 / 5 = 20%
        expect(result.coinVolumeRate).toBe(20);

        // Ahorros:
        // implemented (100) + pending (50) = 150 potential
        // realized = 100
        // dismissed y snoozed NO cuentan como pending
        expect(result.realizedSavingsUsd).toBe(100);
        expect(result.totalPotentialSavingsUsd).toBe(150);
        // Financial rate: 100 / 150 = 66.7%
        expect(result.coinFinancialRate).toBe(66.7);

        // Quick wins no debe tener GUIDs puros como nombre
        expect(result.quickWins[0].impactedResource).toBe('disk-orphan-01');

        // Lista consolidada de recomendaciones para modal
        expect(result.recommendations).toBeDefined();
        expect(result.recommendations?.length).toBe(5);
        expect(result.recommendations?.find((r) => r.id === 'rec-cost-imp')?.status).toBe('implemented');
        expect(result.recommendations?.find((r) => r.id === 'rec-cost-snooze')?.status).toBe('snoozed');
        expect(result.recommendations?.find((r) => r.id === 'rec-cost-dismiss')?.status).toBe('dismissed');
        expect(result.recommendations?.find((r) => r.id === 'rec-cost-pending-1')?.status).toBe('pending');
    });

    /**
     * El locale tiene que llegar a Advisor.
     *
     * Estaba HARDCODEADO: `getAdvisorExecutiveData(tenantId, "es")`. Advisor ya
     * sabia traducir --resuelve titleTranslated/descriptionTranslated segun el
     * locale-- y tres rutas mas ya se lo pasaban; esta era la unica que no. El
     * sintoma era el modal de recomendaciones del indice mostrando
     * "Redimensionar o apagar maquinas virtuales subutilizadas" sobre la UI en
     * ingles, y frases a medio traducir como "Virtual networks deberia estar
     * protected by Azure Firewall".
     *
     * Se afirma el argumento y no el texto de salida a proposito: el catalogo de
     * traducciones de Advisor cambia seguido y afirmar frases haria fallar el
     * test por motivos que no son este.
     */
    it('pasa el locale a Advisor en vez de fijarlo en "es"', async () => {
        (pool.query as any).mockResolvedValue([[], []]);
        (getAdvisorExecutiveData as any).mockResolvedValue({ recommendations: [], summary: {} });

        for (const locale of ['en', 'pt-BR', 'es']) {
            (getAdvisorExecutiveData as any).mockClear();
            await getCoinIndexSummary('tenant-vivo', 90, locale);
            expect(getAdvisorExecutiveData).toHaveBeenCalledWith('tenant-vivo', locale);
        }
    });

    /**
     * El mock tambien se traduce.
     *
     * Devolvia castellano fijo, asi que un tenant DEMO en la UI en ingles
     * mostraba "Redimensionar instancias de VM infrautilizadas" — y las capturas
     * del marketplace salen de los tenants demo.
     */
    it('traduce las recomendaciones mock segun el locale', async () => {
        const en = await getCoinIndexSummary('demo-tenant', 90, 'en');
        const es = await getCoinIndexSummary('demo-tenant', 90, 'es');
        const pt = await getCoinIndexSummary('demo-tenant', 90, 'pt-BR');

        const primera = (r: any) => r.recommendations?.find((x: any) => x.id === 'rec-mock-01');

        expect(primera(en)?.name).toBe('Delete unmanaged disks and orphaned snapshots');
        expect(primera(es)?.name).toBe('Eliminar discos no administrados y snapshots huérfanos');
        expect(primera(pt)?.name).toBe('Excluir discos não gerenciados e snapshots órfãos');

        // El nombre de la suscripcion tambien, y el relleno generado (items 9-75).
        expect(primera(en)?.subscriptionName).toBe('Main Production');
        const relleno = (r: any) => r.recommendations?.find((x: any) => x.id === 'rec-mock-20');
        expect(relleno(en)?.description).toContain('WAF recommendation to improve');
        expect(relleno(es)?.description).toContain('Recomendación WAF para mejorar');

        // La estructura no cambia con el idioma: mismo conteo y mismos ids.
        expect(en.recommendations?.length).toBe(es.recommendations?.length);
        expect(en.recommendations?.map((r: any) => r.id)).toEqual(es.recommendations?.map((r: any) => r.id));
    });

    it('sin locale explicito cae en "es", que es el comportamiento previo', async () => {
        (pool.query as any).mockResolvedValue([[], []]);
        (getAdvisorExecutiveData as any).mockResolvedValue({ recommendations: [], summary: {} });

        await getCoinIndexSummary('tenant-vivo', 90);
        expect(getAdvisorExecutiveData).toHaveBeenCalledWith('tenant-vivo', 'es');
    });
});

