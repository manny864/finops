/**
 * Catálogo de precios de lista, en USD/mes.
 *
 * Los cobros los ejecuta Paddle y la verdad de lo facturado vive ahí; esto es
 * lo que la plataforma MUESTRA (página de planes, modales de límite, upsells).
 * Existe para que el número esté en UN lugar: antes el tope de suscripciones
 * estaba escrito a mano en ocho archivos y ya se había desincronizado —
 * `BillingPanel` le prometía 3 suscripciones a Professional, que tiene 2.
 *
 * Al cambiar un precio acá hay que cambiarlo también en Paddle: esto no cobra.
 */

export const TIER_BASE_PRICE_USD: Record<string, number | null> = {
  Professional: 299,
  Business: 999,
  Enterprise: null, // a convenir
};

/**
 * Add-ons. `null` = no se vende por unidad en ese tier.
 *
 * Los tenants extra se cobran como ~30% del plan base y no como monto plano:
 * un plano de $150 sería el 50% del plan para Professional y el 19% para
 * Business, o sea proporcionalmente el triple al cliente chico.
 *
 * Enterprise no lleva precio por unidad a propósito: ese contrato incluye
 * bloques y se negocia; una factura por unidad lo vuelve impredecible, que es
 * justo lo que ese comprador rechaza.
 */
export const ADDON_PRICE_USD: Record<string, Record<string, number | null>> = {
  extraSubscription: { Professional: 50, Business: 40, Enterprise: null },
  extraTenant:       { Professional: 90, Business: 240, Enterprise: null },
  extraUser:         { Professional: 30, Business: 25, Enterprise: null },
  extendedRetention: { Professional: 79, Business: 99, Enterprise: 0 }, // 36 meses; incluido en Enterprise
  prioritySupport:   { Professional: 149, Business: 249, Enterprise: 0 },
};

/**
 * La IA se cobra por consumo y no por tier: es lo único con costo marginal
 * real (ya se mide en `PlatformAiUsage`) y hoy se absorbe entero. El resto de
 * la plataforma es costo marginal cero, donde gatear por tier no cuesta nada.
 */
export const AI_INCLUDED_TOKENS_PER_MONTH = 100_000;
export const AI_PRICE_USD_PER_1K_TOKENS = 0.02;

export function getAddonPrice(addon: keyof typeof ADDON_PRICE_USD | string, tier: string): number | null {
  return ADDON_PRICE_USD[addon]?.[tier] ?? null;
}
