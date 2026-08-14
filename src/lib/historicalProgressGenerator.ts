import {
  HistoricalDataPoint,
  HistoricalProgressReport,
  HistoryTimeRange,
  BeforeAfterVerificationItem,
  ArchitectureMilestoneItem,
  WaiverLedgerItem,
  getMaturityLevel,
} from './historicalProgressModel';

/**
 * Generador determinista de datos de Progreso Histórico FinOps.
 * Modela el avance real de una organización a lo largo del tiempo.
 */
export function generateHistoricalProgressReport(
  timeRange: HistoryTimeRange = '90d',
  tier: string = 'business'
): HistoricalProgressReport {
  const normTier = tier.toLowerCase();
  const tierMultiplier = normTier === 'enterprise' ? 2.5 : normTier === 'business' ? 1.5 : 1.0;

  // Determinar cantidad de puntos según el rango de tiempo
  let pointCount = 12;
  let dayStep = 7;
  let dateUnit: 'day' | 'week' | 'month' = 'week';

  if (timeRange === '30d') {
    pointCount = 30;
    dayStep = 1;
    dateUnit = 'day';
  } else if (timeRange === '90d') {
    pointCount = 13;
    dayStep = 7;
    dateUnit = 'week';
  } else if (timeRange === '180d') {
    pointCount = 26;
    dayStep = 7;
    dateUnit = 'week';
  } else if (timeRange === '365d') {
    pointCount = 12;
    dayStep = 30;
    dateUnit = 'month';
  }

  const baseMonthlySpend = 14500 * tierMultiplier;
  const initialCounterfactual = baseMonthlySpend * 1.15;

  const initialMaturity = 42;
  const targetMaturity = Math.min(96, 78 + Math.round(tierMultiplier * 6));

  const initialTagCompliance = 54.0;
  const targetTagCompliance = 93.5;

  const initialCoverage = 48.0;
  const targetCoverage = 86.4;

  const series: HistoricalDataPoint[] = [];

  let cumNetSavings = 0;
  let cumZombies = 0;
  let cumRealized = 0;
  let cumLeakage = 0;
  let cumCarbonAvoided = 0;

  for (let i = 0; i < pointCount; i++) {
    const t = pointCount === 1 ? 1 : i / (pointCount - 1);
    const daysAgo = (pointCount - 1 - i) * dayStep;
    const dateObj = new Date(Date.now() - daysAgo * 86400000);
    const dateStr = dateObj.toISOString().split('T')[0];

    // Label amigable
    let label = dateStr;
    if (dateUnit === 'day') {
      label = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(dateObj);
    } else if (dateUnit === 'week') {
      label = `Sem ${i + 1} (${new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(dateObj)})`;
    } else {
      label = new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric' }).format(dateObj);
    }

    // 1. Madurez
    const curve = Math.pow(t, 0.85); // Avance más rápido al principio
    const maturityScore = parseFloat((initialMaturity + (targetMaturity - initialMaturity) * curve).toFixed(1));
    const maturityLevel = getMaturityLevel(maturityScore);

    const pillars = {
      allocation: parseFloat(Math.min(98, (initialMaturity - 4) + 48 * curve).toFixed(1)),
      rates: parseFloat(Math.min(95, (initialMaturity - 6) + 50 * curve).toFixed(1)),
      usage: parseFloat(Math.min(96, (initialMaturity + 2) + 44 * curve).toFixed(1)),
      governance: parseFloat(Math.min(92, (initialMaturity - 8) + 46 * curve).toFixed(1)),
    };

    // 2. Tags & Unallocated
    const tagCompliancePct = parseFloat((initialTagCompliance + (targetTagCompliance - initialTagCompliance) * curve).toFixed(1));
    const unallocatedSpendPct = Math.max(0.06, 0.40 - 0.32 * curve);
    const periodSpend = (baseMonthlySpend * (1 - 0.28 * curve));
    const unallocatedSpend = parseFloat((periodSpend * unallocatedSpendPct).toFixed(2));
    const inheritedTagsCount = Math.round(15 * tierMultiplier + (85 * tierMultiplier - 15 * tierMultiplier) * curve);

    // 3. Compromisos & Zombis
    const commitmentCoveragePct = parseFloat((initialCoverage + (targetCoverage - initialCoverage) * curve).toFixed(1));
    const commitmentUtilizationPct = parseFloat((92.0 + 6.8 * Math.sin(t * Math.PI)).toFixed(1));
    const ahubVcores = Math.round(24 * tierMultiplier + (128 * tierMultiplier - 24 * tierMultiplier) * curve);
    
    const zombiesThisStep = Math.max(1, Math.round((6 * tierMultiplier) * (1 - t * 0.7)));
    cumZombies += zombiesThisStep;
    const recurringSavingsAvoided = parseFloat((cumZombies * 140).toFixed(2));

    // 4. Deuda FinOps
    const openDebtBacklog = parseFloat((Math.max(1500, (32000 * tierMultiplier) * (1 - curve * 0.82))).toFixed(2));
    const remediationPace = parseFloat(((4200 * tierMultiplier) * (1 + t * 0.5)).toFixed(2));
    const avgTimeToRemediateDays = parseFloat((Math.max(3.2, 22 - 17.5 * curve)).toFixed(1));

    // 5. ROI & Contrafactual
    const counterfactualCost = parseFloat((initialCounterfactual * (1 + t * 0.08)).toFixed(2)); // Crecimiento orgánico si no se optimizaba
    const actualSpend = parseFloat(periodSpend.toFixed(2));
    const budget = parseFloat((baseMonthlySpend * 1.05).toFixed(2));
    const forecastSpend = parseFloat((actualSpend * (1 + (Math.sin(i * 1.5) * 0.03))).toFixed(2));
    const stepSavings = Math.max(0, counterfactualCost - actualSpend);
    cumNetSavings += stepSavings / (pointCount > 20 ? 30 : 4);
    const netSavingsAccumulated = parseFloat(cumNetSavings.toFixed(2));
    const anomalyCount = Math.max(0, Math.round(4 - 3.2 * curve));

    // 6. Carbon GreenOps
    const emissionsMtco2e = parseFloat((Math.max(4.2, (28.4 * tierMultiplier) * (1 - curve * 0.45))).toFixed(2));
    cumCarbonAvoided += (0.8 * tierMultiplier);
    const carbonAvoidedMtco2e = parseFloat(cumCarbonAvoided.toFixed(2));

    // 7. Ahorro Realizado vs Fuga
    const realizedStep = Math.round(stepSavings * 0.88);
    const leakageStep = Math.round(stepSavings * 0.12);
    cumRealized += realizedStep / (pointCount > 20 ? 30 : 4);
    cumLeakage += leakageStep / (pointCount > 20 ? 30 : 4);
    const realizedSavings = parseFloat(cumRealized.toFixed(2));
    const leakageSpend = parseFloat(cumLeakage.toFixed(2));

    series.push({
      date: dateStr,
      label,
      maturityScore,
      maturityLevel,
      pillars,
      tagCompliancePct,
      unallocatedSpend,
      inheritedTagsCount,
      totalSpend: actualSpend,
      commitmentCoveragePct,
      commitmentUtilizationPct,
      ahubVcores,
      zombiesPurgedCount: cumZombies,
      recurringSavingsAvoided,
      openDebtBacklog,
      remediationPace,
      avgTimeToRemediateDays,
      actualSpend,
      counterfactualCost,
      netSavingsAccumulated,
      budget,
      forecastSpend,
      anomalyCount,
      emissionsMtco2e,
      carbonAvoidedMtco2e,
      realizedSavings,
      leakageSpend,
    });
  }

  // Colecciones de detalle
  const beforeAfterVerifications: BeforeAfterVerificationItem[] = [
    {
      id: 'v-1',
      resourceName: 'vm-app-frontend-prod-01',
      resourceGroup: 'rg-prod-eastus',
      subscriptionName: 'Producción Corporativa',
      resourceType: 'Microsoft.Compute/virtualMachines',
      actionType: 'rightsizing',
      executedDate: new Date(Date.now() - 42 * 86400000).toISOString().split('T')[0],
      executedBy: 'mchavez@cscloudsolutions.com',
      costPre30d: 584.20 * tierMultiplier,
      costPost30d: 292.10 * tierMultiplier,
      estimatedMonthlySavings: 290.00 * tierMultiplier,
      realizedMonthlySavings: 292.10 * tierMultiplier,
      accuracyPct: 100.7,
      reboundStatus: 'verified_optimal',
      reboundDetails: 'Estable en P95 de CPU (58%). Sin incremento de IOPS.',
    },
    {
      id: 'v-2',
      resourceName: 'sql-db-core-analytics',
      resourceGroup: 'rg-data-analytics',
      subscriptionName: 'Producción Corporativa',
      resourceType: 'Microsoft.Sql/servers/databases',
      actionType: 'elastic_pool',
      executedDate: new Date(Date.now() - 35 * 86400000).toISOString().split('T')[0],
      executedBy: 'Automated FinOps Policy',
      costPre30d: 1420.00 * tierMultiplier,
      costPost30d: 680.00 * tierMultiplier,
      estimatedMonthlySavings: 700.00 * tierMultiplier,
      realizedMonthlySavings: 740.00 * tierMultiplier,
      accuracyPct: 105.7,
      reboundStatus: 'verified_optimal',
      reboundDetails: 'Consolidación de 6 BDs individuales a Pool Standard 200 DTU.',
    },
    {
      id: 'v-3',
      resourceName: 'vm-batch-worker-node-04',
      resourceGroup: 'rg-processing-westus',
      subscriptionName: 'Desarrollo & QA',
      resourceType: 'Microsoft.Compute/virtualMachines',
      actionType: 'rightsizing',
      executedDate: new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0],
      executedBy: 'devops-ci@cscloudsolutions.com',
      costPre30d: 340.00 * tierMultiplier,
      costPost30d: 322.00 * tierMultiplier,
      estimatedMonthlySavings: 140.00 * tierMultiplier,
      realizedMonthlySavings: 18.00 * tierMultiplier,
      accuracyPct: 12.8,
      reboundStatus: 'warning_rebound',
      reboundDetails: 'Efecto Rebote: La reducción de SKU provocó aumento en transacciones de disco P10.',
    },
    {
      id: 'v-4',
      resourceName: 'stgarchivelogseastus2',
      resourceGroup: 'rg-logs-central',
      subscriptionName: 'Producción Corporativa',
      resourceType: 'Microsoft.Storage/storageAccounts',
      actionType: 'storage_tier',
      executedDate: new Date(Date.now() - 56 * 86400000).toISOString().split('T')[0],
      executedBy: 'mchavez@cscloudsolutions.com',
      costPre30d: 890.00 * tierMultiplier,
      costPost30d: 185.00 * tierMultiplier,
      estimatedMonthlySavings: 680.00 * tierMultiplier,
      realizedMonthlySavings: 705.00 * tierMultiplier,
      accuracyPct: 103.6,
      reboundStatus: 'verified_optimal',
      reboundDetails: 'Lifecycle Policy: Blobs >30d movidos a Cool y >90d a Archive.',
    },
    {
      id: 'v-5',
      resourceName: 'asp-microservices-eastus',
      resourceGroup: 'rg-apps-eastus',
      subscriptionName: 'Producción Corporativa',
      resourceType: 'Microsoft.Web/serverfarms',
      actionType: 'rightsizing',
      executedDate: new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0],
      executedBy: 'mchavez@cscloudsolutions.com',
      costPre30d: 620.00 * tierMultiplier,
      costPost30d: 310.00 * tierMultiplier,
      estimatedMonthlySavings: 310.00 * tierMultiplier,
      realizedMonthlySavings: 310.00 * tierMultiplier,
      accuracyPct: 100.0,
      reboundStatus: 'stable',
      reboundDetails: 'Migración de Premium V2 a Premium V3 con mejor costo/rendimiento.',
    },
  ];

  const architectureMilestones: ArchitectureMilestoneItem[] = [
    {
      id: 'm-1',
      date: new Date(Date.now() - 75 * 86400000).toISOString().split('T')[0],
      title: 'Migración a Azure SQL Elastic Pool',
      description: 'Consolidación de 6 bases de datos independientes en un Elastic Pool compartido.',
      type: 'migration',
      monthlyCostDelta: -740.00 * tierMultiplier,
    },
    {
      id: 'm-2',
      date: new Date(Date.now() - 50 * 86400000).toISOString().split('T')[0],
      title: 'Release v3.0: Arquitectura de Microservicios',
      description: 'Pase a producción de microservicios con optimización de pods y autoscaling KEDA.',
      type: 'release',
      monthlyCostDelta: -450.00 * tierMultiplier,
    },
    {
      id: 'm-3',
      date: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
      title: 'Expansión de Región: Brazil South',
      description: 'Despliegue de stack secundario para compliance de latencia regional LATAM.',
      type: 'infrastructure',
      monthlyCostDelta: +820.00 * tierMultiplier,
    },
    {
      id: 'm-4',
      date: new Date(Date.now() - 15 * 86400000).toISOString().split('T')[0],
      title: 'Activación de Power Schedules en DEV/QA',
      description: 'Apagado nocturno y fin de semana automatizado de 24 VMs no productivas.',
      type: 'policy',
      monthlyCostDelta: -1120.00 * tierMultiplier,
    },
  ];

  const waiverLedger: WaiverLedgerItem[] = [
    {
      id: 'w-1',
      resourceName: 'vm-sap-core-prod-01',
      resourceGroup: 'rg-erp-prod',
      category: 'Cost',
      recommendationTitle: 'Redimensionar Standard_E16s_v4 → Standard_E8s_v4',
      estimatedMonthlySavings: 480.00 * tierMultiplier,
      dismissedDate: new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0],
      expiryDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      reason: 'SLA crítico ERP: Certificación del fabricante exige mínimo 64GB de RAM garantizada.',
      engineerName: 'lead-architect@cscloudsolutions.com',
      status: 'active_waiver',
    },
    {
      id: 'w-2',
      resourceName: 'st-temp-migration-data',
      resourceGroup: 'rg-migration-temp',
      category: 'Cost',
      recommendationTitle: 'Mover almacenamiento a nivel Cool/Archive',
      estimatedMonthlySavings: 240.00 * tierMultiplier,
      dismissedDate: new Date(Date.now() - 95 * 86400000).toISOString().split('T')[0],
      expiryDate: new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0],
      reason: 'Proyecto de migración temporal de Q1. Requería acceso Hot continuo por 60 días.',
      engineerName: 'data-eng@cscloudsolutions.com',
      status: 'expired_waiver',
    },
    {
      id: 'w-3',
      resourceName: 'sql-db-reporting-dw',
      resourceGroup: 'rg-data-dw',
      category: 'Performance',
      recommendationTitle: 'Cambiar a vCore con Serverless Auto-pause',
      estimatedMonthlySavings: 310.00 * tierMultiplier,
      dismissedDate: new Date(Date.now() - 20 * 86400000).toISOString().split('T')[0],
      expiryDate: new Date(Date.now() + 70 * 86400000).toISOString().split('T')[0],
      reason: 'Cierres contables mensuales requieren disponibilidad 24/7 sin latencia de warm-up.',
      engineerName: 'cfo-ops@cscloudsolutions.com',
      status: 'active_waiver',
    },
  ];

  const lastPoint = series[series.length - 1];

  return {
    timeRange,
    currentMaturityScore: lastPoint.maturityScore,
    currentMaturityLevel: lastPoint.maturityLevel,
    totalCounterfactualSavings: lastPoint.netSavingsAccumulated,
    currentTagCompliancePct: lastPoint.tagCompliancePct,
    currentCommitmentCoveragePct: lastPoint.commitmentCoveragePct,
    currentCommitmentUtilizationPct: lastPoint.commitmentUtilizationPct,
    currentRealizedSavings: lastPoint.realizedSavings,
    currentLeakageSpend: lastPoint.leakageSpend,
    totalZombiesPurged: lastPoint.zombiesPurgedCount,
    totalCarbonAvoidedMtco2e: lastPoint.carbonAvoidedMtco2e,
    series,
    beforeAfterVerifications,
    architectureMilestones,
    waiverLedger,
  };
}
