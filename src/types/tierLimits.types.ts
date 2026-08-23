/**
 * Tipos TypeScript para el sistema de validación transversal de límites y cuotas por Tier SaaS.
 */

export type SaaSPlanTier = "Professional" | "Business" | "Enterprise";

export type RestrictedFeatureKey =
  | "CSP_MARKUP"
  | "FOCUS_EXPORT"
  | "POWERBI_TEMPLATES"
  | "UNLIMITED_SUBS"
  | "ZOMBIE_REMEDIATION"
  | "TAG_REMEDIATION"
  | "ADVANCED_AI"
  | "PRIORITY_SUPPORT";

export interface TierLimitStatus {
  tenantId: string;
  planTier: SaaSPlanTier;
  maxAllowedSubscriptions: number; // 2 for Pro, 3 for Business, 9999 for Enterprise
  currentSubscriptionsCount: number;
  isSubscriptionLimitReached: boolean;
  canAddMoreSubscriptions: boolean;
  allowedFeatures: RestrictedFeatureKey[];
  subscriptionQuotaPercentage: number;
  upgradeTargetTier?: SaaSPlanTier;
  upgradeUrl: string;
}

export type TierErrorCode =
  | "TIER_SUBSCRIPTION_LIMIT_REACHED"
  | "FEATURE_NOT_INCLUDED_IN_TIER";

export interface TierQuotaExceededError {
  errorCode: TierErrorCode;
  currentTier: SaaSPlanTier;
  message: string;
  maxAllowed?: number;
  currentCount?: number;
  requiredFeature?: RestrictedFeatureKey;
  upgradeTargetTier: SaaSPlanTier;
  upgradeUrl: string;
}

export interface UpgradeModalConfig {
  title?: string;
  description?: string;
  reason?: "SUBSCRIPTION_QUOTA" | "RESTRICTED_FEATURE";
  featureKey?: RestrictedFeatureKey;
  targetTier?: SaaSPlanTier;
  upgradeUrl?: string;
}
