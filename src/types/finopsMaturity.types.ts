export type MaturityStage = 'CRAWL' | 'WALK' | 'RUN';
/** Alias del contrato publico: mismo dominio que MaturityStage. */
export type MaturityLevel = MaturityStage;

export interface SubmitAssessmentPayload {
  tenantId: string;
  /** questionId -> score elegido (0-100). */
  answers: Record<string, number>;
}

export interface SubmitAssessmentResponse {
  success: boolean;
  score: number;
  level: string;
  error?: string;
}

export interface MaturityDimension {
  key: string;
  name: string;
  score: number;
  stage: MaturityStage;
  recommendationsCount: number;
  actionPlan: string;
  /**
   * Clave i18n del plan de acción, y sus parámetros. `actionPlan` queda como
   * texto en español para los consumidores que no traducen; la UI usa la clave,
   * porque el servicio corre en el servidor y no sabe en qué idioma está mirando
   * el usuario.
   */
  actionPlanKey?: string;
  actionPlanParams?: Record<string, string | number>;
  /** Nota de divergencia entre autoevaluación y telemetría, si aplica. */
  divergenceKey?: string;
  divergenceParams?: Record<string, string | number>;
  /** Score derivado de telemetría de Azure, cuando la autoevaluación lo sustituye. */
  telemetryScore?: number;
  /** De dónde sale `score`: respuesta del equipo, telemetría, o el promedio. */
  scoreSource?: 'self_assessment' | 'telemetry' | 'blended';
}

/**
 * Qué pesa al calcular la madurez de un dominio, elegible por tenant
 * (`TenantGlobalSettings.maturity_score_policy`).
 *
 *  - `self_assessment`: manda la respuesta del equipo. Es el default y la
 *    lectura del modelo Crawl-Walk-Run de la FinOps Foundation.
 *  - `telemetry`: manda la evidencia medida en Azure. Para un cliente auditado,
 *    donde lo declarado no alcanza.
 *  - `blended_50_50`: el promedio de ambas.
 *
 * En los tres casos la divergencia se sigue anotando en el plan de acción: es
 * la conversación FinOps útil, no un efecto de qué número gana.
 */
export type MaturityScorePolicy = 'self_assessment' | 'telemetry' | 'blended_50_50';

export interface MaturityMilestone {
  dimensionKey: string;
  /** Nivel de origen y destino como enum: la UI los traduce. */
  fromStage: MaturityStage;
  toStage: MaturityStage;
  title: string;
  description: string;
  /** Claves i18n del hito. Ver la nota en `actionPlanKey`. */
  titleKey?: string;
  descriptionKey?: string;
  descriptionParams?: Record<string, string | number>;
  actionType: string;
  estimatedEffort?: 'LOW' | 'MEDIUM' | 'HIGH';
  impactScore?: number;
  commandPayload?: string;
}

export interface MaturitySummary {
  overallScore: number;
  overallStage: MaturityStage;
  dimensions: MaturityDimension[];
  nextMilestones: MaturityMilestone[];
}

/**
 * Una pregunta de la autoevaluación, sin texto.
 *
 * El enunciado y las tres opciones viven en `messages/*.json` bajo
 * `OverviewMaturity.q.<id>`: el cuestionario lo arma el servidor y lo manda en
 * el payload, y el servidor no sabe en qué idioma está mirando el usuario. La
 * UI traduce a partir del `id` y del `level` de cada opción.
 */
export interface MaturityAssessmentQuestion {
  id: string;
  domainKey: string;
  options: Array<{
    score: number;
    /** Nivel Crawl-Walk-Run de esta opción; da la etiqueta y ordena el listado. */
    level: MaturityStage;
  }>;
}

export interface MaturityPayload {
  success: boolean;
  summary: MaturitySummary;
  tenantName: string;
  tier: string;
  assessmentQuestions?: MaturityAssessmentQuestion[];
  lastAssessed?: string;
  source: 'live' | 'mock';
  error?: string;
}
