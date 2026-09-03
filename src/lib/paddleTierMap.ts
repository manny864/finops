/**
 * Paddle Price ID to Tier mapping
 * Handles bidirectional conversion between Paddle price IDs and internal tier names
 */

export type TierName = 'Professional' | 'Business' | 'Enterprise';
export type BillingFrequency = 'monthly' | 'yearly';

/**
 * Los price IDs se leen con acceso ESTÁTICO a `process.env`, y dentro de las
 * funciones.
 *
 * Next.js sustituye `process.env.NEXT_PUBLIC_X` por su valor en tiempo de build,
 * pero SÓLO cuando la referencia es literal. `process.env[variable]` con clave
 * dinámica, o `const env = process.env; env.X`, no se inlinean: en el servidor
 * terminan leyendo el env de runtime del Container App, donde estas cuatro
 * variables NO existen. Viven como variables de repositorio de GitHub y entran
 * como build args (ver `.github/workflows/deploy-azure.yml` y el `Dockerfile`).
 *
 * Ese era el bug: `tierToPriceId()` usaba la forma dinámica y devolvía `null`
 * en producción, así que `/api/pricing/plans` respondía `source: "catalog"` en
 * vez de leer el precio de Paddle, y las rutas de checkout y de cambio de plan
 * se quedaban sin price ID. En el cliente funcionaba, porque ahí el acceso sí
 * era estático — de ahí que el checkout de la web anduviera y lo del servidor no.
 *
 * Van DENTRO de las funciones y no en un objeto a nivel de módulo: la
 * sustitución de build es textual y funciona igual en los dos lugares, pero un
 * objeto de módulo congela el valor al importar, y los tests configuran estas
 * variables por `process.env` antes de llamar.
 */
export function priceIdToTier(priceId: string): TierName | null {
  if (!priceId) return null;
  if (priceId === process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY) return 'Professional';
  if (priceId === process.env.NEXT_PUBLIC_PADDLE_PRO_YEARLY) return 'Professional';
  if (priceId === process.env.NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY) return 'Business';
  if (priceId === process.env.NEXT_PUBLIC_PADDLE_BUSINESS_YEARLY) return 'Business';
  return null;
}

export function tierToPriceId(
  tier: TierName,
  billing: BillingFrequency
): string | null {
  if (tier === 'Professional') {
    return (
      (billing === 'yearly'
        ? process.env.NEXT_PUBLIC_PADDLE_PRO_YEARLY
        : process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY) ?? null
    );
  }
  if (tier === 'Business') {
    return (
      (billing === 'yearly'
        ? process.env.NEXT_PUBLIC_PADDLE_BUSINESS_YEARLY
        : process.env.NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY) ?? null
    );
  }
  return null; // Enterprise doesn't use standard pricing
}

export function getPaddleEnvironment(): 'sandbox' | 'production' {
  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) return 'sandbox';
  return apiKey.startsWith('pdl_sdbx_') ? 'sandbox' : 'production';
}

export function getPaddleBaseUrl(): string {
  const env = getPaddleEnvironment();
  return env === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
}
