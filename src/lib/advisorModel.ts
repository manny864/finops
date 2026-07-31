// Modelo normalizado de Azure Advisor que consume AdvisorPanel.
// Tanto el mock (demos) como el mapeo de datos reales de Azure producen esta
// forma. Los campos que la Advisor REST API no provee (progreso de completado,
// reducción de carbono, ciclo de vida Active/Completed/Postponed/Dismissed con
// fechas) se rellenan con mock en demos y degradan a valores neutros en real.

export type AdvisorCategory =
  | 'Cost'
  | 'Security'
  | 'HighAvailability'
  | 'Performance'
  | 'OperationalExcellence';

export type AdvisorImpact = 'High' | 'Medium' | 'Low';

// Fila de ciclo de vida (variante estándar de reservas/optimización).
export interface AdvisorLifecycleRow {
  subscription: string;
  recommendedQuantity?: string;
  recommendedAction: string;
  potentialYearlySavings: number;
  term?: string;              // '1 año' | '3 años'
  lookBackPeriod?: string;    // '7 días' | '30 días' | '60 días'
  created?: string;           // ISO date
  lastUpdated?: string;       // Active
  completionDetails?: string; // Completed
  completedOn?: string;       // Completed
  postponedUntil?: string;    // Postponed
  postponedOn?: string;       // Postponed
  dismissalReason?: string;   // Dismissed
  dismissedOn?: string;       // Dismissed
}

// Fila de ciclo de vida (variante con reducción de carbono: rightsizing de VMs).
export interface AdvisorCarbonRow {
  virtualMachine: string;
  recommendedAction: string;
  savingsRetail: number;       // potential yearly savings based on retail pricing
  savingsDiscounted: number;   // ...based on discounted pricing
  carbonReduction: number;     // potential carbon reductions (kg CO2e/año)
  subscription: string;
  recommendationRule: string;
  additionalDetails: string;
}

// Fila genérica para datos reales: las columnas se arman dinámicamente desde
// extendedProperties de Azure (varían por tipo de recomendación).
export interface AdvisorDynamicRow {
  subscription: string;
  resource?: string;
  cells: Record<string, string>;   // label de columna -> valor
  potentialYearlySavings?: number;
  carbon?: number;
  until?: string;   // Postponed: hasta
  on?: string;      // Postponed/Dismissed: fecha
}

export interface AdvisorRecommendation {
  id: string;
  category: AdvisorCategory;
  subscriptionId: string;
  recommendation: string;      // título / problema
  impact: AdvisorImpact;
  activeResources: number;     // recursos afectados por este tipo de recomendación
  completionProgress: number;  // 0..100
  potentialSavings?: number;   // ahorro anual USD (Cost)
  potentialCarbon?: number;    // reducción de carbono kg CO2e/año (opcional)
  recommendedAction: string;   // solución / acción recomendada
  costImplication?: string;    // Reliability: implicación de costo
  lastRefreshed?: string;      // ISO date

  // Detalle para el modal (solo Cost). Si isCarbon, las tablas usan AdvisorCarbonRow.
  isCarbon?: boolean;
  detailDescription?: string;
  yearlySavingsDiscounted?: number;
  yearlyCarbon?: number;
  // Presente en datos REALES: columnas dinámicas (labels) derivadas de
  // extendedProperties. Si está, el modal renderiza filas AdvisorDynamicRow.
  dynamicColumns?: string[];
  lifecycle?: {
    active: (AdvisorLifecycleRow | AdvisorCarbonRow | AdvisorDynamicRow)[];
    completed: (AdvisorLifecycleRow | AdvisorCarbonRow | AdvisorDynamicRow)[];
    postponed: (AdvisorLifecycleRow | AdvisorCarbonRow | AdvisorDynamicRow)[];
    dismissed: (AdvisorLifecycleRow | AdvisorCarbonRow | AdvisorDynamicRow)[];
  };
}

export interface AdvisorSubscription {
  id: string;
  name: string;
}

export interface AdvisorCategoryScore {
  // Score 0..100 estilo Azure Advisor por categoría + total.
  Advisor?: number;
  Cost?: number;
  Security?: number;
  HighAvailability?: number;
  Performance?: number;
  OperationalExcellence?: number;
}

export interface AdvisorModel {
  recommendations: Record<AdvisorCategory, AdvisorRecommendation[]>;
  subscriptions: AdvisorSubscription[];
  // score por suscripción: { [subId]: { Cost, Security, ... , Advisor } }
  scores: Record<string, AdvisorCategoryScore>;
  // consumptionUnits por suscripción y categoría, para ponderar la agregación
  // del Advisor Score entre suscripciones igual que Azure (media ponderada).
  scoreUnits?: Record<string, Partial<Record<string, number>>>;
  // total de recursos evaluados por categoría (para "X / total") por suscripción.
  resourceTotals?: Record<string, Partial<Record<AdvisorCategory, number>>>;
}

export const ADVISOR_CATEGORIES: AdvisorCategory[] = [
  'Cost',
  'Security',
  'HighAvailability',
  'Performance',
  'OperationalExcellence',
];

// Mapea el string de impacto de Azure ('High'|'Medium'|'Low') a nuestro tipo.
export function normalizeImpact(raw: unknown): AdvisorImpact {
  const s = String(raw || '').toLowerCase();
  if (s.startsWith('high') || s === 'alto') return 'High';
  if (s.startsWith('low') || s === 'bajo') return 'Low';
  return 'Medium';
}

// Clases Tailwind para el badge de impacto: High=rojo, Medium=naranja, Low=azul.
export function impactBadgeClasses(impact: AdvisorImpact): string {
  switch (impact) {
    case 'High':
      return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900';
    case 'Low':
      return 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900';
    default:
      return 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900';
  }
}

// Parsea de forma robusta valores numéricos devueltos por Azure Advisor
// (p.ej. números, cadenas "1234.56" o cadenas con separadores de miles "1,234.56").
export function parseAzureNumber(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (val === null || val === undefined || val === '') return 0;
  const str = String(val).trim().replace(/,/g, '');
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : 0;
}

