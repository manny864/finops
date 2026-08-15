/**
 * Modelos y tipos para el módulo de Progreso Histórico y Retorno de Inversión FinOps.
 * Soporta granularidad de 30 días, 3 meses, 6 meses y 1 año.
 */

export type HistoryTimeRange = '30d' | '90d' | '180d' | '365d';

export interface FinOpsPillarsScore {
  allocation: number;    // Asignación de Costos (0-100)
  rates: number;         // Optimización de Tarifas/Compromisos (0-100)
  usage: number;         // Optimización de Uso/Rightsizing (0-100)
  governance: number;    // Gobernanza y Automatización (0-100)
}

export interface HistoricalDataPoint {
  date: string;                      // YYYY-MM-DD
  label: string;                     // "15 Ene", "Sem 3", "Feb 2026"
  
  // 1. Madurez FinOps
  maturityScore: number;             // 0 - 100
  maturityLevel: 'Crawl' | 'Walk' | 'Run';
  pillars: FinOpsPillarsScore;

  // 2. Higiene de Tags & Asignación
  tagCompliancePct: number;          // % recursos con tags requeridos
  unallocatedSpend: number;          // USD sin CostCenter/Owner
  inheritedTagsCount: number;        // Recursos con tags heredados
  totalSpend: number;                // Gasto bruto total en ese período

  // 3. Compromisos & Zombis
  commitmentCoveragePct: number;     // % vCPUs bajo RIs / Savings Plans
  commitmentUtilizationPct: number;  // % de RIs/SPs efectivamente usados
  ahubVcores: number;                // vCores Windows / SQL bajo AHUB
  zombiesPurgedCount: number;        // Cantidad acumulada de zombis eliminados
  recurringSavingsAvoided: number;   // USD/mes ahorrados permanentemente

  // 4. Deuda FinOps & Burndown
  openDebtBacklog: number;           // USD en ineficiencias abiertas
  remediationPace: number;           // USD resueltos por mes
  avgTimeToRemediateDays: number;    // Días promedio en ejecutar la acción

  // 5. ROI & Línea Base Contrafactual
  actualSpend: number;               // Gasto real facturado ($ USD)
  counterfactualCost: number;        // Lo que habrías gastado sin FinOps ($ USD)
  netSavingsAccumulated: number;     // Ahorro neto acumulado ($ USD)
  budget: number;                    // Presupuesto asignado ($ USD)
  forecastSpend: number;             // Estimación del modelo ML ($ USD)
  anomalyCount: number;              // Cantidad de anomalías detectadas

  // 6. Sostenibilidad (GreenOps)
  emissionsMtco2e: number;           // MTCO2e emitidas
  carbonAvoidedMtco2e: number;       // MTCO2e evitadas acumuladas

  // 7. Ahorro Realizado vs Fuga
  realizedSavings: number;           // Ahorro ejecutado verificado ($ USD)
  leakageSpend: number;              // Dinero en fuga por dilación ($ USD)
}

export interface BeforeAfterVerificationItem {
  id: string;
  resourceName: string;
  resourceGroup: string;
  subscriptionName: string;
  resourceType: string;
  actionType: 'rightsizing' | 'elastic_pool' | 'spot_instance' | 'storage_tier' | 'auto_shutdown' | 'zombie_delete';
  executedDate: string;
  executedBy: string;
  costPre30d: number;
  costPost30d: number;
  estimatedMonthlySavings: number;
  realizedMonthlySavings: number;
  accuracyPct: number;
  reboundStatus: 'verified_optimal' | 'warning_rebound' | 'stable';
  reboundDetails?: string;
}

export interface ArchitectureMilestoneItem {
  id: string;
  date: string;
  title: string;
  description: string;
  type: 'release' | 'migration' | 'infrastructure' | 'policy';
  monthlyCostDelta: number; // Variación inmediata ej: -1250 o +400
}

export interface WaiverLedgerItem {
  id: string;
  resourceName: string;
  resourceGroup: string;
  category: 'Cost' | 'Security' | 'Reliability' | 'Performance' | 'OperationalExcellence';
  recommendationTitle: string;
  estimatedMonthlySavings: number;
  dismissedDate: string;
  expiryDate: string;
  reason: string;
  engineerName: string;
  status: 'active_waiver' | 'expired_waiver' | 'under_review';
}

export interface HistoricalProgressReport {
  timeRange: HistoryTimeRange;
  currentMaturityScore: number;
  currentMaturityLevel: 'Crawl' | 'Walk' | 'Run';
  totalCounterfactualSavings: number;
  currentTagCompliancePct: number;
  currentCommitmentCoveragePct: number;
  currentCommitmentUtilizationPct: number;
  currentRealizedSavings: number;
  currentLeakageSpend: number;
  totalZombiesPurged: number;
  totalCarbonAvoidedMtco2e: number;
  series: HistoricalDataPoint[];
  beforeAfterVerifications: BeforeAfterVerificationItem[];
  architectureMilestones: ArchitectureMilestoneItem[];
  waiverLedger: WaiverLedgerItem[];
}

/**
 * Determina el nivel de madurez FinOps según el puntaje (0-100).
 */
export function getMaturityLevel(score: number): 'Crawl' | 'Walk' | 'Run' {
  if (score >= 75) return 'Run';
  if (score >= 40) return 'Walk';
  return 'Crawl';
}
