import { NextResponse } from "next/server";
import { getPlanPrices } from "@/services/paddlePrices.service";
import { TIER_BASE_PRICE_USD, TIER_ANNUAL_PRICE_USD } from "@/lib/pricing";

/**
 * GET /api/pricing/plans — precios de lista de los planes.
 *
 * Pública y sin auth a propósito: la sirve `/upgrade`, que un visitante ve
 * antes de loguearse. No expone nada que no esté ya en el checkout de Paddle,
 * al que cualquiera llega desde la misma página.
 *
 * Siempre responde con precios. Si Paddle no contesta, devuelve el catálogo de
 * `pricing.ts` y lo dice en `source`: una página de precios en blanco es peor
 * que una con un número de hace un rato, y el campo permite notar la
 * degradación en vez de que pase inadvertida.
 */
export async function GET() {
    const desdePaddle = await getPlanPrices();

    // Relleno por tier y por campo, no todo-o-nada: si Paddle devolvió el
    // mensual y falló el anual, se conserva el mensual real.
    const plans: Record<string, { monthly: number | null; annual: number | null; currency: string }> = {};
    for (const tier of ["Professional", "Business"]) {
        const p = desdePaddle.plans[tier];
        plans[tier] = {
            monthly: p?.monthly ?? TIER_BASE_PRICE_USD[tier] ?? null,
            annual: p?.annual ?? TIER_ANNUAL_PRICE_USD[tier] ?? null,
            currency: p?.currency ?? "USD",
        };
    }

    return NextResponse.json(
        { success: true, source: desdePaddle.source, plans },
        // El servicio ya cachea una hora en memoria; esto evita además que cada
        // instancia repita la llamada para visitas simultáneas.
        { headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=3600" } }
    );
}
