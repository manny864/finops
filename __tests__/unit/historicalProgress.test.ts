import { describe, it, expect } from 'vitest';
import { generateHistoricalProgressReport } from '@/lib/historicalProgressGenerator';
import { getMaturityLevel, HistoryTimeRange } from '@/lib/historicalProgressModel';

describe('Historical Progress Model & Generator', () => {
  it('determina el nivel de madurez FinOps correctamente', () => {
    expect(getMaturityLevel(85)).toBe('Run');
    expect(getMaturityLevel(75)).toBe('Run');
    expect(getMaturityLevel(60)).toBe('Walk');
    expect(getMaturityLevel(40)).toBe('Walk');
    expect(getMaturityLevel(39)).toBe('Crawl');
    expect(getMaturityLevel(10)).toBe('Crawl');
  });

  const timeRanges: HistoryTimeRange[] = ['30d', '90d', '180d', '365d'];

  timeRanges.forEach((range) => {
    it(`genera reporte consistente para el rango ${range}`, () => {
      const report = generateHistoricalProgressReport(range, 'business');

      expect(report.timeRange).toBe(range);
      expect(report.series.length).toBeGreaterThan(0);
      expect(report.currentMaturityScore).toBeGreaterThan(0);
      expect(report.totalCounterfactualSavings).toBeGreaterThan(0);
      expect(report.beforeAfterVerifications.length).toBeGreaterThan(0);
      expect(report.architectureMilestones.length).toBeGreaterThan(0);
      expect(report.waiverLedger.length).toBeGreaterThan(0);

      // Verificación de series temporales
      const first = report.series[0];
      const last = report.series[report.series.length - 1];

      expect(last.maturityScore).toBeGreaterThanOrEqual(first.maturityScore);
      expect(last.tagCompliancePct).toBeGreaterThanOrEqual(first.tagCompliancePct);
      expect(last.commitmentCoveragePct).toBeGreaterThanOrEqual(first.commitmentCoveragePct);
      expect(last.counterfactualCost).toBeGreaterThan(last.actualSpend);
    });
  });

  it('escala los montos y recursos según el tier', () => {
    const pro = generateHistoricalProgressReport('90d', 'professional');
    const ent = generateHistoricalProgressReport('90d', 'enterprise');

    const proLast = pro.series[pro.series.length - 1];
    const entLast = ent.series[ent.series.length - 1];

    expect(entLast.actualSpend).toBeGreaterThan(proLast.actualSpend);
    expect(entLast.counterfactualCost).toBeGreaterThan(proLast.counterfactualCost);
    expect(entLast.ahubVcores).toBeGreaterThan(proLast.ahubVcores);
  });

  it('incluye auditoría Before/After con detección de Efecto Rebote', () => {
    const report = generateHistoricalProgressReport('90d', 'business');
    const items = report.beforeAfterVerifications;

    const reboundItem = items.find((i) => i.reboundStatus === 'warning_rebound');
    expect(reboundItem).toBeDefined();
    expect(reboundItem?.reboundDetails).toContain('Efecto Rebote');

    const optimalItem = items.find((i) => i.reboundStatus === 'verified_optimal');
    expect(optimalItem).toBeDefined();
    expect(optimalItem?.costPost30d).toBeLessThan(optimalItem?.costPre30d || 0);
  });

  it('incluye Hitos de Arquitectura con impacto en costo', () => {
    const report = generateHistoricalProgressReport('90d', 'business');
    const milestones = report.architectureMilestones;

    expect(milestones.length).toBeGreaterThanOrEqual(4);
    const elasticPool = milestones.find((m) => m.type === 'migration');
    expect(elasticPool).toBeDefined();
    expect(elasticPool?.monthlyCostDelta).toBeLessThan(0);
  });

  it('incluye Waiver Ledger con motivos y vencimientos', () => {
    const report = generateHistoricalProgressReport('90d', 'business');
    const waivers = report.waiverLedger;

    expect(waivers.length).toBeGreaterThanOrEqual(3);
    const active = waivers.find((w) => w.status === 'active_waiver');
    const expired = waivers.find((w) => w.status === 'expired_waiver');

    expect(active).toBeDefined();
    expect(expired).toBeDefined();
    expect(active?.engineerName).toBeDefined();
    expect(active?.reason).toBeDefined();
  });
});
