import { describe, it, expect } from 'vitest';
import { AzureCapturedSavingsService } from '@/services/azureCapturedSavings.service';

describe('Ahorro Capturado — coherencia de KPIs', () => {
  const summary = AzureCapturedSavingsService.getMockCapturedSavings('Enterprise');

  // El "ahorro potencial" y el "desperdicio detectado" salían del MISMO campo,
  // así que las dos tarjetas y dos series del gráfico eran siempre idénticas.
  it('potencial = desperdicio detectado - ahorro ya capturado, en cada punto', () => {
    for (const point of summary.trend) {
      expect(point.potentialSavingsUSD).toBeCloseTo(
        Math.max(0, point.detectedWasteUSD - point.realizedSavingsUSD),
        2
      );
    }
  });

  it('los KPI coinciden con el último punto de la serie (no contradicen el gráfico)', () => {
    const last = summary.trend[summary.trend.length - 1];
    expect(summary.currentDetectedWasteUSD).toBeCloseTo(last.detectedWasteUSD, 2);
    expect(summary.currentPotentialSavingsUSD).toBeCloseTo(last.potentialSavingsUSD, 2);
  });

  // Antes: realizedSavings = detectedWaste * 0.6 cuando no había dato. Con $30 de
  // desperdicio el gráfico mostraba exactamente $18 de ahorro realizado.
  it('el ahorro realizado no es un porcentaje fijo del desperdicio', () => {
    const ratios = summary.trend
      .filter((p) => p.detectedWasteUSD > 0)
      .map((p) => Number((p.realizedSavingsUSD / p.detectedWasteUSD).toFixed(3)));
    const distinct = new Set(ratios);
    expect(distinct.size).toBeGreaterThan(1);
    expect(ratios.every((r) => r === 0.6)).toBe(false);
  });

  it('el ahorro realizado de cada mes es la suma de sus eventos exitosos', () => {
    const byMonth = new Map<string, number>();
    for (const ev of summary.auditLog) {
      if (ev.status !== 'SUCCESS' || ev.monthlySavingsUSD <= 0) continue;
      const m = ev.timestamp.slice(0, 7);
      byMonth.set(m, Number(((byMonth.get(m) || 0) + ev.monthlySavingsUSD).toFixed(2)));
    }
    for (const point of summary.trend) {
      expect(point.realizedSavingsUSD).toBeCloseTo(byMonth.get(point.date) || 0, 2);
    }
  });

  it('el conteo de snapshots refleja la serie devuelta y no un literal', () => {
    expect(summary.totalHistoricalSnapshots).toBe(summary.trend.length);
  });
});

describe('Ahorro Capturado — historial de remediación en demo', () => {
  const summary = AzureCapturedSavingsService.getMockCapturedSavings('Enterprise');

  it('incluye eventos de ambos orígenes: plataforma y detectados en Azure', () => {
    const origins = new Set(summary.auditLog.map((a) => a.origin));
    expect(origins.has('platform')).toBe(true);
    expect(origins.has('azure')).toBe(true);
  });

  it('cada evento trae los campos que consume la tabla', () => {
    expect(summary.auditLog.length).toBeGreaterThanOrEqual(6);
    for (const ev of summary.auditLog) {
      expect(ev.resourceName).toBeTruthy();
      expect(ev.resourceGroup).toBeTruthy();
      expect(ev.resourceType).toBeTruthy();
      expect(ev.actionCategory).toBeTruthy();
      expect(ev.details).toBeTruthy();
      expect(['SUCCESS', 'FAILED']).toContain(ev.status);
      expect(typeof ev.savingsMeasured).toBe('boolean');
    }
  });

  it('una acción fallida no aporta ahorro', () => {
    for (const ev of summary.auditLog.filter((a) => a.status === 'FAILED')) {
      expect(ev.monthlySavingsUSD).toBe(0);
    }
  });

  it('los importes se mantienen en escala de cientos por tier, no de miles', () => {
    for (const tier of ['Professional', 'Business', 'Enterprise']) {
      const s = AzureCapturedSavingsService.getMockCapturedSavings(tier);
      expect(s.currentDetectedWasteUSD).toBeGreaterThan(0);
      expect(s.currentDetectedWasteUSD).toBeLessThan(1000);
      for (const ev of s.auditLog) expect(ev.monthlySavingsUSD).toBeLessThan(500);
    }
  });
});
