/**
 * Paddle Price ID to Tier mapping
 * Handles bidirectional conversion between Paddle price IDs and internal tier names
 */
import { getPublicRuntimeConfig } from "./publicRuntimeConfig";

export type TierName = 'Professional' | 'Business' | 'Enterprise';
export type BillingFrequency = 'monthly' | 'yearly';

// Server callers read the same runtime values that the layout projects to the browser.
export function priceIdToTier(priceId: string): TierName | null {
  if (!priceId) return null;
  const config = getPublicRuntimeConfig();
  if (priceId === config.paddleProMonthly || priceId === config.paddleProYearly) return 'Professional';
  if (priceId === config.paddleBusinessMonthly || priceId === config.paddleBusinessYearly) return 'Business';
  return null;
}

export function tierToPriceId(
  tier: TierName,
  billing: BillingFrequency
): string | null {
  const config = getPublicRuntimeConfig();
  if (tier === 'Professional') {
    return (
      (billing === 'yearly'
        ? config.paddleProYearly
        : config.paddleProMonthly) || null
    );
  }
  if (tier === 'Business') {
    return (
      (billing === 'yearly'
        ? config.paddleBusinessYearly
        : config.paddleBusinessMonthly) || null
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
