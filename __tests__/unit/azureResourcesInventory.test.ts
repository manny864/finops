import { describe, it, expect } from 'vitest';
import {
  generateMockResourcesSearch,
  generateMockResourcesCostsByTag,
} from '@/services/azureResourcesInventory.service';
import * as service from '@/services/azureResourcesInventory.service';

describe('Recursos — costo real, nunca estimado por tipo', () => {
  // BUG reportado: todos los recursos mostraban $20 y cualquier cosa cuyo tipo
  // contuviera "virtualmachines" (incluidas las EXTENSIONES de VM) mostraba $95,
  // porque una función estimaba el costo cuando Cost Management no reportaba cargo.
  it('el estimador de costo por tipo/SKU ya no existe en el servicio', () => {
    expect((service as Record<string, unknown>).estimateCostFromTypeAndSku).toBeUndefined();
  });

  it('cada recurso declara el origen de su costo', () => {
    const res = generateMockResourcesSearch('Professional', { page: 1, pageSize: 15 });
    expect(res.rows.length).toBeGreaterThan(0);
    for (const row of res.rows) {
      expect(['cost_management', 'unmeasured']).toContain(row.costSource);
      // Un recurso marcado como no medido no puede traer costo inventado.
      if (row.costSource === 'unmeasured') expect(row.monthlyCostUSD).toBe(0);
    }
  });
});

describe('Costos por Etiqueta — contrato y coherencia', () => {
  it('respeta el contrato TagCostSummary (tagKey/monthlySpendUSD/resourcesCount)', () => {
    const res = generateMockResourcesCostsByTag('Enterprise');
    expect(res.tags.length).toBeGreaterThan(0);
    for (const tag of res.tags) {
      expect(typeof tag.tagKey).toBe('string');
      expect(typeof tag.monthlySpendUSD).toBe('number');
      expect(tag.taggedResourcesCount).toBeGreaterThan(0);
      for (const value of tag.values) {
        expect(typeof value.tagValue).toBe('string');
        expect(typeof value.costUSD).toBe('number');
        // resourcesCount tiene que venir: sin él la UI caía a 1 por valor y el
        // costo por recurso salía desproporcionado.
        expect(value.resourcesCount).toBeGreaterThan(0);
      }
    }
  });

  it('expone los días transcurridos del MTD para el promedio diario', () => {
    const res = generateMockResourcesCostsByTag('Professional');
    expect(res.daysInPeriod).toBeGreaterThanOrEqual(1);
    expect(res.daysInPeriod).toBeLessThanOrEqual(31);
  });

  it('el costo por recurso etiquetado se mantiene en un rango plausible', () => {
    for (const tier of ['Professional', 'Business', 'Enterprise']) {
      const res = generateMockResourcesCostsByTag(tier);
      for (const tag of res.tags) {
        const perResource = tag.monthlySpendUSD / tag.taggedResourcesCount;
        // Antes el mock del interceptor daba ~46.000 USD/recurso/mes.
        expect(perResource).toBeLessThan(5000);
      }
    }
  });
});
