/**
 * TypeScript Contracts for FinOps Scorecard — Responsabilidad por Equipo
 *
 * El scorecard solo sirve si los equipos están bien identificados. En la
 * práctica el mismo equipo aparece etiquetado como `IA`, `ai`, `Artificial
 * Intelligence` y ` IA ` según quién creó el recurso, y sin normalizar eso el
 * tablero muestra cuatro equipos fantasma con scores parciales en vez de uno
 * real. Por eso el pipeline de alias corre ANTES del cálculo.
 */

export type ScorecardPillar = "Tags" | "Zombies" | "Commitments" | "Budget";

export type ScorecardStatus = "EXCELLENT" | "GOOD" | "NEEDS_ATTENTION" | "INACTIVE";

/** Puntaje máximo de cada pilar. Suman 100. */
export const PILLAR_MAX_POINTS: Record<ScorecardPillar, number> = {
  Tags: 30,
  Zombies: 30,
  Commitments: 20,
  Budget: 20,
};

/** Etiqueta unificada para los recursos sin tag de equipo. */
export const UNTAGGED_TEAM = "Sin Asignar (Untagged)";

/**
 * Sinónimos conocidos → nombre canónico. Se comparan contra el nombre ya
 * sanitizado (trim + minúsculas + separadores colapsados).
 */
export const TEAM_ALIASES: Record<string, string> = {
  ia: "IA & Machine Learning",
  ai: "IA & Machine Learning",
  "artificial intelligence": "IA & Machine Learning",
  "inteligencia artificial": "IA & Machine Learning",
  ml: "IA & Machine Learning",
  "machine learning": "IA & Machine Learning",
  finops: "CloudOps / FinOps",
  "cscs finops": "CloudOps / FinOps",
  cloudops: "CloudOps / FinOps",
  "cloud ops": "CloudOps / FinOps",
  devops: "CloudOps / FinOps",
  eng: "Engineering",
  engineering: "Engineering",
  ingenieria: "Engineering",
  desarrollo: "Engineering",
  dev: "Engineering",
  mkt: "Marketing",
  marketing: "Marketing",
  data: "Data & Analytics",
  analytics: "Data & Analytics",
  "data analytics": "Data & Analytics",
  bi: "Data & Analytics",
};

/** Desvío presupuestario tolerado antes de penalizar. */
export const BUDGET_TOLERANCE_PERCENTAGE = 5;

export interface ScorecardPenaltyItem {
  id: string;
  pillar: ScorecardPillar;
  reason: string;
  /**
   * Clave i18n y parámetros del mismo motivo. `reason` queda como texto en
   * español para los consumidores que no traducen (payload del Copilot,
   * exports); la UI usa la clave, porque el servicio corre en el servidor y no
   * sabe en qué idioma está mirando el usuario.
   */
  reasonKey?: string;
  reasonParams?: Record<string, string | number>;
  pointsDeducted: number;
  financialImpactUSD: number;
  affectedResourcesCount: number;
  /** Nombres de los recursos concretos que causan la penalización. */
  affectedResourceNames: string[];
  remediationActionType: string;
  commandPayload?: string;
}

export interface TeamScorecardItem {
  rank: number;
  teamId: string;
  teamName: string;
  /** Variantes de tag que se fusionaron en este equipo, para trazabilidad. */
  mergedAliases: string[];
  monthlySpendUSD: number;
  managedResourcesCount: number;
  taggedResourcesCount: number;
  zombieCostUSD: number;
  commitmentCoveragePercentage: number;
  budgetUSD: number;
  tagHygieneScore: number;
  wasteScore: number;
  commitmentScore: number;
  budgetDisciplineScore: number;
  overallScore: number;
  penalties: ScorecardPenaltyItem[];
  status: ScorecardStatus;
  /** `true` cuando el equipo no tiene gasto ni recursos: no compite en el ranking. */
  isInactive: boolean;
}

export interface ScorecardSummaryMetrics {
  tenantAvgScore: number;
  topPerformingTeam: string;
  topPerformingScore: number;
  totalEvaluatedTeams: number;
  activeTeamsCount: number;
  totalPenaltyWasteUSD: number;
  untaggedSpendUSD: number;
  teams: TeamScorecardItem[];
}

export interface ScorecardRemediationAction {
  id: string;
  teamId: string;
  penaltyId: string;
  title: string;
  description: string;
  /** Clave i18n y params. Ver la nota en `reasonKey`. */
  titleKey?: string;
  titleParams?: Record<string, string | number>;
  descriptionKey?: string;
  descriptionParams?: Record<string, string | number>;
  actionType: "FIX_TAGS" | "PURGE_ZOMBIE" | "BUDGET_REVIEW" | "NOTIFY_OWNERS";
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  commandPayload?: string;
}

export interface ScorecardPayload {
  summary: ScorecardSummaryMetrics;
  remediations: ScorecardRemediationAction[];
  source: "live" | "mock";
  lastUpdated: string;
}

/** Paleta institucional: nada de dorados ni amarillos planos en el podio. */
export const SCORECARD_COLORS = {
  first: "#0078D4",
  medal: "#2563EB",
  pillar: "#0284C7",
  neutral: "#94A3B8",
} as const;

export const PILLAR_LABELS: Record<ScorecardPillar, string> = {
  Tags: "Higiene de Tags",
  Zombies: "Ausencia de Desperdicio",
  Commitments: "Cobertura de Tarifas",
  Budget: "Disciplina Presupuestaria",
};
