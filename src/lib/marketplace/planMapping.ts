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

/**
 * El ciclo de facturación que declara el plan de Partner Center.
 *
 * `azurePlanToTier()` devuelve sólo el tier y descarta el ciclo, así que una
 * compra anual quedaba indistinguible de una mensual: el panel de facturación
 * mostraba MONTHLY porque es el default del inicializador, no porque el dato
 * dijera eso.
 *
 * Acepta `yearly` además de `annual` porque el nombre del plan lo escribe una
 * persona en Partner Center y las dos formas son naturales en inglés. Ante
 * cualquier otra cosa devuelve MONTHLY, que es el ciclo por defecto de una
 * oferta SaaS.
 */
export function azurePlanToBillingCycle(planId: string | null | undefined): 'MONTHLY' | 'ANNUAL' {
  if (!planId) return 'MONTHLY';
  const normalized = planId.toLowerCase();
  return normalized.includes('annual') || normalized.includes('yearly') ? 'ANNUAL' : 'MONTHLY';
}
