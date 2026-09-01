export type AdvisorCategory =
  | 'Cost'
  | 'Security'
  | 'HighAvailability'
  | 'Performance'
  | 'OperationalExcellence';

export type AdvisorImpact = 'High' | 'Medium' | 'Low';

export interface AdvisorReservationOption {
  term: string;
  lookback: string;
  annualSavingsUSD: number;
  monthlySavingsUSD: number;
}

export type SnoozeDurationDays = 30 | 90;

/** Resultado de parsear un ARM Resource ID (`extractResourceDisplayName`). */
export interface ParsedArmResource {
  rawId: string;
  subscriptionId: string;
  resourceGroup: string;
  /** Tipo completo ARM: "Microsoft.Compute/virtualMachines". */
  resourceType: string;
  resourceName: string;
}

export type AdvisorAiActionType =
  | 'RIGHTSIZE'
  | 'DELETE_ZOMBIE'
  | 'ENABLE_HA'
  | 'PURGE_STORAGE'
  | 'UPDATE_TAGS'
  | 'PURCHASE_RESERVATION'
  | 'APPLY_AHUB'
  | 'REVIEW';

/**
 * Accion concreta sintetizada a partir del payload crudo de Advisor
 * (`extendedProperties`, tipo de recurso e impacto). Deterministica a proposito:
 * ver `generateAdvisorRemediationAction` en advisorRemediation.ts.
 */
export interface AdvisorSuggestedAction {
  actionTitle: string;
  actionDescription: string;
  actionType: AdvisorAiActionType;
  targetSku?: string;
  estimatedMonthlySavingsUSD: number;
  /** Rama determinista tomada (MEJ-06): identifica que plantilla de texto se
   *  uso, para cachear la reescritura de IA por regla y no por recomendacion
   *  ni por recurso. Ver advisorRemediationNarration.ts. */
  ruleKey?: string;
  /** `actionDescription` ANTES de interpolar {name}/{skuText}/{cpuText}. Es lo
   *  unico que se manda a reescribir con IA -- nunca los valores concretos
   *  del recurso -- para poder compartir la cache entre recomendaciones y
   *  tenants sin mezclar datos de un recurso con el texto de otro. */
  descriptionTemplate?: string;
  descriptionVars?: Record<string, string>;
}

export interface AdvisorRecommendation {
  id: string;
  name: string;
  category: AdvisorCategory;
  impact: AdvisorImpact;
  resourceId: string;
  resourceName: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  serviceName?: string;
  titleTranslated: string;
  descriptionTranslated: string;
  monthlySavingsUSD: number;
  annualSavingsUSD: number;
  reservationOptions?: AdvisorReservationOption[];
  selectedTerm?: string;
  actionType: string;
  remediationCommand?: string;
  powerShellCommand?: string;
  extendedProperties?: Record<string, any>;
  lastRefreshed?: string;
  status?: 'active' | 'postponed' | 'dismissed' | 'completed';
  /** Clave estable de deduplicacion: typeId + recurso + categoria. */
  dedupKey?: string;
  /** Nombre de categoria/impacto ya localizado (no re-traducir en la UI). */
  categoryDisplayName?: string;
  impactDisplayName?: string;
  /** ARM Resource ID completo parseado; el crudo solo se muestra en tooltip. */
  resource?: ParsedArmResource;
  aiSuggestedAction?: AdvisorSuggestedAction;
  isSnoozed?: boolean;
  snoozedUntilIso?: string;
  carbonReductionKg?: number;
  completionProgress?: number;
  activeResources?: number;
}

export interface AdvisorPillarSummary {
  category: string;
  recommendationsCount: number;
  scorePercentage: number;
  totalSavingsUSD: number;
  totalMonthlySavingsUSD?: number;
  highImpactCount: number;
  mediumImpactCount: number;
  lowImpactCount: number;
  activeResourcesCount?: number;
}

export interface AdvisorRemediationAction {
  recommendationId: string;
  resourceId: string;
  actionType: 'PURCHASE_RESERVATION' | 'APPLY_AHUB' | 'RESIZE' | 'SNOOZE' | 'DISMISS';
  payload?: any;
}

export interface AdvisorSubscription {
  id: string;
  name: string;
}

export interface SnoozeRecommendationPayload {
  tenantId: string;
  recommendationId: string;
  resourceId?: string;
  snoozeDurationDays: SnoozeDurationDays;
}

export interface SnoozeRecommendationResponse {
  success: boolean;
  recommendationId: string;
  snoozedUntilIso: string | null;
  message: string;
}

export interface AdvisorApiResponse {
  success: boolean;
  overallScore: number;
  /** Nombre comercial de la organizacion (nunca el GUID del tenant). */
  tenantName?: string;
  /** GUID de Entra ID, para el micro-badge con copiado. */
  tenantGuid?: string;
  snoozedRecommendationsCount?: number;
  pillars: Record<AdvisorCategory, AdvisorPillarSummary>;
  recommendations: Record<AdvisorCategory, AdvisorRecommendation[]>;
  subscriptions: AdvisorSubscription[];
  suppressedCount: number;
  isMock?: boolean;
}
