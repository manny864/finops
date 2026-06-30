import crypto from 'crypto';
import bcryptjs from 'bcryptjs';

const ALGORITHM = 'aes-256-gcm';
const SALT_ROUNDS = 10;

/**
 * Encrypts a TOTP secret using AES-256-GCM
 * Key must be 32 bytes (64 hex chars)
 */
export function encryptSecret(secret: string): { ciphertext: string; iv: string; authTag: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(secret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

/**
 * Decrypts a TOTP secret using AES-256-GCM
 */
export function decryptSecret(ciphertext: string, iv: string, authTag: string): string {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generates 10 recovery codes (10 chars alphanum each)
 * Returns: { plaintext: string[] (show to user once), hashes: string[] (store in DB) }
 */
export async function generateRecoveryCodes(): Promise<{ plaintext: string[]; hashes: string[] }> {
  const plaintext: string[] = [];
  const hashes: string[] = [];

  for (let i = 0; i < 10; i++) {
    const code = crypto.randomBytes(6).toString('hex').substring(0, 10).toUpperCase();
    plaintext.push(code);
    const hash = await bcryptjs.hash(code, SALT_ROUNDS);
    hashes.push(hash);
  }

  return { plaintext, hashes };
}

/**
 * Verifies a recovery code against stored hashes
 * Returns: { valid: boolean, remaining: string[] (hashes with used code removed) }
 */
export async function verifyRecoveryCode(code: string, hashes: string[]): Promise<{ valid: boolean; remaining: string[] }> {
  for (let i = 0; i < hashes.length; i++) {
    const valid = await bcryptjs.compare(code, hashes[i]);
    if (valid) {
      // Remove used code and return remaining
      const remaining = hashes.filter((_, idx) => idx !== i);
      return { valid: true, remaining };
    }
  }
  return { valid: false, remaining: hashes };
}

/**
 * Hashes a payload for challenge verification
 */
export function hashPayload(payload: any): string {
  const json = JSON.stringify(payload);
  return crypto.createHash('sha256').update(json).digest('hex');
}

/**
 * Gets encryption key from env variable
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.MFA_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    console.warn('MFA_ENCRYPTION_KEY not set or invalid (must be 64 hex chars). 2FA will be unavailable.');
    throw new Error('MFA_ENCRYPTION_KEY not configured');
  }
  return Buffer.from(keyHex, 'hex');
}
