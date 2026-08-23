/**
 * Tipos y contratos TypeScript para Analítica del Embudo de Inscripción (SuperAdmin).
 */

export type FunnelStepKey =
    | "TRIAL_STARTED"
    | "AZURE_LINKED"
    | "ONBOARDING_COMPLETED"
    | "CONVERTED";

export interface FunnelStepMetric {
    stepKey: FunnelStepKey;
    stepDisplayName: string;
    count: number;
    percentage: number;
}

export interface SignupFunnelMetrics {
    totalSignups30d: number;
    activeTrials: number;
    convertedCount: number;
    conversionRatePercent: number;
    churnRatePercent: number;
    funnelSteps: FunnelStepMetric[];
}

export type SaaSPlanTier = "Professional" | "Business" | "Enterprise";

export type SignupStatus = "ACTIVE" | "EXPIRED" | "CONVERTED";

export interface RecentSignupItem {
    id: string;
    userEmail: string;
    tenantId: string;
    planTier: SaaSPlanTier;
    status: SignupStatus;
    trialDaysRemaining: number;
    signedUpAtIso: string;
    formattedDate: string;
}

export interface FunnelFilters {
    status?: string;
    plan?: string;
    searchEmail?: string;
}

export interface SignupFunnelResponse {
    metrics: SignupFunnelMetrics;
    recentSignups: RecentSignupItem[];
    totalCount: number;
}
