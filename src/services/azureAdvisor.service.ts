import { isMockTenant } from '@/lib/mockData';
import { collectAdvisorData } from '@/modules/collectors/azure/advisorCollector';
import {
  translateAdvisorText,
  extractResourceDisplayName,
  formatAdvisorTermAndLookback,
} from '@/lib/advisorI18n';
import { buildAdvisorRemediationCommand } from '@/lib/advisorRemediation';
export { buildAdvisorRemediationCommand };
import type {
  AdvisorCategory,
  AdvisorImpact,
  AdvisorRecommendation,
  AdvisorReservationOption,
  AdvisorPillarSummary,
  AdvisorApiResponse,
  AdvisorSubscription,
} from '@/types/azureAdvisor.types';
import pool, { initializeDatabase } from '@/modules/storage/db';

const CATEGORIES: AdvisorCategory[] = [
  'Cost',
  'Security',
  'HighAvailability',
  'Performance',
  'OperationalExcellence',
];

export function generateMockAdvisorData(locale: string = 'es'): AdvisorApiResponse {
  const isEs = locale.startsWith('es');
  const isPt = locale.startsWith('pt');

  const costRecs: AdvisorRecommendation[] = [
    {
      id: 'mock-rec-cost-01',
      name: 'Buy virtual machine reserved instances',
      category: 'Cost',
      impact: 'High',
      resourceId: '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-production-eastus/providers/Microsoft.Compute/virtualMachines/vm-prod-app-01',
      resourceName: 'vm-prod-app-01',
      resourceGroup: 'rg-production-eastus',
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      subscriptionName: 'Producción Corporativa',
      serviceName: 'Virtual Machines',
      titleTranslated: isEs ? 'Compra de Instancias Reservadas en Máquinas Virtuales' : (isPt ? 'Compra de Instâncias Reservadas em Máquinas Virtuais' : 'Buy virtual machine reserved instances'),
      descriptionTranslated: isEs
        ? 'Analizamos el uso de máquinas virtuales en los últimos 30 días y calculamos que un compromiso de reserva maximizará tus ahorros.'
        : (isPt ? 'Analisamos o uso de máquinas virtuais nos últimos 30 dias.' : 'Purchase reserved instances to maximize savings.'),
      annualSavingsUSD: 3287.04,
      monthlySavingsUSD: 273.92,
      reservationOptions: [
        { term: '1 Year', lookback: '30 Days', annualSavingsUSD: 1845.60, monthlySavingsUSD: 153.80 },
        { term: '3 Years', lookback: '30 Days', annualSavingsUSD: 3287.04, monthlySavingsUSD: 273.92 },
        { term: '1 Year', lookback: '7 Days', annualSavingsUSD: 1620.00, monthlySavingsUSD: 135.00 },
        { term: '3 Years', lookback: '7 Days', annualSavingsUSD: 3010.00, monthlySavingsUSD: 250.83 },
      ],
      selectedTerm: '3 Years / 30 Days',
      actionType: 'PURCHASE_RESERVATION',
      extendedProperties: { targetSku: 'Standard_D4s_v5', term: 'P3Y', lookbackPeriod: '30' },
      lastRefreshed: '2026-08-19',
      status: 'active',
      carbonReductionKg: 42.5,
      completionProgress: 0,
      activeResources: 1,
    },
    {
      id: 'mock-rec-cost-02',
      name: 'Right-size underutilized virtual machines',
      category: 'Cost',
      impact: 'High',
      resourceId: '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-analytics-brazil/providers/Microsoft.Compute/virtualMachines/vm-analytics-worker-02',
      resourceName: 'vm-analytics-worker-02',
      resourceGroup: 'rg-analytics-brazil',
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      subscriptionName: 'Producción Corporativa',
      serviceName: 'Virtual Machines',
      titleTranslated: isEs ? 'Redimensionar o apagar máquinas virtuales subutilizadas' : (isPt ? 'Redimensionar ou desligar máquinas virtuais' : 'Right-size or shutdown underutilized virtual machines'),
      descriptionTranslated: isEs
        ? 'La utilización de CPU promedio ha sido inferior al 6% durante los últimos 14 días. Redimensiona de Standard_E8s_v5 a Standard_E4s_v5.'
        : 'Average CPU utilization was under 6% for the last 14 days.',
      annualSavingsUSD: 1420.80,
      monthlySavingsUSD: 118.40,
      actionType: 'RESIZE',
      extendedProperties: { currentSku: 'Standard_E8s_v5', targetSku: 'Standard_E4s_v5' },
      lastRefreshed: '2026-08-19',
      status: 'active',
      carbonReductionKg: 18.2,
      completionProgress: 25,
      activeResources: 1,
    },
    {
      id: 'mock-rec-cost-03',
      name: 'Buy reserved capacity for Azure Cache for Redis',
      category: 'Cost',
      impact: 'Medium',
      resourceId: '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-production-eastus/providers/Microsoft.Cache/Redis/redis-cache-shared-prod',
      resourceName: 'redis-cache-shared-prod',
      resourceGroup: 'rg-production-eastus',
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      subscriptionName: 'Producción Corporativa',
      serviceName: 'Azure Cache for Redis',
      titleTranslated: isEs ? 'Compra de Capacidad Reservada para Azure Cache for Redis' : 'Buy reserved capacity for Azure Cache for Redis',
      descriptionTranslated: isEs
        ? 'El clúster de Redis opera de forma ininterrumpida. La reserva a 1 o 3 años reduce el costo de memoria hasta en un 55%.'
        : 'Redis cluster operates continuously.',
      annualSavingsUSD: 980.00,
      monthlySavingsUSD: 81.67,
      reservationOptions: [
        { term: '1 Year', lookback: '30 Days', annualSavingsUSD: 540.00, monthlySavingsUSD: 45.00 },
        { term: '3 Years', lookback: '30 Days', annualSavingsUSD: 980.00, monthlySavingsUSD: 81.67 },
      ],
      selectedTerm: '3 Years / 30 Days',
      actionType: 'PURCHASE_RESERVATION',
      extendedProperties: { targetSku: 'Premium P2', term: 'P3Y', lookbackPeriod: '30' },
      lastRefreshed: '2026-08-18',
      status: 'active',
      completionProgress: 0,
      activeResources: 1,
    },
    {
      id: 'mock-rec-cost-04',
      name: 'Delete unattached managed disks',
      category: 'Cost',
      impact: 'Medium',
      resourceId: '/subscriptions/22222222-3333-4444-5555-666666666666/resourceGroups/rg-staging-core/providers/Microsoft.Compute/disks/disk-orphaned-staging-data',
      resourceName: 'disk-orphaned-staging-data',
      resourceGroup: 'rg-staging-core',
      subscriptionId: '22222222-3333-4444-5555-666666666666',
      subscriptionName: 'Staging & Pre-prod',
      serviceName: 'Managed Disks',
      titleTranslated: isEs ? 'Eliminar discos administrados no conectados' : 'Delete unattached managed disks',
      descriptionTranslated: isEs
        ? 'Disco Premium SSD de 512 GiB no asociado a ninguna VM en los últimos 30 días.'
        : 'Unattached Premium SSD 512 GiB disk.',
      annualSavingsUSD: 468.00,
      monthlySavingsUSD: 39.00,
      actionType: 'DELETE_DISK',
      extendedProperties: { diskSize: '512 GiB', storageTier: 'Premium_LRS' },
      lastRefreshed: '2026-08-19',
      status: 'active',
      completionProgress: 0,
      activeResources: 2,
    },
    {
      id: 'mock-rec-cost-05',
      name: 'Delete unassociated public IP addresses',
      category: 'Cost',
      impact: 'Low',
      resourceId: '/subscriptions/22222222-3333-4444-5555-666666666666/resourceGroups/rg-staging-core/providers/Microsoft.Network/publicIPAddresses/pip-unused-lb-staging',
      resourceName: 'pip-unused-lb-staging',
      resourceGroup: 'rg-staging-core',
      subscriptionId: '22222222-3333-4444-5555-666666666666',
      subscriptionName: 'Staging & Pre-prod',
      serviceName: 'Virtual Network',
      titleTranslated: isEs ? 'Eliminar direcciones IP públicas no asociadas' : 'Delete unassociated public IP addresses',
      descriptionTranslated: isEs
        ? 'IP pública estándar estática sin vinculación a NICs o Load Balancers.'
        : 'Unassociated static public IP.',
      annualSavingsUSD: 64.80,
      monthlySavingsUSD: 5.40,
      actionType: 'DELETE_IP',
      lastRefreshed: '2026-08-19',
      status: 'active',
      completionProgress: 50,
      activeResources: 1,
    },
  ];

  const securityRecs: AdvisorRecommendation[] = [
    {
      id: 'mock-rec-sec-01',
      name: 'Storage accounts should use a private link connection',
      category: 'Security',
      impact: 'High',
      resourceId: '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-production-eastus/providers/Microsoft.Storage/storageAccounts/stgfinopsanalyticsdata',
      resourceName: 'stgfinopsanalyticsdata',
      resourceGroup: 'rg-production-eastus',
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      subscriptionName: 'Producción Corporativa',
      serviceName: 'Storage Accounts',
      titleTranslated: isEs ? 'Las cuentas de almacenamiento deben utilizar conexiones Private Link' : 'Storage accounts should use a private link connection',
      descriptionTranslated: isEs
        ? 'Configura Private Endpoints en la cuenta de almacenamiento para evitar tráfico sobre internet público.'
        : 'Configure Private Endpoints on storage accounts.',
      annualSavingsUSD: 0,
      monthlySavingsUSD: 0,
      actionType: 'OPTIMIZE',
      lastRefreshed: '2026-08-19',
      status: 'active',
      completionProgress: 0,
      activeResources: 3,
    },
    {
      id: 'mock-rec-sec-02',
      name: 'Enable MFA for privileged accounts',
      category: 'Security',
      impact: 'High',
      resourceId: '/subscriptions/11111111-2222-3333-4444-555555555555',
      resourceName: 'Entra ID Subscription Scope',
      resourceGroup: 'IAM',
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      subscriptionName: 'Producción Corporativa',
      serviceName: 'Entra ID / IAM',
      titleTranslated: isEs ? 'Habilitar MFA para cuentas con privilegios de administrador' : 'Enable MFA for privileged accounts',
      descriptionTranslated: isEs
        ? 'Exige autenticación multifactor mediante Acceso Condicional para administradores de suscripción.'
        : 'Enforce MFA via Conditional Access.',
      annualSavingsUSD: 0,
      monthlySavingsUSD: 0,
      actionType: 'OPTIMIZE',
      lastRefreshed: '2026-08-18',
      status: 'active',
      completionProgress: 40,
      activeResources: 2,
    },
    {
      id: 'mock-rec-sec-03',
      name: 'Management ports should be closed on virtual machines',
      category: 'Security',
      impact: 'High',
      resourceId: '/subscriptions/22222222-3333-4444-5555-666666666666/resourceGroups/rg-staging-core/providers/Microsoft.Network/networkSecurityGroups/nsg-staging-web',
      resourceName: 'nsg-staging-web',
      resourceGroup: 'rg-staging-core',
      subscriptionId: '22222222-3333-4444-5555-666666666666',
      subscriptionName: 'Staging & Pre-prod',
      serviceName: 'Network Security Groups',
      titleTranslated: isEs ? 'Cerrar los puertos de administración (RDP/SSH) expuestos a Internet' : 'Management ports should be closed on virtual machines',
      descriptionTranslated: isEs
        ? 'Regla de NSG permite inbound RDP (3389) desde 0.0.0.0/0. Restringe a Azure Bastion o VPN.'
        : 'NSG rule allows inbound 3389 from internet.',
      annualSavingsUSD: 0,
      monthlySavingsUSD: 0,
      actionType: 'OPTIMIZE',
      lastRefreshed: '2026-08-19',
      status: 'active',
      completionProgress: 10,
      activeResources: 1,
    },
  ];

  const haRecs: AdvisorRecommendation[] = [
    {
      id: 'mock-rec-ha-01',
      name: 'Configure Availability Zones for critical virtual machines',
      category: 'HighAvailability',
      impact: 'High',
      resourceId: '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-production-eastus/providers/Microsoft.Compute/virtualMachines/vm-prod-api-01',
      resourceName: 'vm-prod-api-01',
      resourceGroup: 'rg-production-eastus',
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      subscriptionName: 'Producción Corporativa',
      serviceName: 'Virtual Machines',
      titleTranslated: isEs ? 'Configurar Zonas de Disponibilidad para máquinas virtuales críticas' : 'Configure Availability Zones for critical virtual machines',
      descriptionTranslated: isEs
        ? 'Distribuye las instancias de API en múltiples zonas de disponibilidad (Zonas 1, 2, 3) para garantizar SLA del 99.99%.'
        : 'Distribute VM instances across multiple availability zones.',
      annualSavingsUSD: 0,
      monthlySavingsUSD: 0,
      actionType: 'OPTIMIZE',
      lastRefreshed: '2026-08-19',
      status: 'active',
      completionProgress: 60,
      activeResources: 4,
    },
    {
      id: 'mock-rec-ha-02',
      name: 'Enable soft delete or backup to protect data',
      category: 'HighAvailability',
      impact: 'Medium',
      resourceId: '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-production-eastus/providers/Microsoft.Storage/storageAccounts/stgfinopsbackupdata',
      resourceName: 'stgfinopsbackupdata',
      resourceGroup: 'rg-production-eastus',
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      subscriptionName: 'Producción Corporativa',
      serviceName: 'Storage Accounts',
      titleTranslated: isEs ? 'Habilitar eliminación temporal (soft delete) o copia de seguridad para proteger los datos' : 'Enable soft delete or backup to protect data',
      descriptionTranslated: isEs
        ? 'Activa soft delete con retención de 14 días para prevenir borrados accidentales de blobs.'
        : 'Enable soft delete with 14-day retention.',
      annualSavingsUSD: 0,
      monthlySavingsUSD: 0,
      actionType: 'OPTIMIZE',
      lastRefreshed: '2026-08-18',
      status: 'active',
      completionProgress: 80,
      activeResources: 2,
    },
  ];

  const perfRecs: AdvisorRecommendation[] = [
    {
      id: 'mock-rec-perf-01',
      name: 'Enable accelerated networking on supported virtual machines',
      category: 'Performance',
      impact: 'Medium',
      resourceId: '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-production-eastus/providers/Microsoft.Network/networkInterfaces/nic-prod-api-01',
      resourceName: 'nic-prod-api-01',
      resourceGroup: 'rg-production-eastus',
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      subscriptionName: 'Producción Corporativa',
      serviceName: 'Network Interfaces',
      titleTranslated: isEs ? 'Habilitar aceleración de red en máquinas virtuales compatibles' : 'Enable accelerated networking on supported virtual machines',
      descriptionTranslated: isEs
        ? 'Activa Accelerated Networking (SR-IOV) para reducir la latencia de red en hasta un 70% sin costo adicional.'
        : 'Enable accelerated networking (SR-IOV).',
      annualSavingsUSD: 0,
      monthlySavingsUSD: 0,
      actionType: 'OPTIMIZE',
      lastRefreshed: '2026-08-19',
      status: 'active',
      completionProgress: 100,
      activeResources: 1,
    },
  ];

  const opRecs: AdvisorRecommendation[] = [
    {
      id: 'mock-rec-op-01',
      name: 'Assign tags to resources to improve governance and cost allocation',
      category: 'OperationalExcellence',
      impact: 'Medium',
      resourceId: '/subscriptions/22222222-3333-4444-5555-666666666666/resourceGroups/rg-staging-core',
      resourceName: 'rg-staging-core',
      resourceGroup: 'rg-staging-core',
      subscriptionId: '22222222-3333-4444-5555-666666666666',
      subscriptionName: 'Staging & Pre-prod',
      serviceName: 'Resource Groups',
      titleTranslated: isEs ? 'Asignar etiquetas a los recursos para mejorar la gobernanza y asignación de costos' : 'Assign tags to resources to improve governance and cost allocation',
      descriptionTranslated: isEs
        ? 'Faltan las etiquetas requeridas Environment, CostCenter y Owner en 14 recursos de este grupo.'
        : 'Missing required tags: Environment, CostCenter, Owner.',
      annualSavingsUSD: 0,
      monthlySavingsUSD: 0,
      actionType: 'OPTIMIZE',
      lastRefreshed: '2026-08-19',
      status: 'active',
      completionProgress: 50,
      activeResources: 14,
    },
    {
      id: 'mock-rec-op-02',
      name: 'Configure Azure Service Health alerts',
      category: 'OperationalExcellence',
      impact: 'Low',
      resourceId: '/subscriptions/11111111-2222-3333-4444-555555555555',
      resourceName: 'Service Health Alerts',
      resourceGroup: 'Monitoring',
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      subscriptionName: 'Producción Corporativa',
      serviceName: 'Azure Monitor',
      titleTranslated: isEs ? 'Configurar alertas de estado del servicio (Azure Service Health)' : 'Configure Azure Service Health alerts',
      descriptionTranslated: isEs
        ? 'Crea alertas automáticas para incidencias regionales de Azure y mantenimientos programados.'
        : 'Configure alert rules for service health incidents.',
      annualSavingsUSD: 0,
      monthlySavingsUSD: 0,
      actionType: 'OPTIMIZE',
      lastRefreshed: '2026-08-18',
      status: 'active',
      completionProgress: 100,
      activeResources: 1,
    },
  ];

  // Inyectar comandos CLI y PowerShell
  [...costRecs, ...securityRecs, ...haRecs, ...perfRecs, ...opRecs].forEach((r) => {
    const cmd = buildAdvisorRemediationCommand(r);
    r.remediationCommand = cmd.cli;
    r.powerShellCommand = cmd.powerShell;
  });

  const totalCostSavings = costRecs.reduce((s, r) => s + r.annualSavingsUSD, 0);

  const pillars: Record<AdvisorCategory, AdvisorPillarSummary> = {
    Cost: {
      category: 'Cost',
      recommendationsCount: costRecs.length,
      scorePercentage: 7,
      totalSavingsUSD: totalCostSavings,
      totalMonthlySavingsUSD: Number((totalCostSavings / 12).toFixed(2)),
      highImpactCount: costRecs.filter((r) => r.impact === 'High').length,
      mediumImpactCount: costRecs.filter((r) => r.impact === 'Medium').length,
      lowImpactCount: costRecs.filter((r) => r.impact === 'Low').length,
      activeResourcesCount: costRecs.reduce((s, r) => s + (r.activeResources || 1), 0),
    },
    Security: {
      category: 'Security',
      recommendationsCount: securityRecs.length,
      scorePercentage: 40,
      totalSavingsUSD: 0,
      totalMonthlySavingsUSD: 0,
      highImpactCount: securityRecs.filter((r) => r.impact === 'High').length,
      mediumImpactCount: securityRecs.filter((r) => r.impact === 'Medium').length,
      lowImpactCount: securityRecs.filter((r) => r.impact === 'Low').length,
      activeResourcesCount: securityRecs.reduce((s, r) => s + (r.activeResources || 1), 0),
    },
    HighAvailability: {
      category: 'HighAvailability',
      recommendationsCount: haRecs.length,
      scorePercentage: 86,
      totalSavingsUSD: 0,
      totalMonthlySavingsUSD: 0,
      highImpactCount: haRecs.filter((r) => r.impact === 'High').length,
      mediumImpactCount: haRecs.filter((r) => r.impact === 'Medium').length,
      lowImpactCount: haRecs.filter((r) => r.impact === 'Low').length,
      activeResourcesCount: haRecs.reduce((s, r) => s + (r.activeResources || 1), 0),
    },
    Performance: {
      category: 'Performance',
      recommendationsCount: perfRecs.length,
      scorePercentage: 100,
      totalSavingsUSD: 0,
      totalMonthlySavingsUSD: 0,
      highImpactCount: perfRecs.filter((r) => r.impact === 'High').length,
      mediumImpactCount: perfRecs.filter((r) => r.impact === 'Medium').length,
      lowImpactCount: perfRecs.filter((r) => r.impact === 'Low').length,
      activeResourcesCount: perfRecs.reduce((s, r) => s + (r.activeResources || 1), 0),
    },
    OperationalExcellence: {
      category: 'OperationalExcellence',
      recommendationsCount: opRecs.length,
      scorePercentage: 90,
      totalSavingsUSD: 0,
      totalMonthlySavingsUSD: 0,
      highImpactCount: opRecs.filter((r) => r.impact === 'High').length,
      mediumImpactCount: opRecs.filter((r) => r.impact === 'Medium').length,
      lowImpactCount: opRecs.filter((r) => r.impact === 'Low').length,
      activeResourcesCount: opRecs.reduce((s, r) => s + (r.activeResources || 1), 0),
    },
  };

  const subs: AdvisorSubscription[] = [
    { id: '11111111-2222-3333-4444-555555555555', name: 'Producción Corporativa' },
    { id: '22222222-3333-4444-5555-666666666666', name: 'Staging & Pre-prod' },
  ];

  return {
    success: true,
    overallScore: 64.6,
    tenantName: 'CSCS Infra (Demo)',
    pillars,
    recommendations: {
      Cost: costRecs,
      Security: securityRecs,
      HighAvailability: haRecs,
      Performance: perfRecs,
      OperationalExcellence: opRecs,
    },
    subscriptions: subs,
    suppressedCount: 0,
    isMock: true,
  };
}

/**
 * Deduplica y consolida recomendaciones crudas de Azure Advisor:
 * - Agrupa combinaciones de términos (1y/7d, 1y/30d, 3y/7d, 3y/30d) por recurso/SKU.
 * - Extrae nombre real del recurso y resourceGroup desde ARM resourceId.
 * - Calcula el ahorro óptimo para evitar inflar el total anual.
 */
export function deduplicateAndProcessRecommendations(
  rawList: any[],
  category: AdvisorCategory,
  locale: string,
  subMap: Record<string, string>,
  suppressedSet: Set<string> = new Set()
): AdvisorRecommendation[] {
  if (!rawList || rawList.length === 0) return [];

  type RecBucket = {
    baseRec: Partial<AdvisorRecommendation>;
    options: Map<string, AdvisorReservationOption>;
    maxAnnualSavings: number;
    optMonthlySavings: number;
    activeCount: number;
  };

  const buckets = new Map<string, RecBucket>();

  for (const item of rawList) {
    const rawId = item.id || item.recommendationId || 'unknown';
    if (suppressedSet.has(rawId) || suppressedSet.has(item.name)) continue;

    const ext: Record<string, any> = item.extendedProperties || {};
    const rawResId = item.impactedValue || item.impactedField || item.resourceMetadata?.resourceId || item.resourceId || '';
    const resInfo = extractResourceDisplayName(rawResId);
    const subId = item.subscriptionId || 'unknown';
    const subName = subMap[subId] || subId;

    const problemRaw = item.shortDescription?.problem || item.recommendation || item.name || '';
    const solutionRaw = item.shortDescription?.solution || item.recommendedAction || '';
    const title = translateAdvisorText(problemRaw, locale, 'problem') || problemRaw;
    const desc = translateAdvisorText(solutionRaw, locale, 'solution') || solutionRaw;

    // Extraer monto de ahorro anual
    let annualSavings = 0;
    for (const [k, v] of Object.entries(ext)) {
      const lk = k.toLowerCase();
      if (lk === 'annualsavingsamount' || lk === 'savingsamount' || lk === 'costsavings') {
        const parsed = typeof v === 'number' ? v : parseFloat(String(v || '').replace(/,/g, ''));
        if (Number.isFinite(parsed) && parsed > 0) annualSavings = parsed;
      }
    }
    const monthlySavings = Number((annualSavings / 12).toFixed(2));

    const termRaw = ext.term ? String(ext.term) : '';
    const lookbackRaw = ext.lookbackPeriod ? String(ext.lookbackPeriod) : '';
    const termFormatted = formatAdvisorTermAndLookback(termRaw, lookbackRaw, locale).trim().replace(/^\(|\)$/g, '');

    // Clave de agrupación: si es reserva/savings plan, agrupar por recurso + regla
    const isReservation = /reserved|capacity|savings.?plan/i.test(problemRaw) || !!ext.term;
    const bucketKey = isReservation && resInfo.name !== '—'
      ? `${category}::${item.recommendationTypeId || problemRaw}::${resInfo.name}::${subId}`
      : `${category}::${rawId}`;

    let actionType = 'OPTIMIZE';
    if (/reserved|capacity|savings.?plan/i.test(problemRaw)) actionType = 'PURCHASE_RESERVATION';
    else if (/hybrid.*benefit|ahub|license/i.test(problemRaw)) actionType = 'APPLY_AHUB';
    else if (/right.?size|underutilized/i.test(problemRaw)) actionType = 'RESIZE';
    else if (/delete.*disk/i.test(problemRaw)) actionType = 'DELETE_DISK';
    else if (/delete.*ip/i.test(problemRaw)) actionType = 'DELETE_IP';
    else if (/lifecycle/i.test(problemRaw)) actionType = 'ENABLE_LIFECYCLE';

    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, {
        baseRec: {
          id: String(rawId),
          name: item.name || problemRaw,
          category,
          impact: (item.impact || 'Medium') as AdvisorImpact,
          resourceId: rawResId,
          resourceName: resInfo.name,
          resourceGroup: resInfo.resourceGroup || 'rg-default',
          subscriptionId: subId,
          subscriptionName: subName,
          serviceName: resInfo.type || 'Azure Service',
          titleTranslated: title,
          descriptionTranslated: desc,
          annualSavingsUSD: annualSavings,
          monthlySavingsUSD: monthlySavings,
          actionType,
          extendedProperties: ext,
          lastRefreshed: item.lastUpdated ? String(item.lastUpdated).slice(0, 10) : undefined,
          status: item._state === 'postponed' || item._state === 'dismissed' ? item._state : 'active',
          completionProgress: 0,
          activeResources: 1,
        },
        options: new Map<string, AdvisorReservationOption>(),
        maxAnnualSavings: annualSavings,
        optMonthlySavings: monthlySavings,
        activeCount: 1,
      });
    }

    const b = buckets.get(bucketKey)!;
    if (termFormatted) {
      b.options.set(termFormatted, {
        term: termRaw.includes('3') ? '3 Years' : '1 Year',
        lookback: `${lookbackRaw || '30'} Days`,
        annualSavingsUSD: annualSavings,
        monthlySavingsUSD: monthlySavings,
      });
      // Priorizar el mayor ahorro (o 3 años)
      if (annualSavings >= b.maxAnnualSavings) {
        b.maxAnnualSavings = annualSavings;
        b.optMonthlySavings = monthlySavings;
        b.baseRec.selectedTerm = termFormatted;
      }
    } else {
      b.activeCount += 1;
    }
  }

  const result: AdvisorRecommendation[] = [];
  for (const b of buckets.values()) {
    const rec = b.baseRec as AdvisorRecommendation;
    if (b.options.size > 0) {
      rec.reservationOptions = Array.from(b.options.values());
      rec.annualSavingsUSD = Number(b.maxAnnualSavings.toFixed(2));
      rec.monthlySavingsUSD = Number(b.optMonthlySavings.toFixed(2));
      if (!rec.selectedTerm && rec.reservationOptions.length > 0) {
        rec.selectedTerm = `${rec.reservationOptions[0].term} / ${rec.reservationOptions[0].lookback}`;
      }
    }
    rec.activeResources = b.activeCount;
    const cmd = buildAdvisorRemediationCommand(rec);
    rec.remediationCommand = cmd.cli;
    rec.powerShellCommand = cmd.powerShell;
    result.push(rec);
  }

  return result;
}

export async function getAdvisorExecutiveData(
  tenantId: string,
  locale: string = 'es',
  subscriptionFilter?: string
): Promise<AdvisorApiResponse> {
  if (isMockTenant(tenantId)) {
    const mockData = generateMockAdvisorData(locale);
    if (subscriptionFilter && subscriptionFilter !== 'all') {
      const filteredRecs: Record<AdvisorCategory, AdvisorRecommendation[]> = {
        Cost: [], Security: [], HighAvailability: [], Performance: [], OperationalExcellence: [],
      };
      for (const cat of CATEGORIES) {
        filteredRecs[cat] = mockData.recommendations[cat].filter((r) => r.subscriptionId === subscriptionFilter);
      }
      return {
        ...mockData,
        recommendations: filteredRecs,
      };
    }
    return mockData;
  }

  // Tenant Conectado: Cero fallbacks mock
  const rawData = await collectAdvisorData(tenantId, locale);

  let suppressedSet = new Set<string>();
  try {
    await initializeDatabase();
    await pool.query(
      `UPDATE RecommendationActions SET status='open', updated_at=CURRENT_TIMESTAMP
       WHERE tenant_id=? AND status='suppressed' AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP`,
      [tenantId]
    );
    const [supRows]: any = await pool.query(
      `SELECT recommendation_id FROM RecommendationActions
       WHERE tenant_id=? AND status='suppressed' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
      [tenantId]
    );
    suppressedSet = new Set((supRows as any[]).map((r) => r.recommendation_id));
  } catch (e: any) {
    console.warn('[advisor] suppressions DB lookup error:', e?.message);
  }

  const subMap: Record<string, string> = {};
  (rawData.subscriptions || []).forEach((s: any) => {
    subMap[s.id] = s.name || s.id;
  });

  const processedRecs: Record<AdvisorCategory, AdvisorRecommendation[]> = {
    Cost: [],
    Security: [],
    HighAvailability: [],
    Performance: [],
    OperationalExcellence: [],
  };

  const rawRecsGrouped = (rawData.recommendations as Record<string, any[]>) || {};

  for (const cat of CATEGORIES) {
    const rawList = rawRecsGrouped[cat] || [];
    let items = deduplicateAndProcessRecommendations(rawList, cat, locale, subMap, suppressedSet);
    if (subscriptionFilter && subscriptionFilter !== 'all') {
      items = items.filter((r) => r.subscriptionId === subscriptionFilter);
    }
    processedRecs[cat] = items;
  }

  // Calcular scores por pilar
  const scoresMap = rawData.scores || {};
  const scoreUnitsMap = rawData.scoreUnits || {};

  const calculateCatScore = (catName: string): number => {
    if (subscriptionFilter && subscriptionFilter !== 'all') {
      return scoresMap[subscriptionFilter]?.[catName] ?? 0;
    }
    const entries = Object.entries(scoresMap)
      .map(([sid, s]: [string, any]) => ({ v: s?.[catName] as number, w: Number(scoreUnitsMap[sid]?.[catName] ?? 0) }))
      .filter((e) => typeof e.v === 'number');
    if (entries.length === 0) return 0;
    const totalW = entries.reduce((a, e) => a + (e.w || 0), 0);
    if (totalW > 0) return entries.reduce((a, e) => a + e.v * (e.w || 0), 0) / totalW;
    return entries.reduce((a, e) => a + e.v, 0) / entries.length;
  };

  const overallScore = calculateCatScore('Advisor');

  const pillars: Record<AdvisorCategory, AdvisorPillarSummary> = {
    Cost: {
      category: 'Cost',
      recommendationsCount: processedRecs.Cost.length,
      scorePercentage: Math.round(calculateCatScore('Cost')),
      totalSavingsUSD: Number(processedRecs.Cost.reduce((s, r) => s + r.annualSavingsUSD, 0).toFixed(2)),
      totalMonthlySavingsUSD: Number((processedRecs.Cost.reduce((s, r) => s + r.annualSavingsUSD, 0) / 12).toFixed(2)),
      highImpactCount: processedRecs.Cost.filter((r) => r.impact === 'High').length,
      mediumImpactCount: processedRecs.Cost.filter((r) => r.impact === 'Medium').length,
      lowImpactCount: processedRecs.Cost.filter((r) => r.impact === 'Low').length,
      activeResourcesCount: processedRecs.Cost.reduce((s, r) => s + (r.activeResources || 1), 0),
    },
    Security: {
      category: 'Security',
      recommendationsCount: processedRecs.Security.length,
      scorePercentage: Math.round(calculateCatScore('Security')),
      totalSavingsUSD: 0,
      totalMonthlySavingsUSD: 0,
      highImpactCount: processedRecs.Security.filter((r) => r.impact === 'High').length,
      mediumImpactCount: processedRecs.Security.filter((r) => r.impact === 'Medium').length,
      lowImpactCount: processedRecs.Security.filter((r) => r.impact === 'Low').length,
      activeResourcesCount: processedRecs.Security.reduce((s, r) => s + (r.activeResources || 1), 0),
    },
    HighAvailability: {
      category: 'HighAvailability',
      recommendationsCount: processedRecs.HighAvailability.length,
      scorePercentage: Math.round(calculateCatScore('HighAvailability')),
      totalSavingsUSD: 0,
      totalMonthlySavingsUSD: 0,
      highImpactCount: processedRecs.HighAvailability.filter((r) => r.impact === 'High').length,
      mediumImpactCount: processedRecs.HighAvailability.filter((r) => r.impact === 'Medium').length,
      lowImpactCount: processedRecs.HighAvailability.filter((r) => r.impact === 'Low').length,
      activeResourcesCount: processedRecs.HighAvailability.reduce((s, r) => s + (r.activeResources || 1), 0),
    },
    Performance: {
      category: 'Performance',
      recommendationsCount: processedRecs.Performance.length,
      scorePercentage: Math.round(calculateCatScore('Performance')),
      totalSavingsUSD: 0,
      totalMonthlySavingsUSD: 0,
      highImpactCount: processedRecs.Performance.filter((r) => r.impact === 'High').length,
      mediumImpactCount: processedRecs.Performance.filter((r) => r.impact === 'Medium').length,
      lowImpactCount: processedRecs.Performance.filter((r) => r.impact === 'Low').length,
      activeResourcesCount: processedRecs.Performance.reduce((s, r) => s + (r.activeResources || 1), 0),
    },
    OperationalExcellence: {
      category: 'OperationalExcellence',
      recommendationsCount: processedRecs.OperationalExcellence.length,
      scorePercentage: Math.round(calculateCatScore('OperationalExcellence')),
      totalSavingsUSD: 0,
      totalMonthlySavingsUSD: 0,
      highImpactCount: processedRecs.OperationalExcellence.filter((r) => r.impact === 'High').length,
      mediumImpactCount: processedRecs.OperationalExcellence.filter((r) => r.impact === 'Medium').length,
      lowImpactCount: processedRecs.OperationalExcellence.filter((r) => r.impact === 'Low').length,
      activeResourcesCount: processedRecs.OperationalExcellence.reduce((s, r) => s + (r.activeResources || 1), 0),
    },
  };

  return {
    success: true,
    overallScore: Number(overallScore.toFixed(1)),
    tenantName: tenantId,
    pillars,
    recommendations: processedRecs,
    subscriptions: rawData.subscriptions || [],
    suppressedCount: suppressedSet.size,
    isMock: false,
  };
}
