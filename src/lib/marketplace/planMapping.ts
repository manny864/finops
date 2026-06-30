export type TierName = 'Essential' | 'Professional' | 'Business' | 'Enterprise';

const AZURE_PLAN_TO_TIER: Record<string, TierName> = {
  'essential-monthly': 'Essential',
  'essential-annual': 'Essential',
  'professional-monthly': 'Professional',
  'professional-annual': 'Professional',
  'business-monthly': 'Business',
  'business-annual': 'Business',
  'enterprise-monthly': 'Enterprise',
  'enterprise-annual': 'Enterprise',
};

const AWS_DIMENSION_TO_TIER: Record<string, TierName> = {
  'finops-essential-monthly': 'Essential',
  'finops-professional-monthly': 'Professional',
  'finops-business-monthly': 'Business',
  'finops-enterprise-monthly': 'Enterprise',
  essential: 'Essential',
  professional: 'Professional',
  business: 'Business',
  enterprise: 'Enterprise',
};

function inferTierByKeyword(value: string): TierName {
  if (value.includes('enterprise')) return 'Enterprise';
  if (value.includes('business')) return 'Business';
  if (value.includes('professional') || value.includes('pro')) return 'Professional';
  return 'Essential';
}

export function azurePlanToTier(planId: string | null | undefined): TierName {
  if (!planId) return 'Essential';
  const normalized = planId.toLowerCase().trim();
  return AZURE_PLAN_TO_TIER[normalized] ?? inferTierByKeyword(normalized);
}

export function awsDimensionToTier(dimension: string | null | undefined): TierName {
  if (!dimension) return 'Essential';
  const normalized = dimension.toLowerCase().trim();
  return AWS_DIMENSION_TO_TIER[normalized] ?? inferTierByKeyword(normalized);
}

export function tierToAzurePlanId(
  tier: TierName,
  billingCycle: 'monthly' | 'annual' = 'monthly'
): string {
  return `${tier.toLowerCase()}-${billingCycle}`;
}
