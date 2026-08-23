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
  /** Score derivado de telemetría de Azure, cuando la autoevaluación lo sustituye. */
  telemetryScore?: number;
  /** De dónde sale `score`: respuesta del equipo o telemetría. */
  scoreSource?: 'self_assessment' | 'telemetry';
}

export interface MaturityMilestone {
  dimensionKey: string;
  fromStage: string;
  toStage: string;
  title: string;
  description: string;
  actionType: string;
  estimatedEffort?: 'Bajo' | 'Medio' | 'Alto';
  impactScore?: number;
  commandPayload?: string;
}

export interface MaturitySummary {
  overallScore: number;
  overallStage: MaturityStage;
  dimensions: MaturityDimension[];
  nextMilestones: MaturityMilestone[];
}

export interface MaturityAssessmentQuestion {
  id: string;
  domainKey: string;
  title: string;
  description: string;
  options: Array<{
    score: number;
    label: string;
    description: string;
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
