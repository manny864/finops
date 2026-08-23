import { describe, it, expect } from 'vitest';
import {
  buildAdvisorRemediationCommand,
  generateMockAdvisorData,
  deduplicateAndProcessRecommendations,
} from '@/services/azureAdvisor.service';
import type { AdvisorRecommendation } from '@/types/azureAdvisor.types';

describe('Azure Advisor Service - Deduplicación & Acciones', () => {
  it('deduplica opciones de términos de reserva para un mismo recurso', () => {
    const rawList = [
      {
        id: 'rec-sub-01',
        recommendationTypeId: 'ri-type-01',
        name: 'Buy virtual machine reserved instances',
        impact: 'High',
        impactedValue: '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01',
        subscriptionId: '11111111-2222-3333-4444-555555555555',
        extendedProperties: {
          term: 'P1Y',
          lookbackPeriod: '30',
          annualSavingsAmount: '1200.00',
        },
      },
      {
        id: 'rec-sub-02',
        recommendationTypeId: 'ri-type-01',
        name: 'Buy virtual machine reserved instances',
        impact: 'High',
        impactedValue: '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01',
        subscriptionId: '11111111-2222-3333-4444-555555555555',
        extendedProperties: {
          term: 'P3Y',
          lookbackPeriod: '30',
          annualSavingsAmount: '2400.00',
        },
      },
      {
        id: 'rec-sub-03',
        recommendationTypeId: 'ri-type-01',
        name: 'Buy virtual machine reserved instances',
        impact: 'High',
        impactedValue: '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01',
        subscriptionId: '11111111-2222-3333-4444-555555555555',
        extendedProperties: {
          term: 'P1Y',
          lookbackPeriod: '7',
          annualSavingsAmount: '1100.00',
        },
      },
    ];

    const subMap = { '11111111-2222-3333-4444-555555555555': 'Producción' };
    const processed = deduplicateAndProcessRecommendations(rawList, 'Cost', 'es', subMap);

    // Debe consolidarse en un solo registro
    expect(processed).toHaveLength(1);
    const rec = processed[0];
    expect(rec.resourceName).toBe('vm-prod-01');
    expect(rec.resourceGroup).toBe('rg-prod');
    expect(rec.reservationOptions).toHaveLength(3);
    // El ahorro consolidado debe ser el óptimo (2400, no la suma de 4700)
    expect(rec.annualSavingsUSD).toBe(2400);
    expect(rec.monthlySavingsUSD).toBe(200);
    expect(rec.actionType).toBe('PURCHASE_RESERVATION');
  });

  it('construye comandos CLI y PowerShell de remediación válidos', () => {
    const rec: Partial<AdvisorRecommendation> = {
      actionType: 'PURCHASE_RESERVATION',
      resourceName: 'vm-prod-api',
      resourceGroup: 'rg-prod',
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      selectedTerm: '3 Years / 30 Days',
      extendedProperties: { targetSku: 'Standard_D4s_v5' },
    };

    const cmd = buildAdvisorRemediationCommand(rec);
    expect(cmd.cli).toContain('az reservations reservation-order calculate');
    expect(cmd.cli).toContain('Standard_D4s_v5');
    expect(cmd.cli).toContain('P3Y');
    expect(cmd.powerShell).toContain('New-AzReservation');
    expect(cmd.powerShell).toContain('Standard_D4s_v5');
  });

  // Regresión: un rightsizing sobre un recurso que NO es VM devolvía
  // `az vm resize` / `Update-AzVM` sobre un GUID y un resource group inventado
  // ("rg-prod"). El comando debe corresponder al tipo real del recurso.
  it('no emite comandos de VM para un recurso que no es máquina virtual', () => {
    const redisRec: Partial<AdvisorRecommendation> = {
      actionType: 'RESIZE',
      category: 'Cost',
      serviceName: 'Redis',
      resourceName: 'redis-cart-prod',
      resourceGroup: 'rg-cart',
      resourceId:
        '/subscriptions/1111/resourceGroups/rg-cart/providers/Microsoft.Cache/Redis/redis-cart-prod',
      titleTranslated: 'Redimensionar instancia subutilizada',
    };

    const cmd = buildAdvisorRemediationCommand(redisRec);
    expect(cmd.powerShell).not.toContain('Update-AzVM');
    expect(cmd.cli).not.toContain('az vm resize');
    expect(cmd.cli).toContain('az redis update');
    expect(cmd.cli).toContain('rg-cart');
  });

  it('el fallback genérico usa el resourceId real y no un resource-type inventado', () => {
    const rec: Partial<AdvisorRecommendation> = {
      actionType: 'OPTIMIZE',
      category: 'OperationalExcellence',
      serviceName: 'workspaces',
      resourceName: 'law-shared',
      resourceGroup: 'rg-observability',
      resourceId:
        '/subscriptions/1111/resourceGroups/rg-observability/providers/Microsoft.OperationalInsights/workspaces/law-shared',
      titleTranslated: 'Revisar configuración del recurso',
    };

    const cmd = buildAdvisorRemediationCommand(rec);
    expect(cmd.cli).not.toContain('Microsoft.Resources/resources');
    expect(cmd.cli).toContain(rec.resourceId as string);
    expect(cmd.powerShell).toContain(rec.resourceId as string);
  });

  it('genera datos mock completos con los 5 pilares y scores', () => {
    const mock = generateMockAdvisorData('es');
    expect(mock.success).toBe(true);
    expect(mock.overallScore).toBe(64.6);
    expect(mock.pillars.Cost.recommendationsCount).toBeGreaterThan(0);
    expect(mock.pillars.Security.recommendationsCount).toBeGreaterThan(0);
    expect(mock.pillars.HighAvailability.recommendationsCount).toBeGreaterThan(0);
    expect(mock.pillars.Performance.recommendationsCount).toBeGreaterThan(0);
    expect(mock.pillars.OperationalExcellence.recommendationsCount).toBeGreaterThan(0);
    expect(mock.pillars.Cost.totalSavingsUSD).toBeGreaterThan(1000);
  });
});
