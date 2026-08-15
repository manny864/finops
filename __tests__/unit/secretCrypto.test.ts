import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { encryptSecret, decryptSecret, isEncrypted } from '@/lib/secretCrypto';

// Clave de test determinística (32 bytes / 64 hex). No es un secreto real.
const TEST_KEY = 'a'.repeat(64);

beforeAll(() => {
    process.env.MFA_ENCRYPTION_KEY = TEST_KEY;
});

afterEach(() => {
    process.env.MFA_ENCRYPTION_KEY = TEST_KEY;
    delete process.env.AZURE_KEYVAULT_CACHE_KEY;
});

describe('secretCrypto', () => {
    it('round-trips: decrypt(encrypt(x)) === x', () => {
        const plain = 'sk-proj-1234567890abcdefGHIJKLMNOP';
        const enc = encryptSecret(plain);
        expect(decryptSecret(enc)).toBe(plain);
    });

    it('produce el formato enc:v1:iv:tag:ciphertext', () => {
        const enc = encryptSecret('hello');
        expect(enc.startsWith('enc:v1:')).toBe(true);
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

    it('usa fallback AZURE_KEYVAULT_CACHE_KEY cuando MFA_ENCRYPTION_KEY no está', () => {
        delete process.env.MFA_ENCRYPTION_KEY;
        process.env.AZURE_KEYVAULT_CACHE_KEY = TEST_KEY;
        const enc = encryptSecret('fallback-key');
        expect(decryptSecret(enc)).toBe('fallback-key');
    });
});
