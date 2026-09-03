import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  azurePlanToBillingCycle,
  azurePlanToTier,
  pickMarketplaceToken,
  tierToAzurePlanId,
} from '@/lib/marketplace/planMapping';

describe('marketplace plan mapping', () => {
  it('maps known Azure plan IDs to canonical tiers', () => {
    expect(azurePlanToTier('professional-monthly')).toBe('Professional');
    expect(azurePlanToTier('business-annual')).toBe('Business');
    expect(azurePlanToTier('enterprise-monthly')).toBe('Enterprise');
  });

  it('handles unknown Azure plan IDs via keyword inference', () => {
    expect(azurePlanToTier('custom-enterprise-3y')).toBe('Enterprise');
    expect(azurePlanToTier('pro-trial')).toBe('Professional');
    expect(azurePlanToTier('totally-unknown')).toBe('Professional');
  });

  it('handles null/empty azure plan defaulting to Professional (discontinued tier floor)', () => {
    expect(azurePlanToTier(null)).toBe('Professional');
    expect(azurePlanToTier(undefined)).toBe('Professional');
    expect(azurePlanToTier('')).toBe('Professional');
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

describe('azurePlanToBillingCycle', () => {
  it('reconoce los planes anuales de la tabla explícita', () => {
    expect(azurePlanToBillingCycle('professional-annual')).toBe('ANNUAL');
    expect(azurePlanToBillingCycle('business-annual')).toBe('ANNUAL');
    expect(azurePlanToBillingCycle('enterprise-annual')).toBe('ANNUAL');
  });

  // El nombre del plan lo escribe una persona en Partner Center y "yearly" es
  // igual de natural que "annual". Sin esto, un plan anual mal nombrado se
  // facturaba como mensual sin ningún error.
  it('acepta también "yearly"', () => {
    expect(azurePlanToBillingCycle('business-yearly')).toBe('ANNUAL');
    expect(azurePlanToBillingCycle('Professional-Yearly')).toBe('ANNUAL');
  });

  it('todo lo demás es mensual, incluido lo ausente', () => {
    expect(azurePlanToBillingCycle('business-monthly')).toBe('MONTHLY');
    expect(azurePlanToBillingCycle('plan-raro')).toBe('MONTHLY');
    expect(azurePlanToBillingCycle(null)).toBe('MONTHLY');
    expect(azurePlanToBillingCycle(undefined)).toBe('MONTHLY');
  });
});

/**
 * El caso que motiva esto: en Partner Center la landing URL se puede cargar con
 * `?token={token}`, y Microsoft AGREGA el token real. Llegan dos parámetros
 * `token` y Next.js devuelve un array; leerlo directo mandaba `{token},eyJ0...`
 * al header del resolve y la compra fallaba en su primer paso por un placeholder
 * escrito en un formulario web.
 */
describe('pickMarketplaceToken', () => {
  it('toma el token cuando viene solo', () => {
    expect(pickMarketplaceToken('eyJ0eXAiOiJKV1Qi')).toBe('eyJ0eXAiOiJKV1Qi');
  });

  it('descarta el placeholder y toma el token real', () => {
    expect(pickMarketplaceToken(['{token}', 'eyJ0eXAiOiJKV1Qi'])).toBe('eyJ0eXAiOiJKV1Qi');
    expect(pickMarketplaceToken(['{{token}}', 'eyJ0eXAiOiJKV1Qi'])).toBe('eyJ0eXAiOiJKV1Qi');
    expect(pickMarketplaceToken(['{ token }', 'eyJ0eXAiOiJKV1Qi'])).toBe('eyJ0eXAiOiJKV1Qi');
  });

  it('toma el último si llegan varios reales', () => {
    expect(pickMarketplaceToken(['viejo', 'nuevo'])).toBe('nuevo');
  });

  it('devuelve undefined cuando no hay nada usable', () => {
    expect(pickMarketplaceToken(undefined)).toBeUndefined();
    expect(pickMarketplaceToken('')).toBeUndefined();
    expect(pickMarketplaceToken('   ')).toBeUndefined();
    expect(pickMarketplaceToken('{token}')).toBeUndefined();
    expect(pickMarketplaceToken(['{token}'])).toBeUndefined();
    expect(pickMarketplaceToken([])).toBeUndefined();
  });
});


