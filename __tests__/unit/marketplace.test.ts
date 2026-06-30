import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  azurePlanToTier,
  awsDimensionToTier,
  tierToAzurePlanId,
} from '@/lib/marketplace/planMapping';
import { _internal } from '@/lib/marketplace/aws';

const { buildStringToSign, isAmazonCertHost } = _internal();

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

  it('maps AWS dimensions to tiers (both full and short forms)', () => {
    expect(awsDimensionToTier('finops-professional-monthly')).toBe('Professional');
    expect(awsDimensionToTier('finops-business-monthly')).toBe('Business');
    expect(awsDimensionToTier('professional')).toBe('Professional');
    expect(awsDimensionToTier('enterprise')).toBe('Enterprise');
  });

  it('infers AWS tier from arbitrary dimension names', () => {
    expect(awsDimensionToTier('enterprise_yearly_v2')).toBe('Enterprise');
    expect(awsDimensionToTier('biz-monthly')).toBe('Essential');
    expect(awsDimensionToTier('business-yearly')).toBe('Business');
  });

  it('round-trips Azure tier → plan ID', () => {
    expect(tierToAzurePlanId('Professional')).toBe('professional-monthly');
    expect(tierToAzurePlanId('Business', 'annual')).toBe('business-annual');
    expect(azurePlanToTier(tierToAzurePlanId('Enterprise'))).toBe('Enterprise');
  });
});

describe('SNS signature helpers', () => {
  it('accepts valid Amazon SNS cert hosts only over HTTPS', () => {
    expect(isAmazonCertHost('https://sns.us-east-1.amazonaws.com/foo.pem')).toBe(true);
    expect(isAmazonCertHost('https://sns.eu-west-1.amazonaws.com/cert.pem')).toBe(true);
    expect(isAmazonCertHost('http://sns.us-east-1.amazonaws.com/x')).toBe(false);
    expect(isAmazonCertHost('https://evil.com/sns.us-east-1.amazonaws.com')).toBe(false);
    expect(isAmazonCertHost('https://example.com/cert')).toBe(false);
    expect(isAmazonCertHost('not a url')).toBe(false);
  });

  it('builds canonical string-to-sign for Notification with fields in spec order', () => {
    const s = buildStringToSign({
      Type: 'Notification',
      MessageId: 'mid',
      TopicArn: 'arn:aws:sns:us-east-1:123:topic',
      Subject: 'Subj',
      Message: 'hello',
      Timestamp: '2026-01-01T00:00:00Z',
      SignatureVersion: '1',
      Signature: 'x',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
    });
    expect(s).toBe(
      'Message\nhello\nMessageId\nmid\nSubject\nSubj\nTimestamp\n2026-01-01T00:00:00Z\nTopicArn\narn:aws:sns:us-east-1:123:topic\nType\nNotification\n'
    );
  });

  it('omits Subject when not present in Notification string-to-sign', () => {
    const s = buildStringToSign({
      Type: 'Notification',
      MessageId: 'mid',
      TopicArn: 'arn',
      Message: 'hello',
      Timestamp: 'ts',
      SignatureVersion: '1',
      Signature: 'x',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
    });
    expect(s).not.toContain('Subject');
    expect(s).toContain('Message\nhello');
  });

  it('uses SubscribeURL field for SubscriptionConfirmation', () => {
    const s = buildStringToSign({
      Type: 'SubscriptionConfirmation',
      MessageId: 'mid',
      TopicArn: 'arn',
      Message: 'confirm me',
      Timestamp: 'ts',
      Token: 'tok',
      SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription',
      SignatureVersion: '1',
      Signature: 'x',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
    });
    expect(s).toContain('SubscribeURL');
    expect(s).toContain('Token\ntok');
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
