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

/**
 * Extrae el token de aterrizaje del query string, tolerando que venga repetido.
 *
 * POR QUÉ HACE FALTA
 * En la configuración técnica de Partner Center se puede cargar la landing page
 * con un placeholder --`?token={token}`-- y Microsoft AGREGA el token real al
 * final. La URL llega entonces con dos parámetros `token`, y Next.js devuelve
 * un array en ese caso. Leerlo directo pasaba el array al header
 * `x-ms-marketplace-token` como `{token},eyJ0...`, y el resolve fallaba con un
 * token inválido: un error confuso, en el primer paso de la compra, cuyo origen
 * está en un campo de un formulario web.
 *
 * Se descartan los placeholders sin resolver y se toma el ÚLTIMO valor que
 * queda, que es el que agrega Microsoft.
 */
export function pickMarketplaceToken(raw: string | string[] | undefined): string | undefined {
  if (!raw) return undefined;
  const candidatos = (Array.isArray(raw) ? raw : [raw])
    .map((v) => v.trim())
    // `{token}`, `{{token}}` y variantes: un placeholder que nadie reemplazó.
    .filter((v) => v.length > 0 && !/^\{+\s*token\s*\}+$/i.test(v));
  return candidatos.length > 0 ? candidatos[candidatos.length - 1] : undefined;
}
