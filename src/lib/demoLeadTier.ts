/** Tiers que puede mirar quien solicita una demo desde la página de precios. */
export const TIERS_DE_DEMO = ["Professional", "Business", "Enterprise"] as const;
export type TierDeDemo = (typeof TIERS_DE_DEMO)[number];

/** El tier llega del navegador: sólo pasa un valor del catálogo, cualquier otra cosa es `null`. */
export function tierDeDemo(valor: unknown): TierDeDemo | null {
    return TIERS_DE_DEMO.find((t) => t === valor) ?? null;
}
