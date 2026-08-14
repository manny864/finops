export type TierName = 'Professional' | 'Business' | 'Enterprise';

const AZURE_PLAN_TO_TIER: Record<string, TierName> = {
  'professional-monthly': 'Professional',
  'professional-annual': 'Professional',
  'business-monthly': 'Business',
  'business-annual': 'Business',
  'enterprise-monthly': 'Enterprise',
  'enterprise-annual': 'Enterprise',
};

function inferTierByKeyword(value: string): TierName {
  if (value.includes('enterprise')) return 'Enterprise';
  if (value.includes('business')) return 'Business';
  return 'Professional';
}

export function azurePlanToTier(planId: string | null | undefined): TierName {
  if (!planId) return 'Professional';
  const normalized = planId.toLowerCase().trim();
  return AZURE_PLAN_TO_TIER[normalized] ?? inferTierByKeyword(normalized);
}

export function tierToAzurePlanId(
  tier: TierName,
  billingCycle: 'monthly' | 'annual' = 'monthly'
): string {
  return `${tier.toLowerCase()}-${billingCycle}`;
}
