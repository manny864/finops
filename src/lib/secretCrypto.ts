/**
 * secretCrypto — cifrado simétrico de secretos de aplicación en reposo.
 *
 * Uso: proteger secretos que la plataforma debe poder **descifrar** (a
 * diferencia de passwords, que se hashean). Hoy: API keys de IA por tenant
 * (`Tenants.ai_api_key`) — remediación IA-2 del assessment 2026-07-05.
 *
 * Formato del ciphertext (self-contained, una sola columna):
 *   enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * El prefijo `enc:v1:` permite distinguir valores cifrados de valores en
 * texto plano legacy: `decryptSecret` devuelve el input tal cual si no lleva
 * el prefijo, de modo que la migración es transparente (una key vieja sin
 * cifrar sigue funcionando hasta que se re-guarda o se corre la migración de
 * datos).
 *
 * Clave maestra: `MFA_ENCRYPTION_KEY` (32 bytes / 64 hex). Es el mismo
 * material que ya usan MFA (`mfaCrypto.ts`) y el cache de Key Vault; está en
 * Key Vault y respaldado. No se introduce un secreto nuevo.
 */
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

function getMasterKey(): Buffer {
    const keyHex = process.env.MFA_ENCRYPTION_KEY;
    if (!keyHex || keyHex.length !== 64) {
        throw new Error('MFA_ENCRYPTION_KEY not configured (must be 64 hex chars) — required to encrypt/decrypt app secrets.');
    }
    return Buffer.from(keyHex, 'hex');
}

/** True si `value` ya está en formato cifrado de esta librería. */
export function isEncrypted(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Cifra `plaintext` con AES-256-GCM. Devuelve el string self-contained
 * `enc:v1:iv:authTag:ciphertext`. Idempotente: si ya viene cifrado, lo
 * devuelve sin recifrar.
 */
export function encryptSecret(plaintext: string): string {
    if (isEncrypted(plaintext)) return plaintext;
    const key = getMasterKey();
    const iv = crypto.randomBytes(12); // 96-bit nonce recomendado para GCM
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Descifra un valor producido por `encryptSecret`. Si el valor NO tiene el
 * prefijo `enc:v1:` se asume texto plano legacy y se devuelve tal cual
 * (retrocompatibilidad durante la migración). Un valor con prefijo pero
 * malformado o con authTag inválido lanza (fail-closed contra tampering).
 */
export function decryptSecret(value: string | null | undefined): string {
    if (value == null || value === '') return '';
    if (!isEncrypted(value)) return value; // plaintext legacy
    const body = value.slice(PREFIX.length);
    const parts = body.split(':');
    if (parts.length !== 3) {
        throw new Error('Malformed encrypted secret: expected enc:v1:iv:authTag:ciphertext.');
    }
    const [ivHex, authTagHex, ciphertextHex] = parts;
    const key = getMasterKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextHex, 'hex')),
        decipher.final(),
    ]);
    return plaintext.toString('utf8');
}
