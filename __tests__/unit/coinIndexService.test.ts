import { describe, it, expect } from 'vitest';
import { getCoinIndexSummary } from '@/services/coinIndexService';

describe('coinIndexService', () => {
    it('returns consistent mock data for demo tenants', async () => {
        const result = await getCoinIndexSummary('demo-tenant', 90);

        expect(result.success).toBe(true);
        expect(result.mock).toBe(true);
        expect(result.windowDays).toBe(90);

        // Conciliación de 5 estados
        expect(result.statusBreakdown).toBeDefined();
        expect(result.statusBreakdown.total).toBe(75);
        expect(result.statusBreakdown.pending).toBe(75);
        expect(result.statusBreakdown.accepted).toBe(0);
        expect(result.statusBreakdown.implemented).toBe(0);
        expect(result.statusBreakdown.snoozed).toBe(0);
        expect(result.statusBreakdown.dismissed).toBe(0);

        // Suma de estados debe ser exactamente igual a total
        const sum =
            result.statusBreakdown.pending +
            result.statusBreakdown.accepted +
            result.statusBreakdown.implemented +
            result.statusBreakdown.snoozed +
            result.statusBreakdown.dismissed;
        expect(sum).toBe(result.statusBreakdown.total);

        // Cálculo Dual de COIN
        expect(result.coinVolumeRate).toBe(0);
        expect(result.coinFinancialRate).toBe(0);
        expect(result.totalPotentialSavingsUsd).toBe(420.0);
        expect(result.realizedSavingsUsd).toBe(0.0);

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
});
