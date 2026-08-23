import { describe, it, expect } from 'vitest';
import {
  safeSavingsPercentage,
  formatSavingsPercentage,
  baselineForResourceType,
  monthlyRunRate,
} from '@/lib/realizedSavings';

describe('safeSavingsPercentage — guarda de división por cero', () => {
  // BUG 4: la columna quedaba vacía o con NaN% al auditar recursos sin costo
  // previo registrado (el clúster AKS "Oaks" del tenant CSCS).
  it('devuelve 100% cuando el recurso fue eliminado y el costo posterior es 0', () => {
    expect(safeSavingsPercentage(292.4, 0, true)).toBe(100);
  });

  it('calcula el delta proporcional cuando hubo downsize', () => {
    expect(safeSavingsPercentage(580, 310)).toBe(46.55);
    expect(safeSavingsPercentage(284, 142)).toBe(50);
  });

  it('nunca devuelve NaN ni Infinity sin línea base', () => {
    for (const value of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const pct = safeSavingsPercentage(value as number, 0, true);
      expect(Number.isFinite(pct)).toBe(true);
      expect(pct).toBe(0);
    }
  });

  it('no inventa ahorro cuando el costo posterior es mayor o igual', () => {
    expect(safeSavingsPercentage(100, 100)).toBe(0);
    expect(safeSavingsPercentage(100, 150)).toBe(0);
  });

  it('formatea "—" sin línea base y el porcentaje con 2 decimales si la hay', () => {
    expect(formatSavingsPercentage(0, false)).toBe('—');
    expect(formatSavingsPercentage(100, true)).toBe('100.00%');
    expect(formatSavingsPercentage(46.55, true)).toBe('46.55%');
  });
});

describe('baselineForResourceType — sin el fallback de 15 USD', () => {
  // BUG 3: eliminar un Azure Bastion declaraba un ahorro de 15 USD/mes porque
  // no estaba catalogado y todo lo desconocido caía en ese default.
  it('cataloga Azure Bastion en su costo real, no en 15 USD', () => {
    const bastion = baselineForResourceType(
      '/subscriptions/s/resourceGroups/rg-network-core/providers/Microsoft.Network/bastionHosts/bastion-prod'
    );
    expect(bastion.source).toBe('type_baseline');
    expect(bastion.monthly).toBeGreaterThanOrEqual(140);
  });

  it('cataloga clústeres AKS', () => {
    const aks = baselineForResourceType(
      '/subscriptions/s/resourceGroups/rg-cscs-prod/providers/Microsoft.ContainerService/managedClusters/oaks'
    );
    expect(aks.monthly).toBeGreaterThan(200);
  });

  it('cataloga App Service Environment en su costo base', () => {
    const ase = baselineForResourceType(
      '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Web/hostingEnvironments/ase-v3-prod'
    );
    expect(ase.source).toBe('type_baseline');
    expect(ase.monthly).toBe(300);
  });

  it('cataloga VM detenida distinguiendo el costo de almacenamiento asociado del cómputo', () => {
    const stoppedVm = baselineForResourceType('stoppedVirtualMachines');
    expect(stoppedVm.source).toBe('type_baseline');
    expect(stoppedVm.monthly).toBeCloseTo(23.36, 2);

    const stoppedVmArm = baselineForResourceType('microsoft.compute/virtualmachines/stopped');
    expect(stoppedVmArm.source).toBe('type_baseline');
    expect(stoppedVmArm.monthly).toBeCloseTo(23.36, 2);
  });

  it('calcula la línea base proporcional cuando se especifica sizeGB en discos y snapshots', () => {
    const disk512 = baselineForResourceType('microsoft.compute/disks', 512);
    expect(disk512.source).toBe('type_baseline');
    expect(disk512.monthly).toBeCloseTo(512 * 0.154, 2);

    const snapshot200 = baselineForResourceType('microsoft.compute/snapshots', 200);
    expect(snapshot200.source).toBe('type_baseline');
    expect(snapshot200.monthly).toBeCloseTo(200 * 0.05, 2);
  });

  it('un tipo no catalogado devuelve 0 y source none, no una estimación inventada', () => {
    const unknown = baselineForResourceType(
      '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Fake/widgets/w1'
    );
    expect(unknown.monthly).toBe(0);
    expect(unknown.source).toBe('none');
  });
});

describe('monthlyRunRate', () => {
  it('normaliza una ventana parcial a 30 días', () => {
    expect(monthlyRunRate(70, 7)).toBe(300);
    expect(monthlyRunRate(300, 30)).toBe(300);
  });

  it('devuelve 0 con entradas inválidas', () => {
    expect(monthlyRunRate(0, 30)).toBe(0);
    expect(monthlyRunRate(100, 0)).toBe(0);
    expect(monthlyRunRate(Number.NaN, 30)).toBe(0);
  });
});
