import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { encryptSecret, decryptSecret, isEncrypted, hasEncryptionKey, reencryptSecret } from '@/lib/secretCrypto';

// Clave de test determinística (32 bytes / 64 hex). No es un secreto real.
const TEST_KEY = 'a'.repeat(64);

beforeAll(() => {
    process.env.APP_SECRET_ENCRYPTION_KEY = TEST_KEY;
});

afterEach(() => {
    process.env.APP_SECRET_ENCRYPTION_KEY = TEST_KEY;
    delete process.env.APP_SECRET_LEGACY_V1_KEY;
    delete process.env.MFA_ENCRYPTION_KEY;
    delete process.env.AZURE_KEYVAULT_CACHE_KEY;
});

describe('secretCrypto', () => {
    it('round-trips: decrypt(encrypt(x)) === x', () => {
        const plain = 'sk-proj-1234567890abcdefGHIJKLMNOP';
        const enc = encryptSecret(plain);
        expect(decryptSecret(enc)).toBe(plain);
    });

    it('produce el formato enc:v2:iv:tag:ciphertext', () => {
        const enc = encryptSecret('hello');
        expect(enc.startsWith('enc:v2:')).toBe(true);
        expect(enc.split(':')).toHaveLength(5); // enc, v1, iv, tag, ciphertext
        expect(isEncrypted(enc)).toBe(true);
    });

    it('usa IV aleatorio: dos cifrados del mismo texto difieren', () => {
        const a = encryptSecret('same-input');
        const b = encryptSecret('same-input');
        expect(a).not.toBe(b);
        expect(decryptSecret(a)).toBe('same-input');
        expect(decryptSecret(b)).toBe('same-input');
    });

    it('es idempotente: no recifra un valor ya cifrado', () => {
        const once = encryptSecret('key');
        const twice = encryptSecret(once);
        expect(twice).toBe(once);
    });

    it('retrocompat: decrypt de texto plano legacy lo devuelve tal cual', () => {
        expect(decryptSecret('plain-legacy-key')).toBe('plain-legacy-key');
        expect(isEncrypted('plain-legacy-key')).toBe(false);
    });

    it('maneja null/empty devolviendo string vacío', () => {
        expect(decryptSecret(null)).toBe('');
        expect(decryptSecret(undefined)).toBe('');
        expect(decryptSecret('')).toBe('');
    });

    it('fail-closed: authTag manipulado lanza (detección de tampering)', () => {
        const enc = encryptSecret('protected');
        // Corrompe el ciphertext (último char hex)
        const tampered = enc.slice(0, -1) + (enc.slice(-1) === '0' ? '1' : '0');
        expect(() => decryptSecret(tampered)).toThrow();
    });

    it('lanza si el valor cifrado está malformado', () => {
        expect(() => decryptSecret('enc:v1:onlyonepart')).toThrow(/Malformed/);
    });

    it('no cifra con claves MFA/cache o con una semilla publica', () => {
        delete process.env.APP_SECRET_ENCRYPTION_KEY;
        process.env.MFA_ENCRYPTION_KEY = TEST_KEY;
        process.env.AZURE_KEYVAULT_CACHE_KEY = TEST_KEY;
        expect(hasEncryptionKey()).toBe(false);
        expect(() => encryptSecret('must-not-be-stored')).toThrow(/APP_SECRET_ENCRYPTION_KEY/);
    });

    it.each(['short-passphrase', 'f'.repeat(63), '!'.repeat(44)])('rechaza clave nueva debil o malformada', (key) => {
        process.env.APP_SECRET_ENCRYPTION_KEY = key;
        expect(() => encryptSecret('secret')).toThrow(/32 bytes/);
    });

    it('lee v1 solo con clave legacy explicita y migra a v2 verificable', () => {
        const key = crypto.createHash('sha256').update('synthetic-old-passphrase').digest();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update('legacy-secret', 'utf8'), cipher.final()]);
        const v1 = `enc:v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
        expect(() => decryptSecret(v1)).toThrow(/APP_SECRET_LEGACY_V1_KEY/);
        process.env.APP_SECRET_LEGACY_V1_KEY = 'synthetic-old-passphrase';
        expect(decryptSecret(v1)).toBe('legacy-secret');
        const migrated = reencryptSecret(v1);
        expect(migrated).toMatch(/^enc:v2:/);
        delete process.env.APP_SECRET_LEGACY_V1_KEY;
        expect(decryptSecret(migrated)).toBe('legacy-secret');
    });

    it('rechaza versiones futuras y envelopes malformados sin tratarlos como plaintext', () => {
        expect(() => decryptSecret('enc:v3:iv:tag:body')).toThrow(/Malformed/);
        expect(() => encryptSecret('enc:v2:invalid')).toThrow(/Malformed/);
        expect(() => decryptSecret('enc:v2:zz:zz:zz')).toThrow(/Malformed/);
    });

    it('acepta una clave dedicada base64 de 32 bytes', () => {
        process.env.APP_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString('base64');
        expect(decryptSecret(encryptSecret('secret'))).toBe('secret');
    });
});
