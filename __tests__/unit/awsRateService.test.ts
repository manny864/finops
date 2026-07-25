import { describe, it, expect } from 'vitest';
import {
    mapRiRecommendations,
    buildRiRows,
    mapSavingsPlan,
    mergeSavingsPlanRows,
} from '@/modules/collectors/aws/awsRateService';

/**
 * Fixture con la forma real de la respuesta de
 * `GetReservationPurchaseRecommendation`. Los importes llegan como string,
 * igual que en la API.
 */
function riResponse(instanceType: string, region: string, onDemand: string, savings: string, qty = '2') {
    return [{
        RecommendationDetails: [{
            InstanceDetails: { EC2InstanceDetails: { InstanceType: instanceType, Region: region } },
            RecommendedNumberOfInstancesToPurchase: qty,
            EstimatedMonthlyOnDemandCost: onDemand,
            EstimatedMonthlySavingsAmount: savings,
        }],
    }] as never;
}

describe('awsRateService · Reserved Instances', () => {
    it('agrupa por tipo de instancia y region, no solo por tipo', () => {
        const recs = [{
            RecommendationDetails: [
                {
                    InstanceDetails: { EC2InstanceDetails: { InstanceType: 'm5.large', Region: 'us-east-1' } },
                    RecommendedNumberOfInstancesToPurchase: '2',
                    EstimatedMonthlyOnDemandCost: '100',
                    EstimatedMonthlySavingsAmount: '40',
                },
                {
                    InstanceDetails: { EC2InstanceDetails: { InstanceType: 'm5.large', Region: 'eu-west-1' } },
                    RecommendedNumberOfInstancesToPurchase: '1',
                    EstimatedMonthlyOnDemandCost: '60',
                    EstimatedMonthlySavingsAmount: '20',
                },
            ],
        }] as never;

        const map = mapRiRecommendations(recs);
        expect(map.size).toBe(2);
        expect(map.get('m5.large|us-east-1')!.monthlyOnDemand.toString()).toBe('100');
        expect(map.get('m5.large|eu-west-1')!.monthlyOnDemand.toString()).toBe('60');
    });

    it('suma las lineas del mismo tipo y region en vez de quedarse con la ultima', () => {
        const recs = [{
            RecommendationDetails: [
                {
                    InstanceDetails: { EC2InstanceDetails: { InstanceType: 'c6i.xlarge', Region: 'us-east-1' } },
                    RecommendedNumberOfInstancesToPurchase: '2',
                    EstimatedMonthlyOnDemandCost: '100',
                    EstimatedMonthlySavingsAmount: '30',
                },
                {
                    InstanceDetails: { EC2InstanceDetails: { InstanceType: 'c6i.xlarge', Region: 'us-east-1' } },
                    RecommendedNumberOfInstancesToPurchase: '3',
                    EstimatedMonthlyOnDemandCost: '50',
                    EstimatedMonthlySavingsAmount: '15',
                },
            ],
        }] as never;

        const map = mapRiRecommendations(recs);
        expect(map.size).toBe(1);
        const row = map.get('c6i.xlarge|us-east-1')!;
        expect(row.quantity).toBe(5);
        expect(row.monthlyOnDemand.toString()).toBe('150');
        expect(row.monthlySavings.toString()).toBe('45');
    });

    it('descarta lineas sin tipo de instancia o sin region', () => {
        const recs = [{
            RecommendationDetails: [
                { InstanceDetails: { EC2InstanceDetails: { Region: 'us-east-1' } }, EstimatedMonthlyOnDemandCost: '10' },
                { InstanceDetails: {}, EstimatedMonthlyOnDemandCost: '10' },
                {},
            ],
        }] as never;
        expect(mapRiRecommendations(recs).size).toBe(0);
    });

    it('tolera una respuesta vacia o ausente', () => {
        expect(mapRiRecommendations(undefined).size).toBe(0);
        expect(mapRiRecommendations([] as never).size).toBe(0);
    });

    it('anualiza los importes mensuales que devuelve AWS', () => {
        const rows = buildRiRows(
            mapRiRecommendations(riResponse('m5.large', 'us-east-1', '100', '40')),
            mapRiRecommendations(riResponse('m5.large', 'us-east-1', '100', '60'))
        );

        expect(rows).toHaveLength(1);
        const row = rows[0];
        expect(row.monthlyCost).toBe(100);
        expect(row.annualCost).toBe(1200);
        // 40/mes durante 12 meses.
        expect(row.savings1Y).toBe(480);
        // 60/mes durante 36 meses.
        expect(row.savings3Y).toBe(2160);
        expect(row.annualCost1Y).toBe(720);
        expect(row.annualCost3Y).toBe(480);
    });

    it('deja el ahorro en cero cuando AWS no recomienda ese termino, sin extrapolar del otro', () => {
        // AWS deja de recomendar 3 anios cuando el uso no es estable. Inferirlo
        // desde el termino de 1 anio inventaria un ahorro que AWS no ofrece.
        const rows = buildRiRows(
            mapRiRecommendations(riResponse('r6g.large', 'us-east-1', '80', '30')),
            mapRiRecommendations(undefined)
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].savings1Y).toBe(360);
        expect(rows[0].savings3Y).toBe(0);
        expect(rows[0].annualCost3Y).toBe(0);
    });

    it('usa nomenclatura AWS: el tipo de recurso es EC2 Instance y el sku el tipo de instancia', () => {
        const rows = buildRiRows(
            mapRiRecommendations(riResponse('m5.2xlarge', 'sa-east-1', '200', '80', '3')),
            mapRiRecommendations(undefined)
        );
        expect(rows[0].resourceType).toBe('EC2 Instance');
        expect(rows[0].sku).toBe('m5.2xlarge');
        expect(rows[0].region).toBe('sa-east-1');
        expect(rows[0].resourceName).toContain('m5.2xlarge');
        expect(rows[0].resourceName).not.toMatch(/Standard_|virtualMachines/i);
    });

    it('replica el costo on-demand en la columna de licencia, porque AWS no tiene el descuento de Azure', () => {
        const rows = buildRiRows(
            mapRiRecommendations(riResponse('t3.large', 'us-west-2', '45', '18')),
            mapRiRecommendations(undefined)
        );
        expect(rows[0].monthlyCostLicenseIncluded).toBe(rows[0].monthlyCost);
    });

    it('ordena por el mayor ahorro de cualquiera de los dos terminos', () => {
        const y1 = new Map([
            ...mapRiRecommendations(riResponse('a', 'r', '100', '10')),
            ...mapRiRecommendations(riResponse('b', 'r', '100', '50')),
        ]);
        const rows = buildRiRows(y1 as never, mapRiRecommendations(undefined));
        expect(rows.map((r) => r.sku)).toEqual(['b', 'a']);
    });
});

describe('awsRateService · Savings Plans', () => {
    const summary = (hourly: string, savings: string, onDemand: string) => ({
        SavingsPlansType: 'COMPUTE_SP',
        SavingsPlansPurchaseRecommendationSummary: {
            HourlyCommitmentToPurchase: hourly,
            EstimatedMonthlySavingsAmount: savings,
            CurrentOnDemandSpend: onDemand,
        },
    }) as never;

    it('expone el compromiso horario como cantidad, no una cantidad de instancias', () => {
        const row = mapSavingsPlan(summary('1.2345', '300', '1000'), '1Y')!;
        // Redondeado a dos decimales: es un compromiso en USD/hora.
        expect(row.recommendedQuantity).toBe(1.23);
        expect(row.resourceType).toBe('SavingsPlans');
        expect(row.skuName).toBe('Compute Savings Plans');
    });

    it('deriva el costo comprometido restando el ahorro al gasto on-demand', () => {
        const row = mapSavingsPlan(summary('1', '300', '1000'), '1Y')!;
        expect(row.totalMonthlyPAYGCost).toBe(1000);
        expect(row.costWith1YReservation).toBe(700);
        expect(row.netSavings1Y).toBe(3600);
        // El termino de 3 anios no se infiere del de 1.
        expect(row.costWith3YReservation).toBe(0);
        expect(row.netSavings3Y).toBe(0);
    });

    it('anualiza el termino de 3 anios sobre los 36 meses', () => {
        const row = mapSavingsPlan(summary('1', '300', '1000'), '3Y')!;
        expect(row.netSavings3Y).toBe(10800);
        expect(row.netSavings1Y).toBe(0);
    });

    it('descarta la recomendacion vacia en vez de mostrar una fila en cero', () => {
        expect(mapSavingsPlan(summary('0', '0', '0'), '1Y')).toBeNull();
        expect(mapSavingsPlan(undefined, '1Y')).toBeNull();
    });

    it('distingue el tipo de Savings Plan', () => {
        const ec2 = {
            SavingsPlansType: 'EC2_INSTANCE_SP',
            SavingsPlansPurchaseRecommendationSummary: {
                HourlyCommitmentToPurchase: '2', EstimatedMonthlySavingsAmount: '100', CurrentOnDemandSpend: '500',
            },
        } as never;
        expect(mapSavingsPlan(ec2, '1Y')!.skuName).toBe('EC2 Instance Savings Plans');
    });

    it('une los dos terminos del mismo tipo en una sola fila', () => {
        const merged = mergeSavingsPlanRows([
            mapSavingsPlan(summary('1', '300', '1000'), '1Y'),
            mapSavingsPlan(summary('1', '450', '1000'), '3Y'),
        ]);

        expect(merged).toHaveLength(1);
        expect(merged[0].netSavings1Y).toBe(3600);
        expect(merged[0].netSavings3Y).toBe(16200);
        expect(merged[0].costWith1YReservation).toBe(700);
        expect(merged[0].costWith3YReservation).toBe(550);
    });

    it('no mezcla tipos distintos de Savings Plan', () => {
        const ec2 = {
            SavingsPlansType: 'EC2_INSTANCE_SP',
            SavingsPlansPurchaseRecommendationSummary: {
                HourlyCommitmentToPurchase: '2', EstimatedMonthlySavingsAmount: '100', CurrentOnDemandSpend: '500',
            },
        } as never;
        const merged = mergeSavingsPlanRows([
            mapSavingsPlan(summary('1', '300', '1000'), '1Y'),
            mapSavingsPlan(ec2, '1Y'),
        ]);
        expect(merged).toHaveLength(2);
    });

    it('ignora los nulos sin romper', () => {
        expect(mergeSavingsPlanRows([null, null])).toEqual([]);
    });
});
