import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  azurePlanToTier,
  tierToAzurePlanId,
} from '@/lib/marketplace/planMapping';

describe('marketplace plan mapping', () => {
  it('maps known Azure plan IDs to canonical tiers', () => {
    expect(azurePlanToTier('essential-monthly')).toBe('Essential');
    expect(azurePlanToTier('professional-monthly')).toBe('Professional');
    expect(azurePlanToTier('business-annual')).toBe('Business');
    expect(azurePlanToTier('enterprise-monthly')).toBe('Enterprise');
  });

  it('handles unknown Azure plan IDs via keyword inference', () => {
    expect(azurePlanToTier('custom-enterprise-3y')).toBe('Enterprise');
    expect(azurePlanToTier('pro-trial')).toBe('Professional');
    expect(azurePlanToTier('totally-unknown')).toBe('Essential');
  });

  it('handles null/empty azure plan defaulting to Essential', () => {
    expect(azurePlanToTier(null)).toBe('Essential');
    expect(azurePlanToTier(undefined)).toBe('Essential');
    expect(azurePlanToTier('')).toBe('Essential');
  });

  it('round-trips Azure tier → plan ID', () => {
    expect(tierToAzurePlanId('Professional')).toBe('professional-monthly');
    expect(tierToAzurePlanId('Business', 'annual')).toBe('business-annual');
    expect(azurePlanToTier(tierToAzurePlanId('Enterprise'))).toBe('Enterprise');
  });
});

describe('verifyWebhookJwt (Azure)', () => {
  beforeAll(() => {
    process.env.MARKETPLACE_SKIP_VERIFY = 'true';
  });
  afterEach(() => {
    process.env.MARKETPLACE_SKIP_VERIFY = 'true';
  });

  it('decodes the JWT payload in skip-verify mode', async () => {
    const { verifyWebhookJwt } = await import('@/lib/marketplace/azure');
    const payloadB64 = Buffer.from(JSON.stringify({ aud: 'app-id', sub: 'svc' })).toString(
      'base64url'
    );
    const fake = `eyJhbGciOiJSUzI1NiJ9.${payloadB64}.signature`;
    const payload = await verifyWebhookJwt(`Bearer ${fake}`);
    expect(payload.aud).toBe('app-id');
    expect(payload.sub).toBe('svc');
  });

  it('rejects missing or malformed Authorization header', async () => {
    const { verifyWebhookJwt } = await import('@/lib/marketplace/azure');
    await expect(verifyWebhookJwt(null)).rejects.toThrow();
    await expect(verifyWebhookJwt('Basic abcd')).rejects.toThrow();
    await expect(verifyWebhookJwt('Bearer ')).rejects.toThrow();
  });

  it('decodes payload with audience and issuer claims in skip-verify mode', async () => {
    const { verifyWebhookJwt } = await import('@/lib/marketplace/azure');
    const payloadB64 = Buffer.from(
      JSON.stringify({ aud: 'app-id', iss: 'https://login.microsoftonline.com/tid/v2.0', exp: 9999999999 })
    ).toString('base64url');
    const fake = `eyJhbGciOiJSUzI1NiJ9.${payloadB64}.signature`;
    const payload = await verifyWebhookJwt(`Bearer ${fake}`);
    expect(payload.iss).toContain('login.microsoftonline.com');
    expect(payload.exp).toBe(9999999999);
  });
});
