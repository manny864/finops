/**
 * secretCrypto — cifrado simétrico de secretos de aplicación en reposo.
 *
 * Uso: proteger secretos que la plataforma debe poder **descifrar** (a
 * diferencia de passwords, que se hashean). Hoy: API keys de IA por tenant
 * (`Tenants.ai_api_key`) — remediación IA-2 del assessment 2026-07-05.
 *
 * Formato del ciphertext (self-contained, una sola columna):
 *   enc:v2:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * El prefijo `enc:v1:` permite distinguir valores cifrados de valores en
 * texto plano legacy: `decryptSecret` devuelve el input tal cual si no lleva
 * el prefijo, de modo que la migración es transparente (una key vieja sin
 * cifrar sigue funcionando hasta que se re-guarda o se corre la migración de
 * datos).
 *
 * Nuevas escrituras: APP_SECRET_ENCRYPTION_KEY, dedicada de 32 bytes.
 * Lectura v1 durante migracion: APP_SECRET_LEGACY_V1_KEY, configurada
 * explicitamente con el material usado anteriormente (incluidas passphrases).
 * No se deriva material de claves MFA, credenciales ni semillas del codigo.
 */
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v2:';

/**
 * Material de clave disponible, en orden de precedencia. Devuelve null si no hay
 * ninguno configurado — a proposito NO existe una clave por defecto en codigo:
 * una clave hardcodeada en el repo haria descifrable cualquier secreto de la base
 * para cualquiera con acceso al codigo, y peor, produccion cifraria en silencio
 * con una clave publica si la variable faltara. Ver `tryDecryptSecret` para el
 * camino que degrada sin romper.
 */
export function hasEncryptionKey(): boolean {
    if (!process.env.APP_SECRET_ENCRYPTION_KEY) return false;
    getMasterKey();
    return true;
}

function getMasterKey(): Buffer {
    const raw = process.env.APP_SECRET_ENCRYPTION_KEY;
    if (!raw) throw new Error('APP_SECRET_ENCRYPTION_KEY is required to encrypt/decrypt v2 app secrets.');
    if (/^[0-9a-f]{64}$/i.test(raw)) {
        return Buffer.from(raw, 'hex');
    }
    const base64 = Buffer.from(raw, 'base64');
    if (base64.length === 32 && base64.toString('base64') === raw) {
        return base64;
    }
    throw new Error('APP_SECRET_ENCRYPTION_KEY must encode exactly 32 bytes as hex or canonical base64.');
}

function getLegacyKey(): Buffer {
    const raw = process.env.APP_SECRET_LEGACY_V1_KEY;
    if (!raw) throw new Error('APP_SECRET_LEGACY_V1_KEY is required to decrypt existing v1 app secrets.');
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
    const base64 = Buffer.from(raw, 'base64');
    if (base64.length === 32) return base64;
    return crypto.createHash('sha256').update(raw).digest();
}

/** True si `value` ya está en formato cifrado de esta librería. */
export function isEncrypted(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.startsWith('enc:');
}

/**
 * Cifra `plaintext` con AES-256-GCM. Devuelve el string self-contained
 * `enc:v2:iv:authTag:ciphertext`. Los valores ya cifrados se autentican
 * antes de conservarlos; la rotacion explicita usa reencryptSecret.
 */
export function encryptSecret(plaintext: string): string {
    if (isEncrypted(plaintext)) {
        decryptSecret(plaintext);
        return plaintext;
    }
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
    const parts = value.split(':');
    if (parts.length !== 5 || !['v1', 'v2'].includes(parts[1])) {
        throw new Error('Malformed encrypted secret: unsupported version or envelope.');
    }
    const [, version, ivHex, authTagHex, ciphertextHex] = parts;
    if (!/^[0-9a-f]{24}$/i.test(ivHex) || !/^[0-9a-f]{32}$/i.test(authTagHex)
        || !/^(?:[0-9a-f]{2})*$/i.test(ciphertextHex)) {
        throw new Error('Malformed encrypted secret: invalid IV, tag or ciphertext.');
    }
    const key = version === 'v1' ? getLegacyKey() : getMasterKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextHex, 'hex')),
        decipher.final(),
    ]);
    return plaintext.toString('utf8');
}

/** Re-encrypts only after authenticating and verifying the resulting envelope. */
export function reencryptSecret(value: string): string {
    const plaintext = decryptSecret(value);
    // encryptSecret intentionally accepts existing envelopes; rotation encrypts
    // the actual plaintext, which must not itself masquerade as an envelope.
    if (isEncrypted(plaintext)) throw new Error('Nested encrypted secret is not supported.');
    const encrypted = encryptSecret(plaintext);
    if (decryptSecret(encrypted) !== plaintext) throw new Error('Secret re-encryption verification failed.');
    return encrypted;
}

/**
 * Variante tolerante de `decryptSecret` para rutas de lectura que NO deben caerse
 * si un secreto puntual no se puede descifrar (chat del Copilot, resolución de
 * proveedor de IA, jobs de fondo).
 *
 * Devuelve null y loguea un warning cuando no hay clave configurada o cuando el
 * ciphertext está corrupto/manipulado, en vez de propagar la excepción: el
 * llamador degrada a la IA global de la plataforma (Service Principal / Managed
 * Identity del backend) en lugar de dejar al usuario sin servicio.
 *
 * Para escritura se sigue usando `encryptSecret`, que falla fuerte: guardar un
 * secreto sin cifrar de verdad no es una degradación aceptable.
 */
export function tryDecryptSecret(
    value: string | null | undefined,
    context = 'secret'
): string | null {
    if (value == null || value === '') return null;
    if (!isEncrypted(value)) return value; // plaintext legacy
    try {
        return decryptSecret(value);
    } catch (error) {
        console.warn(
            `[secretCrypto] ${context}: no se pudo descifrar el secreto (${error instanceof Error ? error.message : 'error desconocido'}); se omite.`
        );
        return null;
    }
}
