/**
 * Paddle Price ID to Tier mapping
 * Handles bidirectional conversion between Paddle price IDs and internal tier names
 */

export type TierName = 'Professional' | 'Business' | 'Enterprise';
export type BillingFrequency = 'monthly' | 'yearly';

export function priceIdToTier(priceId: string): TierName | null {
  const map: Record<string, TierName> = {};
  const env = process.env;

  if (env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY)
    map[env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY] = 'Professional';
  if (env.NEXT_PUBLIC_PADDLE_PRO_YEARLY)
    map[env.NEXT_PUBLIC_PADDLE_PRO_YEARLY] = 'Professional';
  if (env.NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY)
    map[env.NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY] = 'Business';
  if (env.NEXT_PUBLIC_PADDLE_BUSINESS_YEARLY)
    map[env.NEXT_PUBLIC_PADDLE_BUSINESS_YEARLY] = 'Business';

  return map[priceId] ?? null;
}

export function tierToPriceId(tier: TierName, billing: BillingFrequency): string | null {
  if (tier === 'Enterprise') {
    return null; // Enterprise doesn't use standard pricing
  }

  const key =
    tier === 'Professional'
      ? billing === 'yearly'
        ? 'NEXT_PUBLIC_PADDLE_PRO_YEARLY'
        : 'NEXT_PUBLIC_PADDLE_PRO_MONTHLY'
      : tier === 'Business'
        ? billing === 'yearly'
          ? 'NEXT_PUBLIC_PADDLE_BUSINESS_YEARLY'
          : 'NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY'
        : null;

  if (!key) return null;
  const priceId = process.env[key];
  return priceId ?? null;
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
