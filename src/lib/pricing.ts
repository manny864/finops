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
  Professional: 299.99,
  Business: 999.99,
  Enterprise: null, // a convenir
};

/**
 * Precio ANUAL total, tal como lo cobra Paddle. No es `mensual × 12 × algo`:
 * es el número que está cargado en la oferta, y es el que se le cobra.
 *
 * Se guarda el total y no el equivalente mensual porque el total es el dato
 * primario —el que factura Paddle— y el mensual se deriva exacto dividiendo
 * por 12. Al revés no cierra: `PricingPage` calculaba `mensual × 0.88` y
 * acertaba sólo porque el redondeo a dos decimales coincidía. Cualquier cambio
 * del descuento en Paddle rompía esa coincidencia sin que nada avisara.
 */
export const TIER_ANNUAL_PRICE_USD: Record<string, number | null> = {
  Professional: 3167.88,
  Business: 10559.88,
  Enterprise: null,
};

/** Equivalente mensual del plan anual, para mostrar junto al precio mensual. */
export function getAnnualMonthlyEquivalent(tier: string): number | null {
  const anual = TIER_ANNUAL_PRICE_USD[tier];
  return anual == null ? null : Number((anual / 12).toFixed(2));
}

/**
 * El descuento anual, derivado de los dos precios en vez de escrito a mano.
 *
 * Estaba en tres lugares a la vez: el `0.88` de `PricingPage`, la clave
 * `save12` en los tres idiomas, y la oferta de Paddle. Tres lugares para un
 * número que sólo Paddle decide.
 */
export function getAnnualDiscountPercent(tier: string): number | null {
  const mensual = TIER_BASE_PRICE_USD[tier];
  const anual = TIER_ANNUAL_PRICE_USD[tier];
  if (mensual == null || anual == null) return null;
  return Math.round((1 - anual / (mensual * 12)) * 100);
}

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
// `extraUser` se elimino el 2026-09-12: declaraba $30/$25 POR USUARIO mientras
// el marketplace vende y cobra bloques de +5 asientos a $35 (= $7 por usuario),
// cuatro veces mas barato. No lo renderizaba ninguna pantalla, pero era un
// numero listo para que un upsell prometiera un precio inexistente. El precio
// de los asientos vive en ADDON_CATALOG.quota_user_seats y lo pisa Paddle.
export const ADDON_PRICE_USD: Record<string, Record<string, number | null>> = {
  extraSubscription: { Professional: 50, Business: 40, Enterprise: null },
  extraTenant:       { Professional: 90, Business: 240, Enterprise: null },
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
