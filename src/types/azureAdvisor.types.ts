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

export interface AdvisorApiResponse {
  success: boolean;
  overallScore: number;
  tenantName?: string;
  pillars: Record<AdvisorCategory, AdvisorPillarSummary>;
  recommendations: Record<AdvisorCategory, AdvisorRecommendation[]>;
  subscriptions: AdvisorSubscription[];
  suppressedCount: number;
  isMock?: boolean;
}
