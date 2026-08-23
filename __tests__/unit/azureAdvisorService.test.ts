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

describe('Azure Advisor Service - Bugs de producción 2026-08-23', () => {
  const armId =
    '/subscriptions/aaaa1111-2222-3333-4444-555555555555/resourceGroups/rg-datos-prod/providers/Microsoft.Compute/virtualMachines/vm-mysql-01';

  const baseRaw = (over: Record<string, unknown> = {}) => ({
    id: 'rec-a',
    recommendationTypeId: 'type-rightsize-vm',
    name: 'Right-size underutilized virtual machines',
    impact: 'Medium',
    impactedValue: 'vm-mysql-01',
    impactedField: 'Microsoft.Compute/virtualMachines',
    resourceMetadata: { resourceId: armId },
    subscriptionId: 'aaaa1111-2222-3333-4444-555555555555',
    shortDescription: {
      problem: 'Right-size underutilized virtual machines',
      solution: 'Resize the virtual machine to a smaller SKU',
    },
    extendedProperties: { targetSku: 'Standard_D2s_v5', cpuUtilization: '4.2' },
    lastUpdated: '2026-08-20T00:00:00Z',
    ...over,
  });

  const subMap = { 'aaaa1111-2222-3333-4444-555555555555': 'Suscripción Datos' };

  // BUG 3: el resourceGroup salía como 'rg-default' porque se parseaba
  // impactedValue (nombre corto) antes que el ARM Resource ID real.
  it('extrae el resourceGroup real del ARM Resource ID y no inventa rg-default', () => {
    const [rec] = deduplicateAndProcessRecommendations([baseRaw()], 'Cost', 'es', subMap);
    expect(rec.resourceGroup).toBe('rg-datos-prod');
    expect(rec.resourceName).toBe('vm-mysql-01');
    expect(rec.resource?.resourceType).toBe('Microsoft.Compute/virtualMachines');
    expect(rec.resource?.rawId).toBe(armId);
    expect(rec.resourceGroup).not.toBe('rg-default');
  });

  it('deja el resourceGroup vacío cuando Advisor no expone un ARM ID, sin fallback falso', () => {
    const [rec] = deduplicateAndProcessRecommendations(
      [baseRaw({ resourceMetadata: undefined, impactedValue: 'recurso-suelto' })],
      'Cost',
      'es',
      subMap
    );
    expect(rec.resourceGroup).toBe('');
    expect(rec.resourceName).toBe('recurso-suelto');
  });

  // BUG 4: la misma alerta sobre el mismo recurso llegaba con ids distintos por
  // suscripción/consulta y se contaba varias veces.
  it('deduplica la misma regla sobre el mismo recurso aunque cambie el id crudo', () => {
    const items = deduplicateAndProcessRecommendations(
      [
        baseRaw({ id: 'rec-a', lastUpdated: '2026-08-18T00:00:00Z' }),
        baseRaw({ id: 'rec-b-otro-id', lastUpdated: '2026-08-22T00:00:00Z', impact: 'High' }),
      ],
      'Cost',
      'es',
      subMap
    );
    expect(items).toHaveLength(1);
    // Gana la telemetría más reciente.
    expect(items[0].lastRefreshed).toBe('2026-08-22');
    expect(items[0].impact).toBe('High');
  });

  // BUG 6: el filtro de posposición sólo miraba el id crudo de Advisor.
  it('excluye la recomendación pospuesta cuando la supresión se guardó con la dedupKey', () => {
    const [rec] = deduplicateAndProcessRecommendations([baseRaw()], 'Cost', 'es', subMap);
    const dedupKey = rec.dedupKey as string;
    expect(dedupKey).toBeTruthy();

    const filtered = deduplicateAndProcessRecommendations(
      // Otro id crudo, misma regla y recurso: debe seguir excluida.
      [baseRaw({ id: 'rec-id-nuevo' })],
      'Cost',
      'es',
      subMap,
      new Set([dedupKey])
    );
    expect(filtered).toHaveLength(0);
  });

  // BUG 2: categoría e impacto llegan localizados desde el backend.
  it('entrega categoría e impacto ya localizados', () => {
    const [es] = deduplicateAndProcessRecommendations([baseRaw()], 'HighAvailability', 'es', subMap);
    expect(es.categoryDisplayName).toBe('Alta Disponibilidad');
    expect(es.impactDisplayName).toBe('Medio');

    const [pt] = deduplicateAndProcessRecommendations([baseRaw()], 'OperationalExcellence', 'pt-BR', subMap);
    expect(pt.categoryDisplayName).toBe('Excelência Operacional');
  });

  // BUG 5: la acción sugerida tiene que corresponder al recurso real.
  it('sintetiza rightsizing con SKU destino para una VM subutilizada', () => {
    const [rec] = deduplicateAndProcessRecommendations([baseRaw()], 'Cost', 'es', subMap);
    expect(rec.aiSuggestedAction?.actionType).toBe('RIGHTSIZE');
    expect(rec.aiSuggestedAction?.targetSku).toBe('Standard_D2s_v5');
    expect(rec.aiSuggestedAction?.actionTitle).toContain('vm-mysql-01');
  });

  it('nunca sugiere gobernanza de etiquetas para un recurso que no viene de una regla de etiquetado', () => {
    const redisRaw = baseRaw({
      recommendationTypeId: 'type-redis',
      name: 'Improve Redis performance',
      resourceMetadata: {
        resourceId:
          '/subscriptions/aaaa1111-2222-3333-4444-555555555555/resourceGroups/rg-cache/providers/Microsoft.Cache/Redis/redis-carrito',
      },
      shortDescription: { problem: 'Improve Redis performance', solution: 'Scale the cache' },
      extendedProperties: {},
    });
    const [rec] = deduplicateAndProcessRecommendations([redisRaw], 'Performance', 'es', subMap);
    expect(rec.aiSuggestedAction?.actionType).not.toBe('UPDATE_TAGS');
    expect(rec.remediationCommand).not.toContain('az vm resize');
  });

  it('sí sugiere etiquetas cuando la regla es de etiquetado', () => {
    const tagRaw = baseRaw({
      recommendationTypeId: 'type-tags',
      name: 'Add required tags to resources',
      shortDescription: { problem: 'Resources are missing required tags', solution: 'Apply the required tags' },
      extendedProperties: {},
    });
    const [rec] = deduplicateAndProcessRecommendations([tagRaw], 'OperationalExcellence', 'es', subMap);
    expect(rec.aiSuggestedAction?.actionType).toBe('UPDATE_TAGS');
  });
});
