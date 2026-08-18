import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  generateRecoveryCodes,
  verifyRecoveryCode,
  hashPayload,
} from '@/lib/mfaCrypto';
import { generateSecret, verifyToken } from '@/lib/mfa';

describe('MFA Crypto', () => {
  beforeEach(() => {
    // Set encryption key for tests
    process.env.MFA_ENCRYPTION_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
  });

  describe('AES-256-GCM Encryption', () => {
    it('should encrypt and decrypt a secret', () => {
      const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
      const encrypted = encryptSecret(secret);

      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();

      const decrypted = decryptSecret(encrypted.ciphertext, encrypted.iv, encrypted.authTag);
      expect(decrypted).toBe(secret);
    });

    it('should produce different ciphertexts for same secret', () => {
      const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
      const encrypted1 = encryptSecret(secret);
      const encrypted2 = encryptSecret(secret);

      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    });

    it('should fail with wrong key', () => {
      const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
      const encrypted = encryptSecret(secret);

      // Temporarily change key
      process.env.MFA_ENCRYPTION_KEY = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

      expect(() => {
        decryptSecret(encrypted.ciphertext, encrypted.iv, encrypted.authTag);
      }).toThrow();
    });
  });

  describe('Recovery Codes', () => {
    it('should generate 10 recovery codes', async () => {
      const { plaintext, hashes } = await generateRecoveryCodes();

      expect(plaintext).toHaveLength(10);
      expect(hashes).toHaveLength(10);
    });

    it('recovery codes should be 10 chars alphanumeric', async () => {
      const { plaintext } = await generateRecoveryCodes();

      plaintext.forEach((code) => {
        expect(code).toMatch(/^[A-Z0-9]{10}$/);
      });
    });

    it('all recovery codes should be unique', async () => {
      const { plaintext } = await generateRecoveryCodes();
      const unique = new Set(plaintext);

      expect(unique.size).toBe(10);
    });

    it('should verify valid recovery code', async () => {
      const { plaintext, hashes } = await generateRecoveryCodes();
      const codeToVerify = plaintext[0];

      const result = await verifyRecoveryCode(codeToVerify, hashes);

      expect(result.valid).toBe(true);
      expect(result.remaining).toHaveLength(9);
    });

    it('should reject invalid recovery code', async () => {
      const { hashes } = await generateRecoveryCodes();

      const result = await verifyRecoveryCode('INVALID1234', hashes);

      expect(result.valid).toBe(false);
      expect(result.remaining).toHaveLength(10);
    }, 15000);

    it('should mark used recovery code', async () => {
      const { plaintext, hashes } = await generateRecoveryCodes();
      const codeToVerify = plaintext[0];

      const result1 = await verifyRecoveryCode(codeToVerify, hashes);
      expect(result1.valid).toBe(true);

      // Try to verify same code again
      const result2 = await verifyRecoveryCode(codeToVerify, result1.remaining);
      expect(result2.valid).toBe(false);
    }, 15000);
  });

  describe('Payload Hashing', () => {
    it('should hash payload consistently', () => {
      const payload = { user_id: 123, action: 'delete_tenant' };
      const hash1 = hashPayload(payload);
      const hash2 = hashPayload(payload);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different hashes for different payloads', () => {
      const payload1 = { user_id: 123 };
      const payload2 = { user_id: 456 };

      const hash1 = hashPayload(payload1);
      const hash2 = hashPayload(payload2);

      expect(hash1).not.toBe(hash2);
    });
  });
});

describe('TOTP', () => {
  it('should generate secret with QR code', async () => {
    const { secret, otpauth_url, qrCodeDataUrl } = await generateSecret('user@example.com');

    expect(secret).toBeDefined();
    expect(secret.length).toBeGreaterThan(0);
    expect(otpauth_url).toContain('otpauth://totp/');
    expect(otpauth_url).toContain('user%40example.com'); // email is URL encoded
    expect(otpauth_url).toContain('FinOps%20SaaS');
    expect(qrCodeDataUrl).toContain('data:image/png;base64');
  });

  it('should have valid secret format', async () => {
    const { secret } = await generateSecret('user@example.com');
    // Secret should be valid base32
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  it('should handle invalid token gracefully', async () => {
    const testSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

    const result1 = await verifyToken(testSecret, '');
    expect(result1).toBe(false);

    const result2 = await verifyToken(testSecret, 'abc');
    expect(result2).toBe(false);

    const result3 = await verifyToken(testSecret, '0000000');
    expect(result3).toBe(false);
  });
});

