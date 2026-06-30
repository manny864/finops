/**
 * AWS STS assume-role helper.
 *
 * Multi-tenant pattern: each tenant's AWS account has an IAM role with a trust
 * policy that allows our platform's IAM principal to AssumeRole, gated by an
 * `ExternalId` we generated and stored encrypted. This prevents the "confused
 * deputy" problem (another customer of our platform tricking us into accessing
 * their resources).
 *
 * Credentials returned by STS are temporary (max 1h by default). We cache them
 * in-memory per (roleArn, externalId) keyed entry until 5 minutes before expiry
 * so concurrent syncs don't AssumeRole on every call.
 */

import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { encryptSecret, decryptSecret } from '@/lib/mfaCrypto';
import crypto from 'crypto';

export interface AwsTempCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

interface CacheEntry {
  creds: AwsTempCredentials;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_BUFFER_MS = 5 * 60 * 1000; // expire 5min early

function cacheKey(roleArn: string, externalId: string): string {
  return `${roleArn}::${externalId}`;
}

/**
 * Returns temp AWS credentials by calling STS AssumeRole. Caches result.
 */
export async function assumeRole(
  roleArn: string,
  externalId: string,
  sessionName: string = 'FinOpsSaaS'
): Promise<AwsTempCredentials> {
  const key = cacheKey(roleArn, externalId);
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && cached.creds.expiration.getTime() - now > CACHE_BUFFER_MS) {
    return cached.creds;
  }

  const platformRegion = process.env.AWS_REGION || 'us-east-1';
  const client = new STSClient({
    region: platformRegion,
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined, // fall back to instance/task role
  });

  const cmd = new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: sessionName,
    ExternalId: externalId,
    DurationSeconds: 3600,
  });

  const out = await client.send(cmd);
  if (!out.Credentials || !out.Credentials.AccessKeyId || !out.Credentials.SecretAccessKey || !out.Credentials.SessionToken || !out.Credentials.Expiration) {
    throw new Error('STS AssumeRole returned incomplete credentials');
  }

  const creds: AwsTempCredentials = {
    accessKeyId: out.Credentials.AccessKeyId,
    secretAccessKey: out.Credentials.SecretAccessKey,
    sessionToken: out.Credentials.SessionToken,
    expiration: out.Credentials.Expiration,
  };

  cache.set(key, { creds, cachedAt: now });
  return creds;
}

/**
 * Generate a cryptographically random external ID (UUID v4 + entropy).
 * Stored encrypted in AwsAccounts.external_id_encrypted.
 */
export function generateExternalId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Encrypt an external ID for storage. JSON-encodes the AES-GCM blob.
 */
export function encryptExternalId(externalId: string): string {
  const blob = encryptSecret(externalId);
  return JSON.stringify(blob);
}

/**
 * Decrypt an external ID stored as JSON blob.
 */
export function decryptExternalId(encryptedJson: string): string {
  const blob = JSON.parse(encryptedJson) as { ciphertext: string; iv: string; authTag: string };
  return decryptSecret(blob.ciphertext, blob.iv, blob.authTag);
}

/**
 * Clear cache (for tests / forced re-auth).
 */
export function clearAssumeRoleCache(): void {
  cache.clear();
}
